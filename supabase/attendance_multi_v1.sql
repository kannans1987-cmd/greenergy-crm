-- Attendance: several clock-ins a day for site / O&M staff (27 Nov 2026)
--  * Each person has an attendance type, set by the CEO on the Attendance page:
--      office : one clock-in and one clock-out a day (office staff)
--      field  : clock in and out several times a day, e.g. one session per site visit
--               (installation, operation & maintenance)
--  * Every clock-in starts a new session (session 1, 2, 3 … of that day). A new session
--    can only start after the previous one is clocked out.
--  * Hours are per session; overtime is worked out on the DAY's total (over 8 h), shared
--    across the sessions so that adding them up gives the right figure.
--  * A session left open for more than 18 hours (forgot to clock out) no longer blocks
--    anything: the CEO corrects it, and the person can clock in again.
-- Needs attendance_v1.sql and attendance_devices_v1.sql first. Safe to run more than once.

-- ── Attendance type per person ──
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'attendance_mode') then
    alter table profiles add column attendance_mode text not null default 'office';
    -- First run only: installation / O&M people start as "field"; the CEO can change anyone later
    update profiles set attendance_mode = 'field'
      where role <> 'admin'
        and (coalesce(department, '') ~* '(install|commission|o ?& ?m|operation|maintenance|service|site)'
          or coalesce(designation, '') ~* '(technician|electrician|helper|fitter|installer|o ?& ?m|maintenance|site engineer|field)');
  end if;
end $$;
alter table profiles drop constraint if exists profiles_attendance_mode_check;
alter table profiles add constraint profiles_attendance_mode_check check (attendance_mode in ('office', 'field'));

-- Only the CEO changes a person's attendance type (staff may still edit their own contact details)
create or replace function profile_attendance_mode_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.attendance_mode is distinct from old.attendance_mode then
    if auth.uid() is not null and not is_admin() then
      raise exception 'Only the CEO can change the attendance type.';
    end if;
    insert into audit_log (action_by, action_type, target_entity, target_id, description)
      values (auth.uid(), 'attendance_mode_changed', 'profiles', new.id,
              coalesce(new.full_name, 'Staff') || ': attendance type ' || old.attendance_mode || ' → ' || new.attendance_mode);
  end if;
  return new;
end;$$;
drop trigger if exists trg_profile_attendance_mode_guard on profiles;
create trigger trg_profile_attendance_mode_guard before update of attendance_mode on profiles
  for each row execute function profile_attendance_mode_guard();

-- ── Sessions ──
alter table attendance add column if not exists session_no integer not null default 1;
drop index if exists attendance_one_per_day;
create unique index if not exists attendance_session_per_day on attendance (employee_id, date, session_no);
create index if not exists attendance_open_sessions on attendance (employee_id) where clock_out_time is null;

create or replace function attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ceo     boolean := auth.uid() is null or is_admin();   -- CEO or the server may correct records
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
      new.project_id := null;
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
      -- Indoor GPS is rough: allow the reported accuracy on top of the radius, up to 100 m
      slack := least(coalesce(new.clock_in_accuracy_m::float8, 0), 100);
      if dist > office.radius_m + slack and not ceo then
        raise exception 'You are about % m from %. Office clock-in works within % m. Go to the office (or near a window / outside for a better GPS signal) and try again.',
          round(dist::numeric), office.name, office.radius_m;
      end if;
    elsif new.project_id is null and not ceo then
      raise exception 'Choose the project / site you are working at.';
    end if;
    return new;
  end if;

  -- UPDATE
  if not ceo then
    if old.clock_out_time is not null then
      raise exception 'This session is already clocked out.';
    end if;
    -- Staff may only add their clock-out; everything about the clock-in stays as recorded
    new.employee_id := old.employee_id; new.date := old.date; new.session_no := old.session_no; new.work_type := old.work_type;
    new.project_id := old.project_id; new.office_location_id := old.office_location_id;
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
      -- Clock-out is never blocked; leaving from somewhere else is flagged for the CEO
      new.is_location_mismatch := dist > office.radius_m + least(coalesce(new.clock_out_accuracy_m::float8, 0), 100);
    end if;
  end if;

  if new.clock_out_time is not null and new.clock_in_time is not null then
    new.total_hours := round((extract(epoch from new.clock_out_time - new.clock_in_time) / 3600)::numeric, 2);
    -- Overtime counts on the day's total: this session gets the part that goes past 8 h
    select coalesce(sum(total_hours), 0) into others from attendance
      where employee_id = new.employee_id and date = new.date and id <> new.id and total_hours is not null;
    new.overtime_hours := greatest(0, others + new.total_hours - 8) - greatest(0, others - 8);
  else
    new.total_hours := null; new.overtime_hours := 0;
  end if;
  return new;
end;$$;

drop trigger if exists trg_attendance_guard on attendance;
create trigger trg_attendance_guard before insert or update on attendance
  for each row execute function attendance_guard();

-- ── Clock in / out ──
create or replace function attendance_clock_in(
  p_device uuid, p_secret text, p_work_type text, p_project uuid,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text)
returns uuid language plpgsql security definer set search_path = public as $$
declare dev uuid; new_id uuid; mode text; open_rec attendance%rowtype; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if is_admin() then raise exception 'The CEO does not clock in or out.'; end if;
  dev := _check_attendance_device(p_device, p_secret);
  perform pg_advisory_xact_lock(hashtext('attendance:' || auth.uid()::text));   -- a double tap cannot start two sessions

  select coalesce(attendance_mode, 'office') into mode from profiles where id = auth.uid();
  select * into open_rec from attendance
    where employee_id = auth.uid() and clock_out_time is null and clock_in_time > now() - interval '18 hours'
    order by clock_in_time desc limit 1;
  if found then
    raise exception 'You are still clocked in since % (session %). Clock out first.',
      to_char(open_rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM'), open_rec.session_no;
  end if;
  if mode = 'office' and exists (select 1 from attendance where employee_id = auth.uid() and date = today) then
    raise exception 'You have already clocked in today. (Office attendance is once a day; ask the CEO if you need several sessions for site work.)';
  end if;
  if (select count(*) from attendance where employee_id = auth.uid() and date = today) >= 12 then
    raise exception 'That is 12 sessions today already. Ask the CEO to correct your attendance.';
  end if;
  if p_work_type = 'site' and p_project is not null and not is_manager() and not exists (
    select 1 from project_employees where project_id = p_project and employee_id = auth.uid() and released_date is null) then
    raise exception 'You are not assigned to that project.';
  end if;
  -- attendance_guard sets the time, date and session number and checks the office distance
  insert into attendance (employee_id, work_type, project_id, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_address, device_id)
    values (auth.uid(), case when p_work_type = 'office' then 'office' else 'site' end, p_project,
            p_lat, p_lng, p_accuracy, left(p_address, 500), dev)
    returning id into new_id;
  return new_id;
end;$$;

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
  if rec.clock_in_time < now() - interval '18 hours' then
    raise exception 'You did not clock out on % (clocked in at %). Ask the CEO to correct that day. You can clock in again now.',
      to_char(rec.date, 'DD Mon'), to_char(rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM');
  end if;
  update attendance set clock_out_time = now(), clock_out_lat = p_lat, clock_out_lng = p_lng,
         clock_out_accuracy_m = p_accuracy, clock_out_address = left(p_address, 500)
    where id = rec.id;
  return rec.id;
end;$$;

revoke all on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text),
  attendance_clock_out(uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text),
  attendance_clock_out(uuid, text, double precision, double precision, double precision, text) to authenticated;
