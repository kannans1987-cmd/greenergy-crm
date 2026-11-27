-- Forgotten clock-outs: yesterday's open session must not block today, and is not closed by today's clock-out.
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
 ('00000000-0000-0000-0000-0000000f0e01', 'fg-ceo@gss.test',  now(), '{"full_name":"FG CEO"}'),
 ('00000000-0000-0000-0000-0000000f0e02', 'fg-tech@gss.test', now(), '{"full_name":"FG Tech"}'),
 ('00000000-0000-0000-0000-0000000f0e03', 'fg-desk@gss.test', now(), '{"full_name":"FG Desk"}');
update profiles set status = 'active' where email like 'fg-%@gss.test';
update profiles set role = 'admin' where email = 'fg-ceo@gss.test';
insert into office_locations (name, lat, lng, radius_m) values ('Office', 11.9600, 79.8100, 150);
insert into trusted_devices (id, employee_id, secret_hash, status) values
 ('f1000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000f0e02', _sha256_hex(repeat('6', 64)), 'approved'),
 ('f1000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000f0e03', _sha256_hex(repeat('8', 64)), 'approved');

-- Yesterday 6:44 PM-style sessions, never clocked out (14 hours ago)
insert into attendance (employee_id, work_type, date, clock_in_time, clock_in_lat, clock_in_lng) values
 ('00000000-0000-0000-0000-0000000f0e02', 'office', (now() at time zone 'Asia/Kolkata')::date - 1, now() - interval '14 hours', 11.9601, 79.8101),
 ('00000000-0000-0000-0000-0000000f0e03', 'office', (now() at time zone 'Asia/Kolkata')::date - 1, now() - interval '14 hours', 11.9601, 79.8101);

select pg_temp.ok(not attendance_session_is_current((now() at time zone 'Asia/Kolkata')::date - 1, now() - interval '14 hours'), 'yesterday 14 h ago is not current');
select pg_temp.ok(attendance_session_is_current((now() at time zone 'Asia/Kolkata')::date - 1, now() - interval '3 hours'), 'a shift past midnight is still current');

-- Clock-out the next morning refuses (no false 14-hour day); clock-in works and the CEO is told once
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e02');
select pg_temp.fails($$select attendance_clock_out('f1000000-0000-0000-0000-0000000000d2', repeat('6', 64), 11.9601, 79.8101, 10, 'Office')$$, 'clock-out closes yesterday');
select attendance_clock_in('f1000000-0000-0000-0000-0000000000d2', repeat('6', 64), 'office', null, 11.9601, 79.8101, 10, 'Office');
commit;
select pg_temp.ok((select count(*) = 2 from attendance where employee_id = '00000000-0000-0000-0000-0000000f0e02'), 'today''s session added');
select pg_temp.ok((select count(*) = 1 from notifications where title = 'Forgot to clock out' and user_id = '00000000-0000-0000-0000-0000000f0e01'), 'CEO told');

-- Office-type staff (once a day): yesterday's forgotten session does not use up today
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e03');
select attendance_clock_in('f1000000-0000-0000-0000-0000000000d3', repeat('8', 64), 'office', null, 11.9601, 79.8101, 10, 'Office');
commit;

-- Today's clock-out closes today's session, not yesterday's
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e02');
select attendance_clock_out('f1000000-0000-0000-0000-0000000000d2', repeat('6', 64), 11.9601, 79.8101, 10, 'Office');
select pg_temp.fails($$select attendance_clock_in('f1000000-0000-0000-0000-0000000000d2', repeat('6', 64), 'office', null, 11.9601, 79.8101, 10, 'Office')$$, 'office type clocks in twice today');
commit;
select pg_temp.ok((select clock_out_time is null from attendance where employee_id = '00000000-0000-0000-0000-0000000f0e02' and date < (now() at time zone 'Asia/Kolkata')::date), 'yesterday still open for the CEO');
select pg_temp.ok((select count(*) = 1 from notifications where title = 'Forgot to clock out' and message like 'FG Tech%'), 'told only once');

-- Staff cannot fix it themselves; the CEO sets the real time and hours follow
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e02');
update attendance set clock_out_time = now() - interval '10 hours' where employee_id = auth.uid() and clock_out_time is null;
commit;
select pg_temp.ok((select clock_out_time is null from attendance where employee_id = '00000000-0000-0000-0000-0000000f0e02' and date < (now() at time zone 'Asia/Kolkata')::date), 'staff cannot close the forgotten session');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e01');
update attendance set clock_out_time = clock_in_time + interval '4 hours 15 minutes'
  where employee_id = '00000000-0000-0000-0000-0000000f0e02' and clock_out_time is null;
commit;
select pg_temp.ok((select total_hours = 4.25 from attendance where employee_id = '00000000-0000-0000-0000-0000000f0e02' and date < (now() at time zone 'Asia/Kolkata')::date), 'CEO correction: 4.25 h');

select 'ALL FORGOTTEN CLOCK-OUT CHECKS PASSED';
