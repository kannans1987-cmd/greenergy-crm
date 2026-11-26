-- Attendance v1 (26 Nov 2026)
--  * Office staff can clock in at the office: no project needed. The phone's GPS must be
--    within the office radius (checked here in the database, so the page cannot be bypassed).
--  * Site staff clock in on a project as before (location recorded).
--  * The CEO sets the office location(s) and radius in Attendance → Office location.
--  * Clock-in / clock-out times are the server's time, not the phone's; hours are worked out here.
--  * One attendance record per person per day (India date).
-- Safe to run more than once.

create table if not exists office_locations (
  id          uuid default gen_random_uuid() primary key,
  name        text not null default 'Head office',
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  radius_m    integer not null default 200 check (radius_m between 30 and 5000),
  active      boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table office_locations enable row level security;
drop policy if exists "staff_read_offices" on office_locations;
create policy "staff_read_offices" on office_locations for select using (is_staff());
drop policy if exists "ceo_manage_offices" on office_locations;
create policy "ceo_manage_offices" on office_locations for all using (is_admin()) with check (is_admin());

alter table attendance add column if not exists work_type text not null default 'site';
alter table attendance drop constraint if exists attendance_work_type_check;
alter table attendance add constraint attendance_work_type_check check (work_type in ('office','site'));
alter table attendance add column if not exists office_location_id uuid references office_locations(id) on delete set null;
alter table attendance add column if not exists clock_in_accuracy_m numeric;
alter table attendance add column if not exists clock_in_distance_m numeric;
alter table attendance add column if not exists clock_out_accuracy_m numeric;
alter table attendance add column if not exists clock_out_distance_m numeric;
alter table attendance add column if not exists clock_out_address text;

-- One record per person per day (skipped with a notice if old duplicate rows exist)
do $$ begin
  create unique index if not exists attendance_one_per_day on attendance (employee_id, date);
exception when unique_violation then
  raise notice 'attendance_one_per_day not created: there are duplicate days to clean up first';
end $$;

-- Distance in metres between two GPS points
create or replace function geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ceo     boolean := auth.uid() is null or is_admin();   -- CEO or the server may correct records
  office  office_locations%rowtype;
  dist    double precision;
  slack   double precision;
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
      raise exception 'You have already clocked out today.';
    end if;
    -- Staff may only add their clock-out; everything about the clock-in stays as recorded
    new.employee_id := old.employee_id; new.date := old.date; new.work_type := old.work_type;
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
    new.total_hours    := round((extract(epoch from new.clock_out_time - new.clock_in_time) / 3600)::numeric, 2);
    new.overtime_hours := greatest(0, new.total_hours - 8);
  end if;
  return new;
end;$$;

drop trigger if exists trg_attendance_guard on attendance;
create trigger trg_attendance_guard before insert or update on attendance
  for each row execute function attendance_guard();
