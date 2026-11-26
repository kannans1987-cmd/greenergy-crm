-- Attendance trusted phones v1 (26 Nov 2026)
--  * Each staff member registers ONE mobile phone; the CEO approves it.
--  * Clock-in / clock-out only work from that approved phone, and only from a mobile browser.
--  * Staff can no longer write attendance rows directly: everything goes through
--    attendance_clock_in / attendance_clock_out, which check the phone, then the office GPS rules
--    (attendance_v1.sql) still apply.
--  * The CEO does not clock in or out (manages attendance; can still correct records).
-- The phone keeps a random secret; only its SHA-256 is stored here.
-- Needs attendance_v1.sql first. Safe to run more than once.

create table if not exists trusted_devices (
  id           uuid default gen_random_uuid() primary key,
  employee_id  uuid not null references profiles(id) on delete cascade,
  secret_hash  text not null,
  label        text,
  user_agent   text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  created_at   timestamptz default now(),
  decided_by   uuid references profiles(id) on delete set null,
  decided_at   timestamptz,
  last_used_at timestamptz
);
create index if not exists trusted_devices_employee on trusted_devices (employee_id, status);
alter table trusted_devices enable row level security;
drop policy if exists "read_trusted_devices" on trusted_devices;
create policy "read_trusted_devices" on trusted_devices for select using (employee_id = auth.uid() or is_manager());
-- No insert / update / delete policies: only the functions below change this table.

alter table attendance add column if not exists device_id uuid references trusted_devices(id) on delete set null;

