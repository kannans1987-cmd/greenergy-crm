-- Attendance: "Out on work" sessions (27 Nov 2026)
-- For staff who move between the office, customer site visits, the EB office and other errands
-- in one day. Besides "office" (inside the office radius) and "site" (an assigned project or a
-- service job), a session can now be:
--   outside : away from the office on company work. The purpose is required:
--               site_visit (survey / meeting for a lead), eb_office (EB / net-meter follow-up),
--               purchase (supplier / material), bank_govt (bank or government office), other.
--             It can name the lead or project it was for. A short note (where / what) is
--             required when it names neither, or the purpose is "other".
--             GPS is recorded at clock-in and clock-out as always, but there is no radius check.
-- People who do this several times a day need the "field" attendance type (several sessions a day).
-- Needs attendance_multi_v1.sql and service_v1.sql first. Safe to run more than once.

alter table attendance drop constraint if exists attendance_work_type_check;
alter table attendance add constraint attendance_work_type_check check (work_type in ('office', 'site', 'outside'));
alter table attendance add column if not exists purpose text;
alter table attendance add column if not exists purpose_note text;
alter table attendance add column if not exists quotation_id uuid references quotation_requests(id) on delete set null;
alter table attendance drop constraint if exists attendance_purpose_check;
alter table attendance add constraint attendance_purpose_check
  check (purpose is null or purpose in ('site_visit', 'eb_office', 'purchase', 'bank_govt', 'other'));

create or replace function attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ceo     boolean := auth.uid() is null or is_admin();
  office  office_locations%rowtype;
  dist    double precision;
  slack   double precision;
  others  numeric;
begin
  if tg_op = 'INSERT' then
    if not ceo then
      new.date           := (now() at time zone 'Asia/Kolkata')::date;
      new.clock_in_time  := now();
      new.clock_out_time := null; new.clock_out_lat := null; new.clock_out_lng := null;
      new.total_hours    := null; new.overtime_hours := 0;
      new.attendance_status := 'present';
      new.is_location_mismatch := false;
    end if;
    new.session_no := coalesce((select max(session_no) from attendance
                                where employee_id = new.employee_id and date = new.date), 0) + 1;

    if new.work_type = 'office' then
      new.project_id := null; new.service_ticket_id := null; new.quotation_id := null;
      new.purpose := null; new.purpose_note := null;
      if new.clock_in_lat is null or new.clock_in_lng is null then
        raise exception 'Your location is needed to clock in at the office.';
      end if;
      select * into office from office_locations where active
        order by geo_distance_m(lat, lng, new.clock_in_lat::float8, new.clock_in_lng::float8) limit 1;
      if not found then
        raise exception 'The office location has not been set yet. Ask the CEO to set it in Attendance → Office location.';
      end if;
      dist := geo_distance_m(office.lat, office.lng, new.clock_in_lat::float8, new.clock_in_lng::float8);
      new.office_location_id  := office.id;
      new.clock_in_distance_m := round(dist::numeric);
      slack := least(coalesce(new.clock_in_accuracy_m::float8, 0), 100);
      if dist > office.radius_m + slack and not ceo then
        raise exception 'You are about % m from %. Office clock-in works within % m. Go to the office (or near a window / outside for a better GPS signal) and try again.',
          round(dist::numeric), office.name, office.radius_m;
      end if;
    elsif new.work_type = 'outside' then
      new.service_ticket_id := null; new.office_location_id := null;
      new.purpose_note := nullif(btrim(left(new.purpose_note, 300)), '');
      if not ceo then
        if new.purpose is null then
          raise exception 'Choose what you are going out for (site visit, EB office, purchase, bank / govt office or other).';
        end if;
        if new.clock_in_lat is null or new.clock_in_lng is null then
          raise exception 'Your location is needed to clock in.';
        end if;
        if (new.purpose = 'other' or (new.quotation_id is null and new.project_id is null))
           and coalesce(length(new.purpose_note), 0) < 3 then
          raise exception 'Write where you are going and why (e.g. "EB office Lawspet – net meter file of Ravi").';
        end if;
      end if;
    else
      new.quotation_id := null; new.purpose := null; new.purpose_note := null;
      if new.project_id is null and new.service_ticket_id is null and not ceo then
        raise exception 'Choose the project / site or the service job you are working on.';
      end if;
    end if;
    return new;
  end if;

  if not ceo then
    if old.clock_out_time is not null then
      raise exception 'This session is already clocked out.';
    end if;
    new.employee_id := old.employee_id; new.date := old.date; new.session_no := old.session_no; new.work_type := old.work_type;
    new.project_id := old.project_id; new.service_ticket_id := old.service_ticket_id; new.office_location_id := old.office_location_id;
    new.quotation_id := old.quotation_id; new.purpose := old.purpose; new.purpose_note := old.purpose_note;
    new.clock_in_time := old.clock_in_time; new.clock_in_lat := old.clock_in_lat; new.clock_in_lng := old.clock_in_lng;
    new.clock_in_address := old.clock_in_address; new.clock_in_accuracy_m := old.clock_in_accuracy_m;
    new.clock_in_distance_m := old.clock_in_distance_m; new.attendance_status := old.attendance_status;
    if new.clock_out_time is not null then new.clock_out_time := now(); end if;
  end if;

  if new.clock_out_time is not null and new.work_type = 'office' and new.clock_out_lat is not null and new.clock_out_lng is not null then
    select * into office from office_locations where id = new.office_location_id;
    if found then
      dist := geo_distance_m(office.lat, office.lng, new.clock_out_lat::float8, new.clock_out_lng::float8);
      new.clock_out_distance_m := round(dist::numeric);
      new.is_location_mismatch := dist > office.radius_m + least(coalesce(new.clock_out_accuracy_m::float8, 0), 100);
    end if;
  end if;

  if new.clock_out_time is not null and new.clock_in_time is not null then
    new.total_hours := round((extract(epoch from new.clock_out_time - new.clock_in_time) / 3600)::numeric, 2);
    select coalesce(sum(total_hours), 0) into others from attendance
      where employee_id = new.employee_id and date = new.date and id <> new.id and total_hours is not null;
    new.overtime_hours := greatest(0, others + new.total_hours - 8) - greatest(0, others - 8);
  else
    new.total_hours := null; new.overtime_hours := 0;
  end if;
  return new;
end;$$;

-- Clock-in also takes the purpose, a note and a lead. The 9-argument version is replaced.
drop function if exists attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text, uuid);
create or replace function attendance_clock_in(
  p_device uuid, p_secret text, p_work_type text, p_project uuid,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text,
  p_ticket uuid default null, p_purpose text default null, p_note text default null, p_quotation uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare dev uuid; new_id uuid; mode text; open_rec attendance%rowtype; tk service_tickets%rowtype;
        today date := (now() at time zone 'Asia/Kolkata')::date; proj uuid := p_project;
        wt text := case when p_work_type in ('office', 'outside') and p_ticket is null then p_work_type else 'site' end;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if is_admin() then raise exception 'The CEO does not clock in or out.'; end if;
  dev := _check_attendance_device(p_device, p_secret);
  perform pg_advisory_xact_lock(hashtext('attendance:' || auth.uid()::text));

  select coalesce(attendance_mode, 'office') into mode from profiles where id = auth.uid();
  select * into open_rec from attendance
    where employee_id = auth.uid() and clock_out_time is null and clock_in_time > now() - interval '18 hours'
    order by clock_in_time desc limit 1;
  if found then
    raise exception 'You are still clocked in since % (session %). Clock out first.',
      to_char(open_rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM'), open_rec.session_no;
  end if;
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
