-- Attendance checks: trusted phone, mobile only, office GPS clock-in, site clock-in, clock-out rules.
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
-- Act as a user, from a phone (mobile = true) or a computer
create or replace function pg_temp.act(u text, mobile boolean default true) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.headers', case when mobile
           then '{"user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"}'
           else '{"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"}' end, true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000a7c01', 'at-ceo@gss.test',    now(), '{"full_name":"AT CEO"}'),
 ('00000000-0000-0000-0000-0000000a7c02', 'at-office@gss.test', now(), '{"full_name":"AT Office"}'),
 ('00000000-0000-0000-0000-0000000a7c03', 'at-site@gss.test',   now(), '{"full_name":"AT Site"}');
update profiles set status = 'active' where email like 'at-%@gss.test';
update profiles set role = 'admin' where email = 'at-ceo@gss.test';

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
\set S1 '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set S2 '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''

-- ── Trusted phone ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02', false);
select pg_temp.fails($$select register_attendance_device(repeat('c', 64), 'Laptop')$$, 'register from a computer');
select pg_temp.fails($$insert into attendance (employee_id, work_type, clock_in_lat, clock_in_lng) values ('00000000-0000-0000-0000-0000000a7c02', 'office', 11.96, 79.81)$$, 'direct attendance insert');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
insert into ids values ('d1', register_attendance_device(:S1, 'iPhone · Safari'));
select pg_temp.fails($$insert into trusted_devices (employee_id, secret_hash, status) values ('00000000-0000-0000-0000-0000000a7c02', 'x', 'approved')$$, 'staff approves own phone by insert');
update trusted_devices set status = 'approved';   -- no policy: 0 rows
select pg_temp.fails($$select decide_attendance_device((select v from ids where k = 'd1'), 'approved')$$, 'staff approves own phone');
select pg_temp.fails($$select attendance_clock_in((select v from ids where k = 'd1'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'office', null, 11.96, 79.81, 10, 'x')$$, 'clock-in with a phone still pending');
commit;
select pg_temp.ok((select status = 'pending' from trusted_devices where id = (select v from ids where k = 'd1')), 'phone stays pending');
select pg_temp.ok(exists (select 1 from notifications n join profiles p on p.id = n.user_id where p.email = 'at-ceo@gss.test' and n.type = 'attendance'), 'CEO notified of the phone');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c01', false);
select decide_attendance_device((select v from ids where k = 'd1'), 'approved');
insert into office_locations (name, lat, lng, radius_m) values ('Lawspet office', 11.9600, 79.8100, 150);
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$insert into office_locations (name, lat, lng) values ('Fake', 0, 0)$$, 'staff adds an office');
rollback;

-- ── Office clock-in ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$select attendance_clock_in((select v from ids where k = 'd1'), 'wrong-secret-wrong-secret-wrong-secret-xx', 'office', null, 11.9605, 79.8102, 20, 'x')$$, 'clock-in with a copied phone id but wrong secret');
select pg_temp.fails($$select attendance_clock_in((select v from ids where k = 'd1'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'office', null, 11.9780, 79.8100, 20, 'x')$$, 'office clock-in 2 km away');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02', false);
select pg_temp.fails($$select attendance_clock_in((select v from ids where k = 'd1'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'office', null, 11.9605, 79.8102, 20, 'x')$$, 'clock-in from a computer with the right secret');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select attendance_clock_in((select v from ids where k = 'd1'), :S1, 'office', null, 11.9605, 79.8102, 25, 'Lawspet');
commit;
select pg_temp.ok((select clock_in_time > now() - interval '1 minute' and date = (now() at time zone 'Asia/Kolkata')::date
  and clock_in_distance_m between 50 and 70 and office_location_id is not null and device_id is not null
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'office clock-in recorded with server time, distance and phone');
select pg_temp.ok(geo_distance_m(11.96, 79.81, 11.9618, 79.81) between 190 and 210, 'distance function');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$select attendance_clock_in((select v from ids where k = 'd1'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'office', null, 11.96, 79.81, 10, 'x')$$, 'two clock-ins on one day');
update attendance set clock_in_time = now() - interval '12 hours';   -- no policy: 0 rows (checked below)
select attendance_clock_out((select v from ids where k = 'd1'), :S1, 11.9690, 79.8100, 10, 'elsewhere');
commit;
select pg_temp.ok((select clock_out_time > now() - interval '1 minute' and clock_in_time > now() - interval '5 minutes'
  and total_hours < 0.1 and is_location_mismatch and clock_out_distance_m > 900
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'clock-out uses server time, flags far-away clock-out');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
select pg_temp.fails($$select attendance_clock_out((select v from ids where k = 'd1'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 11.96, 79.81, 10, 'x')$$, 'clock out twice');
rollback;

-- ── New phone: the old one stops working once the CEO approves the new one ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c02');
insert into ids values ('d2', register_attendance_device(:S2, 'Android · Chrome'));
commit;
select pg_temp.ok((select status = 'approved' from trusted_devices where id = (select v from ids where k = 'd1')), 'old phone still works while the new one waits');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c01');
select decide_attendance_device((select v from ids where k = 'd2'), 'approved');
commit;
select pg_temp.ok((select status = 'revoked' from trusted_devices where id = (select v from ids where k = 'd1'))
  and (select status = 'approved' from trusted_devices where id = (select v from ids where k = 'd2')), 'approving a new phone revokes the old one');

-- ── Site staff ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c03');
select pg_temp.fails($$select attendance_clock_in(null, null, 'site', null, 12.5, 79.5, 10, 'x')$$, 'site clock-in with no phone');
select pg_temp.ok((select count(*) from attendance) = 0, 'staff cannot see others'' attendance');
select pg_temp.ok((select count(*) from trusted_devices) = 0, 'staff cannot see others'' phones');
select pg_temp.ok((select count(*) from office_locations) = 1, 'staff can see the office location');
rollback;

-- ── CEO: no phone needed; can correct a record and hours follow ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7c01', false);
select attendance_clock_in(null, null, 'office', null, 11.9601, 79.8101, 10, 'office');
update attendance set clock_in_time = date_trunc('day', now()) + interval '9 hours', clock_out_time = date_trunc('day', now()) + interval '18 hours 30 minutes'
  where employee_id = '00000000-0000-0000-0000-0000000a7c02';
commit;
select pg_temp.ok((select total_hours = 9.5 and overtime_hours = 1.5 from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c02'), 'CEO correction recalculates hours');
select pg_temp.ok(exists (select 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000a7c01'), 'CEO clocks in without a phone');

select 'ALL ATTENDANCE CHECKS PASSED';