-- Staff no longer insert or edit attendance directly (the CEO's correction policy stays)
drop policy if exists "Employee clock in/out" on attendance;
drop policy if exists "Employee update own" on attendance;

create or replace function _sha256_hex(t text) returns text language sql immutable as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex');
$$;

-- Browser of the current request (PostgREST passes the request headers)
create or replace function _request_is_mobile() returns boolean language plpgsql stable as $$
declare ua text;
begin
  begin ua := coalesce(current_setting('request.headers', true)::json->>'user-agent', '');
  exception when others then ua := ''; end;
  return ua ~* '(android|iphone|ipod|mobile)' and ua !~* '(ipad|tablet)';
end;$$;

create or replace function _request_user_agent() returns text language plpgsql stable as $$
begin
  return left(coalesce(current_setting('request.headers', true)::json->>'user-agent', ''), 400);
exception when others then return ''; end;$$;

-- Staff: ask to make this phone the trusted one
create or replace function register_attendance_device(p_secret text, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); new_id uuid; who text;
begin
  if uid is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if length(coalesce(p_secret, '')) < 32 then raise exception 'Invalid device code.'; end if;
  if not _request_is_mobile() then
    raise exception 'Register from your mobile phone: open the CRM on the phone you will carry to work.';
  end if;
  -- An earlier, still-waiting request is replaced by this one
  update trusted_devices set status = 'rejected', decided_at = now()
    where employee_id = uid and status = 'pending';
  insert into trusted_devices (employee_id, secret_hash, label, user_agent)
    values (uid, _sha256_hex(p_secret), left(coalesce(nullif(trim(p_label), ''), 'Mobile phone'), 80), _request_user_agent())
    returning id into new_id;
  select full_name into who from profiles where id = uid;
  insert into notifications (user_id, type, title, message, link)
    select id, 'attendance', 'Phone waiting for approval',
           coalesce(who, 'A staff member') || ' registered a phone for attendance: ' || coalesce(p_label, 'Mobile phone'), '/staff/attendance'
    from profiles where role = 'admin' and status = 'active';
  return new_id;
end;$$;

-- CEO: approve, reject or revoke. Approving one phone revokes that person's other phones.
create or replace function decide_attendance_device(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare d trusted_devices%rowtype;
begin
  if not is_admin() then raise exception 'Only the CEO can approve phones.'; end if;
  if p_status not in ('approved','rejected','revoked') then raise exception 'Unknown status.'; end if;
  select * into d from trusted_devices where id = p_id;
  if not found then raise exception 'Phone not found.'; end if;
  if p_status = 'approved' then
    update trusted_devices set status = 'revoked', decided_by = auth.uid(), decided_at = now()
      where employee_id = d.employee_id and id <> d.id and status in ('approved','pending');
  end if;
  update trusted_devices set status = p_status, decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into notifications (user_id, type, title, message, link) values (d.employee_id, 'attendance',
    case p_status when 'approved' then 'Your phone is approved for attendance' else 'Your attendance phone was not approved' end,
    case p_status when 'approved' then 'You can now clock in and out from ' || coalesce(d.label, 'your phone') || '.'
         else 'Contact the CEO, or register your phone again.' end,
    '/staff/attendance');
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'attendance_device_' || p_status, 'trusted_devices', p_id,
            'Attendance phone "' || coalesce(d.label, '') || '" ' || p_status);
end;$$;

-- Checks the phone; returns its id (null for the CEO without a phone)
create or replace function _check_attendance_device(p_device uuid, p_secret text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d trusted_devices%rowtype;
begin
  select * into d from trusted_devices
    where id = p_device and employee_id = auth.uid() and status = 'approved'
      and secret_hash = _sha256_hex(coalesce(p_secret, ''));
  if found then
    if not _request_is_mobile() and not is_admin() then
      raise exception 'Attendance can only be marked from your mobile phone.';
    end if;
    update trusted_devices set last_used_at = now() where id = d.id;
    return d.id;
  end if;
  if is_admin() then return null; end if;
  if not _request_is_mobile() then raise exception 'Attendance can only be marked from your mobile phone.'; end if;
  raise exception 'This phone is not your approved attendance phone. Register it on the Attendance page and ask the CEO to approve it.';
end;$$;

create or replace function attendance_clock_in(
  p_device uuid, p_secret text, p_work_type text, p_project uuid,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text)
returns uuid language plpgsql security definer set search_path = public as $$
declare dev uuid; new_id uuid;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if is_admin() then raise exception 'The CEO does not clock in or out.'; end if;
  dev := _check_attendance_device(p_device, p_secret);
  if exists (select 1 from attendance where employee_id = auth.uid() and date = (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'You have already clocked in today.';
  end if;
  if p_work_type = 'site' and p_project is not null and not is_manager() and not exists (
    select 1 from project_employees where project_id = p_project and employee_id = auth.uid() and released_date is null) then
    raise exception 'You are not assigned to that project.';
  end if;
  -- attendance_guard (attendance_v1.sql) sets the time and date and checks the office distance
  insert into attendance (employee_id, work_type, project_id, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_address, device_id)
    values (auth.uid(), case when p_work_type = 'office' then 'office' else 'site' end, p_project,
            p_lat, p_lng, p_accuracy, left(p_address, 500), dev)
    returning id into new_id;
  return new_id;
end;$$;

create or replace function attendance_clock_out(
  p_device uuid, p_secret text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rec_id uuid;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  perform _check_attendance_device(p_device, p_secret);
  select id into rec_id from attendance
    where employee_id = auth.uid() and clock_out_time is null and clock_in_time is not null
    order by clock_in_time desc limit 1;
  if rec_id is null then raise exception 'You are not clocked in.'; end if;
  update attendance set clock_out_time = now(), clock_out_lat = p_lat, clock_out_lng = p_lng,
         clock_out_accuracy_m = p_accuracy, clock_out_address = left(p_address, 500)
    where id = rec_id;
  return rec_id;
end;$$;

revoke all on function register_attendance_device(text, text), decide_attendance_device(uuid, text),
  _check_attendance_device(uuid, text),
  attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text),
  attendance_clock_out(uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function register_attendance_device(text, text), decide_attendance_device(uuid, text),
  attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text),
  attendance_clock_out(uuid, text, double precision, double precision, double precision, text) to authenticated;
