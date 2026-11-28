-- ═══════════════════════════════════════════════════════════════
-- attendance_late_v1.sql
-- Office hours and late marks.
--   · Business rules → Office hours (setting 'office_hours'):
--       start "09:40", end "18:00", grace_minutes 40, notify_staff true, notify_ceo true
--   · The first clock-in of the day after start + grace (10:20 AM with the defaults) is marked late:
--     attendance.late_minutes = minutes after the start time (e.g. 10:35 → 55). On time = 0.
--     Every clock-in type counts (office, site, out on work, service). The weekly off day
--     (Business rules → Leave policy) is never late.
--   · The person is told "Late today", and the CEO too (both can be switched off).
--   · The CEO can excuse a late mark with a reason (excuse_late); staff cannot
--     change late marks. Leaving before the end time is shown on the Attendance page ("left early").
-- Needs attendance_forgot_v1.sql, growth_v1.sql (setting) and leave_policy_v1.sql (leave_week_off).
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

insert into business_settings (key, data) values ('office_hours',
  '{"start": "09:40", "end": "18:00", "grace_minutes": 40, "notify_staff": true, "notify_ceo": true}')
on conflict (key) do nothing;

alter table attendance add column if not exists late_minutes int not null default 0;
alter table attendance add column if not exists late_excused boolean not null default false;
alter table attendance add column if not exists late_excuse_note text;
alter table attendance add column if not exists late_excused_by uuid references profiles(id) on delete set null;
create index if not exists attendance_late_days on attendance (date) where late_minutes > 0;

-- A time from the setting, or the default when it is missing / not a time
create or replace function office_hours_time(p_key text, p_default time)
returns time language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(nullif(setting('office_hours') ->> p_key, '')::time, p_default);
exception when others then
  return p_default;
end;$$;

create or replace function office_grace_minutes()
returns int language plpgsql stable security definer set search_path = public as $$
begin
  return greatest(0, least(240, coalesce((setting('office_hours') ->> 'grace_minutes')::int, 40)));
exception when others then
  return 40;
end;$$;

-- Runs after attendance_guard (trigger names sort alphabetically), so date / session_no are final
create or replace function attendance_late()
returns trigger language plpgsql security definer set search_path = public as $$
declare mins int; local_in timestamp;
begin
  if tg_op = 'INSERT' then
    new.late_minutes := 0; new.late_excused := false; new.late_excuse_note := null; new.late_excused_by := null;
    if coalesce(new.session_no, 1) = 1 and new.clock_in_time is not null and new.date is not null
       and extract(dow from new.date)::int <> all (leave_week_off()) then
      local_in := new.clock_in_time at time zone 'Asia/Kolkata';
      mins := floor(extract(epoch from local_in - (new.date + office_hours_time('start', '09:40'))) / 60)::int;
      if mins > office_grace_minutes() then new.late_minutes := mins; end if;
    end if;
    return new;
  end if;
  -- Only the CEO (excuse_late) changes late marks
  if not (auth.uid() is null or is_admin()) then
    new.late_minutes := old.late_minutes; new.late_excused := old.late_excused;
    new.late_excuse_note := old.late_excuse_note; new.late_excused_by := old.late_excused_by;
  end if;
  return new;
end;$$;
drop trigger if exists trg_attendance_zlate on attendance;
create trigger trg_attendance_zlate before insert or update on attendance
  for each row execute function attendance_late();

create or replace function attendance_late_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare s jsonb := setting('office_hours'); who text; t text; g text;
begin
  if new.late_minutes <= 0 then return null; end if;
  select full_name into who from profiles where id = new.employee_id;
  t := to_char(new.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM');
  g := to_char(office_hours_time('start', '09:40') + make_interval(mins => office_grace_minutes()), 'HH12:MI AM');
  if coalesce((s ->> 'notify_staff')::boolean, true) then
    insert into notifications (user_id, type, title, message, link)
    values (new.employee_id, 'attendance', 'Late today',
      'You clocked in at ' || t || ', ' || new.late_minutes || ' min after the office start time ('
        || to_char(office_hours_time('start', '09:40'), 'HH12:MI AM') || '; on time until ' || g || ').',
      '/staff/attendance');
  end if;
  if coalesce((s ->> 'notify_ceo')::boolean, true) then
    insert into notifications (user_id, type, title, message, link)
    select p.id, 'attendance', 'Late today: ' || coalesce(who, 'Staff'),
      coalesce(who, 'Staff') || ' clocked in at ' || t || ' (' || new.late_minutes || ' min late).',
      '/staff/attendance'
      from profiles p where p.role = 'admin' and p.status = 'active' and p.id <> new.employee_id;
  end if;
  return null;
end;$$;
drop trigger if exists trg_attendance_late_notify on attendance;
create trigger trg_attendance_late_notify after insert on attendance
  for each row execute function attendance_late_notify();

-- CEO: excuse a late mark (or take the excuse back)
create or replace function excuse_late(p_attendance uuid, p_excused boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r attendance%rowtype;
begin
  if not is_admin() then raise exception 'Only the CEO can excuse a late mark.'; end if;
  select * into r from attendance where id = p_attendance;
  if not found then raise exception 'Attendance not found.'; end if;
  if r.late_minutes <= 0 then raise exception 'This clock-in was not late.'; end if;
  if p_excused and coalesce(length(btrim(p_note)), 0) < 3 then raise exception 'Write why the late mark is excused (e.g. "EB office visit first").'; end if;
  update attendance set late_excused = p_excused,
    late_excuse_note = case when p_excused then left(btrim(p_note), 200) end,
    late_excused_by = case when p_excused then auth.uid() end
   where id = p_attendance;
  if p_excused then
    insert into notifications (user_id, type, title, message, link)
    values (r.employee_id, 'attendance', 'Late mark excused',
      'Your late mark on ' || to_char(r.date, 'DD Mon') || ' was excused: ' || left(btrim(p_note), 200), '/staff/attendance');
  end if;
end;$$;
revoke all on function excuse_late(uuid, boolean, text) from public, anon;
grant execute on function excuse_late(uuid, boolean, text) to authenticated;
