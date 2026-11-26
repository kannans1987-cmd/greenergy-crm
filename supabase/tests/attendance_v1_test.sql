-- Attendance v1 checks: office GPS clock-in, site clock-in, clock-out rules.
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
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000a7c01', 'at-ceo@gss.test',    now(), '{"full_name":"AT CEO"}'),
 ('00000000-0000-0000-0000-0000000a7c02', 'at-office@gss.test', now(), '{"full_name":"AT Office"}'),
 ('00000000-0000-0000-0000-0000000a7c03', 'at-site@gss.test',   now(), '{"full_name":"AT Site"}');
update profiles set status = 'active' where email like 'at-%@gss.test';
update profiles set role = 'admin' where email = 'at-ceo@gss.test';

-- Before the office is set: a clear message
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng) values ('00000000-0000-0000-0000-0000000a7c02', 'office', 11.95, 79.80)$$, 'office clock-in with no office set');
rollback;

-- Only the CEO sets the office
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$insert into office_locations (name, lat, lng) values ('Fake', 0, 0)$$, 'staff adds an office');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c01');
insert into office_locations (name, lat, lng, radius_m) values ('Lawspet office', 11.9600, 79.8100, 150);
commit;

-- 2 km away: refused; inside: accepted, server time and India date used
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng, clock_in_accuracy_m) values ('00000000-0000-0000-0000-0000000a7c02', 'office', 11.9780, 79.8100, 20)$$, 'office clock-in 2 km away');
select pg_temp.fails($$insert into attendance (employee_id, work_type) values ('00000000-0000-0000-0000-0000000a7c02', 'office')$$, 'office clock-in without GPS');
insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_time, date)
  values ('00000000-0000-0000-0000-0000000a7c02', 'office', 11.9605, 79.8102, 25, now() - interval '5 hours', '2020-01-01');
commit;
select pg_temp.ok((select clock_in_time > now() - interval '1 minute' and date = (now() at time zone 'Asia/Kolkata')::date
  and clock_in_distance_m between 50 and 70 and office_location_id is not null
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'office clock-in recorded with server time and distance');

-- Weak indoor signal: 200 m away but accuracy 80 m → accepted (150 + 80)
select pg_temp.ok(geo_distance_m(11.96, 79.81, 11.9618, 79.81) between 190 and 210, 'distance function');

-- Second clock-in the same day refused
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng) values ('00000000-0000-0000-0000-0000000a7c02', 'office', 11.9600, 79.8100)$$, 'two clock-ins on one day');
-- Cannot change the clock-in time; clock-out from 1 km away is allowed but flagged
update attendance set clock_in_time = now() - interval '12 hours', clock_out_time = now() - interval '3 hours',
  clock_out_lat = 11.9690, clock_out_lng = 79.8100, clock_out_accuracy_m = 10
  where employee_id = '00000000-0000-0000-0000-0000000a7c02';
commit;
select pg_temp.ok((select clock_out_time > now() - interval '1 minute' and clock_in_time > now() - interval '5 minutes'
  and total_hours < 0.1 and is_location_mismatch and clock_out_distance_m > 900
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'clock-out uses server time, flags far-away clock-out');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$update attendance set clock_out_time = now() where employee_id = '00000000-0000-0000-0000-0000000a7c02'$$, 'clock out twice');
rollback;

-- Site staff: project still required
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c03');
select pg_temp.fails($$insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng) values ('00000000-0000-0000-0000-0000000a7c03', 'site', 12.5, 79.5)$$, 'site clock-in without project');
rollback;

-- CEO can correct a record (e.g. forgot to clock out) and hours follow
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c01');
update attendance set clock_in_time = date_trunc('day', now()) + interval '9 hours', clock_out_time = date_trunc('day', now()) + interval '18 hours 30 minutes'
  where employee_id = '00000000-0000-0000-0000-0000000a7c02';
commit;
select pg_temp.ok((select total_hours = 9.5 and overtime_hours = 1.5 from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'CEO correction recalculates hours');

-- Staff see their own only; managers see all
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c03');
select pg_temp.ok((select count(*) from attendance) = 0, 'staff cannot see others'' attendance');
select pg_temp.ok((select count(*) from office_locations) = 1, 'staff can see the office location');
rollback;

select 'ALL ATTENDANCE CHECKS PASSED';
