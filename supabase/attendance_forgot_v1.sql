-- Attendance: forgotten clock-outs (27 Nov 2026)
-- Problem: a session left open overnight blocked the next morning's clock-in for up to 18 hours,
-- and clocking out the next morning would have recorded a false 15-hour day.
--  * A session is "current" if it is from today, or started less than 8 hours ago (a late shift
--    that runs past midnight). Only a current open session blocks clock-in or can be clocked out.
--  * An older open session is "forgotten": it no longer blocks anything, the CEO is notified once,
--    and the CEO sets the real clock-out time in Attendance → Team attendance.
-- Needs attendance_outside_v1.sql first. Safe to run more than once.

alter table attendance add column if not exists forgot_reported_at timestamptz;

create or replace function attendance_session_is_current(p_date date, p_in timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_date = (now() at time zone 'Asia/Kolkata')::date or p_in > now() - interval '8 hours';
$$;

-- Clock-in: only a CURRENT open session blocks it. A forgotten one is reported to the CEO once.
create or replace function attendance_clock_in(
  p_device uuid, p_secret text, p_work_type text, p_project uuid,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text,
  p_ticket uuid default null, p_purpose text default null, p_note text default null, p_quotation uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare dev uuid; new_id uuid; mode text; open_rec attendance%rowtype; tk service_tickets%rowtype; who text;
        today date := (now() at time zone 'Asia/Kolkata')::date; proj uuid := p_project;
        wt text := case when p_work_type in ('office', 'outside') and p_ticket is null then p_work_type else 'site' end;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if is_admin() then raise exception 'The CEO does not clock in or out.'; end if;
  dev := _check_attendance_device(p_device, p_secret);
  perform pg_advisory_xact_lock(hashtext('attendance:' || auth.uid()::text));

  select coalesce(attendance_mode, 'office') into mode from profiles where id = auth.uid();
  select * into open_rec from attendance
    where employee_id = auth.uid() and clock_out_time is null and attendance_session_is_current(date, clock_in_time)
    order by clock_in_time desc limit 1;
  if found then
    raise exception 'You are still clocked in since % (session %). Clock out first.',
      to_char(open_rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM'), open_rec.session_no;
  end if;
  -- Forgotten sessions from earlier days: tell the CEO (once per session) and carry on
  select full_name into who from profiles where id = auth.uid();
  for open_rec in select * from attendance
      where employee_id = auth.uid() and clock_out_time is null and not attendance_session_is_current(date, clock_in_time)
        and forgot_reported_at is null loop
    insert into notifications (user_id, type, title, message, link)
      select id, 'attendance', 'Forgot to clock out',
             coalesce(who, 'A staff member') || ' did not clock out on ' || to_char(open_rec.date, 'DD Mon') || ' (in at '
               || to_char(open_rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM') || '). Set the clock-out time in Attendance → Team attendance.',
             '/staff/attendance?date=' || open_rec.date::text
        from profiles where role = 'admin' and status = 'active';
    update attendance set forgot_reported_at = now() where id = open_rec.id;
  end loop;
  if mode = 'office' and exists (select 1 from attendance where employee_id = auth.uid() and date = today) then
    raise exception 'You have already clocked in today. (Office attendance is once a day; ask the CEO to set your attendance type to "Field" if you work in several places a day.)';
  end if;
  if (select count(*) from attendance where employee_id = auth.uid() and date = today) >= 12 then
    raise exception 'That is 12 sessions today already. Ask the CEO to correct your attendance.';
  end if;
  if p_ticket is not null then
    select * into tk from service_tickets where id = p_ticket;
    if not found or (tk.assigned_to is distinct from auth.uid() and not is_manager()) then
      raise exception 'That service job is not given to you.';
    end if;
    if tk.status in ('resolved', 'closed', 'cancelled') then raise exception 'That service job is already finished.'; end if;
    proj := coalesce(tk.project_id, p_project);
  elsif wt = 'outside' then
    -- Optional links: only to a lead or project this person can see
    if p_quotation is not null and not can_view_quotation(p_quotation) then
      raise exception 'That lead is not one of yours.';
    end if;
    if p_project is not null and not can_view_project(p_project) then
      raise exception 'That project is not one of yours.';
    end if;
  elsif wt = 'site' and p_project is not null and not is_manager() and not exists (
    select 1 from project_employees where project_id = p_project and employee_id = auth.uid() and released_date is null) then
    raise exception 'You are not assigned to that project.';
  end if;
  insert into attendance (employee_id, work_type, project_id, service_ticket_id, quotation_id, purpose, purpose_note,
                          clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_address, device_id)
    values (auth.uid(), wt, case when wt = 'office' then null else proj end, p_ticket,
            case when wt = 'outside' then p_quotation end, case when wt = 'outside' then p_purpose end,
            case when wt = 'outside' then p_note end,
            p_lat, p_lng, p_accuracy, left(p_address, 500), dev)
    returning id into new_id;
  if p_ticket is not null and tk.status in ('open', 'assigned') then
    update service_tickets set status = 'in_progress' where id = p_ticket;
  end if;
  return new_id;
end;$$;
revoke all on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text, uuid, text, text, uuid) from public, anon;
grant execute on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text, uuid, text, text, uuid) to authenticated;

create or replace function attendance_clock_out(
  p_device uuid, p_secret text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rec attendance%rowtype;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  perform _check_attendance_device(p_device, p_secret);
  perform pg_advisory_xact_lock(hashtext('attendance:' || auth.uid()::text));
  select * into rec from attendance
    where employee_id = auth.uid() and clock_out_time is null and clock_in_time is not null
    order by clock_in_time desc limit 1;
  if not found then raise exception 'You are not clocked in.'; end if;
  if not attendance_session_is_current(rec.date, rec.clock_in_time) then
    raise exception 'You did not clock out on % (clocked in at %). The CEO will set that time. You can clock in for today now.',
      to_char(rec.date, 'DD Mon'), to_char(rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  update attendance set clock_out_time = now(), clock_out_lat = p_lat, clock_out_lng = p_lng,
         clock_out_accuracy_m = p_accuracy, clock_out_address = left(p_address, 500)
    where id = rec.id;
  return rec.id;
end;$$;
revoke all on function attendance_clock_out(uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function attendance_clock_out(uuid, text, double precision, double precision, double precision, text) to authenticated;
