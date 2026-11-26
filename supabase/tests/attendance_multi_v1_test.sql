-- Several clock-ins a day for site / O&M staff; office staff stay once a day.
-- Run on a THROWAWAY database after the setup scripts (see README.md). Raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create or replace function pg_temp.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have been refused): %', what;
end $$;
create or replace function pg_temp.act(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.headers', '{"user-agent":"Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"}', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000e0c01', 'am-ceo@gss.test',    now(), '{"full_name":"AM CEO"}'),
 ('00000000-0000-0000-0000-0000000e0c02', 'am-office@gss.test', now(), '{"full_name":"AM Office"}'),
 ('00000000-0000-0000-0000-0000000e0c03', 'am-tech@gss.test',   now(), '{"full_name":"AM Technician"}');
update profiles set status = 'active' where email like 'am-%@gss.test';
update profiles set role = 'admin' where email = 'am-ceo@gss.test';
insert into projects (id, name, customer_name, status) values
 ('80000000-0000-0000-0000-0000000000a1', 'Site A', 'Customer A', 'in_progress'),
 ('80000000-0000-0000-0000-0000000000a2', 'Site B', 'Customer B', 'in_progress');
insert into project_employees (project_id, employee_id) values
 ('80000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000e0c03'),
 ('80000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000e0c03');
insert into office_locations (name, lat, lng, radius_m) values ('Office', 11.9600, 79.8100, 150);
insert into trusted_devices (id, employee_id, secret_hash, status) values
 ('80000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000e0c02', _sha256_hex(repeat('2', 64)), 'approved'),
 ('80000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000e0c03', _sha256_hex(repeat('3', 64)), 'approved');

select pg_temp.ok((select attendance_mode = 'office' from profiles where email = 'am-tech@gss.test'), 'everyone starts as office');

-- Staff cannot make themselves "field"; the CEO can
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c03');
select pg_temp.fails($$update profiles set attendance_mode = 'field' where id = auth.uid()$$, 'staff changes own attendance type');
update profiles set phone = '9000000003' where id = auth.uid();   -- own contact details still fine
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c01');
update profiles set attendance_mode = 'field' where email = 'am-tech@gss.test';
commit;
select pg_temp.ok((select attendance_mode = 'field' and phone = '9000000003' from profiles where email = 'am-tech@gss.test'), 'CEO sets field');
select pg_temp.ok(exists (select 1 from audit_log where action_type = 'attendance_mode_changed'), 'change is in the audit log');

-- ── Field: several sessions ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c03');
select attendance_clock_in('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 'site', '80000000-0000-0000-0000-0000000000a1', 12.1, 79.7, 10, 'Site A');
select pg_temp.fails($$select attendance_clock_in('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 'site', '80000000-0000-0000-0000-0000000000a2', 12.2, 79.6, 10, 'Site B')$$, 'second session while the first is open');
select attendance_clock_out('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 12.1, 79.7, 10, 'Site A');
select attendance_clock_in('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 'site', '80000000-0000-0000-0000-0000000000a2', 12.2, 79.6, 10, 'Site B');
select attendance_clock_out('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 12.2, 79.6, 10, 'Site B');
select attendance_clock_in('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 'office', null, 11.9601, 79.8101, 10, 'Office');
commit;
select pg_temp.ok((select array_agg(session_no order by session_no) = '{1,2,3}' from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03'), 'sessions 1, 2, 3 on one day');
select pg_temp.ok((select count(*) = 2 from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03' and clock_out_time is not null and total_hours is not null), 'first two are clocked out with hours');
select pg_temp.ok((select project_id = '80000000-0000-0000-0000-0000000000a2' from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 2), 'each session keeps its own site');

-- Overtime is on the day total: 5 h + 4 h → 1 h overtime, on the later session
delete from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 3;   -- test clean-up
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c01');
update attendance set clock_in_time = date_trunc('day', now()) + interval '3 hours', clock_out_time = date_trunc('day', now()) + interval '8 hours'
  where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 1;
update attendance set clock_in_time = date_trunc('day', now()) + interval '9 hours', clock_out_time = date_trunc('day', now()) + interval '13 hours'
  where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 2;
commit;
select pg_temp.ok((select sum(total_hours) = 9 and sum(overtime_hours) = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03'), 'day total 9 h, overtime 1 h');
select pg_temp.ok((select overtime_hours = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 2), 'overtime on the session that went past 8 h');
select pg_temp.ok((select total_manhours = 5 from job_cards where employee_id = '00000000-0000-0000-0000-0000000e0c03' and project_id = '80000000-0000-0000-0000-0000000000a1'), 'Site A job card gets its own hours');

-- Forgot to clock out (session open 20 h): cannot be closed by staff, does not block a new clock-in
update attendance set clock_out_time = null, clock_in_time = now() - interval '20 hours', date = (now() at time zone 'Asia/Kolkata')::date - 1, session_no = 1
  where employee_id = '00000000-0000-0000-0000-0000000e0c03' and session_no = 2;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c03');
select pg_temp.fails($$select attendance_clock_out('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 12.2, 79.6, 10, 'x')$$, 'closing a 20-hour-old session');
select attendance_clock_in('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 'site', '80000000-0000-0000-0000-0000000000a1', 12.1, 79.7, 10, 'Site A');
select attendance_clock_out('80000000-0000-0000-0000-0000000000d3', repeat('3', 64), 12.1, 79.7, 10, 'Site A');
commit;
select pg_temp.ok((select session_no = 2 and clock_out_time is not null from attendance
  where employee_id = '00000000-0000-0000-0000-0000000e0c03' and clock_in_time > now() - interval '1 minute'), 'new session after a forgotten one');

-- ── Office: still once a day ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000e0c02');
select attendance_clock_in('80000000-0000-0000-0000-0000000000d2', repeat('2', 64), 'office', null, 11.9601, 79.8101, 10, 'Office');
select attendance_clock_out('80000000-0000-0000-0000-0000000000d2', repeat('2', 64), 11.9601, 79.8101, 10, 'Office');
select pg_temp.fails($$select attendance_clock_in('80000000-0000-0000-0000-0000000000d2', repeat('2', 64), 'office', null, 11.9601, 79.8101, 10, 'Office')$$, 'office staff clock in twice');
commit;
select pg_temp.ok((select count(*) = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000e0c02'), 'office staff: one record');

select 'ALL MULTI-SESSION ATTENDANCE CHECKS PASSED';
