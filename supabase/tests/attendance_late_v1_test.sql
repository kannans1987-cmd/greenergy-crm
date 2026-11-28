-- Office hours and late marks: start 09:40, 40 min grace → late from 10:21; first clock-in only; weekly off never late.
-- Run on a THROWAWAY database after the setup scripts (see README.md). Raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $f$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $f$;
create or replace function pg_temp.fails(stmt text, what text) returns void language plpgsql as $f$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have been refused): %', what;
end $f$;
create or replace function pg_temp.act(u text) returns void language sql as $f$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$f$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- e01 CEO · e02 A · e03 B · e04 C · e05 admin manager
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000c0e01', 'lt-ceo@gss.test', now(), '{"full_name":"LT CEO"}'),
 ('00000000-0000-0000-0000-0000000c0e02', 'lt-a@gss.test',   now(), '{"full_name":"LT A"}'),
 ('00000000-0000-0000-0000-0000000c0e03', 'lt-b@gss.test',   now(), '{"full_name":"LT B"}'),
 ('00000000-0000-0000-0000-0000000c0e04', 'lt-c@gss.test',   now(), '{"full_name":"LT C"}'),
 ('00000000-0000-0000-0000-0000000c0e05', 'lt-mgr@gss.test', now(), '{"full_name":"LT Manager"}');
update profiles set status = 'active' where email like 'lt-%@gss.test';
update profiles set role = 'admin' where email = 'lt-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'lt-mgr@gss.test';

select pg_temp.ok((select data ->> 'start' = '09:40' and (data ->> 'grace_minutes')::int = 40 from business_settings where key = 'office_hours'), 'default office hours');

-- Monday 30 Nov 2026 (the server records the real times; here they are written directly)
insert into attendance (id, employee_id, work_type, date, clock_in_time) values
 ('c7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0e02', 'site', '2026-11-30', '2026-11-30 10:20:59+05:30'),
 ('c7000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000c0e03', 'site', '2026-11-30', '2026-11-30 10:35:00+05:30'),
 ('c7000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000c0e04', 'site', '2026-11-30', '2026-11-30 09:05:00+05:30'),
 ('c7000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000c0e03', 'site', '2026-11-30', '2026-11-30 14:00:00+05:30');
select pg_temp.ok((select late_minutes = 0 from attendance where id = 'c7000000-0000-0000-0000-000000000001'), '10:20 is within the grace');
select pg_temp.ok((select late_minutes = 55 from attendance where id = 'c7000000-0000-0000-0000-000000000002'), '10:35 is 55 min late');
select pg_temp.ok((select late_minutes = 0 from attendance where id = 'c7000000-0000-0000-0000-000000000003'), 'early is on time');
select pg_temp.ok((select session_no = 2 and late_minutes = 0 from attendance where id = 'c7000000-0000-0000-0000-000000000004'), 'second session of the day is never late');

-- Told: the person and the CEO, only for the late one
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0e03' and title = 'Late today' and message like '%10:35 AM%55 min%'), 'B told about being late');
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0e01' and title = 'Late today: LT B'), 'CEO told');
select pg_temp.ok(not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0e02' and title = 'Late today'), 'A (on time) not told');

-- Sunday (weekly off) is never late
insert into attendance (employee_id, work_type, date, clock_in_time) values
 ('00000000-0000-0000-0000-0000000c0e02', 'site', '2026-11-29', '2026-11-29 11:30:00+05:30');
select pg_temp.ok((select late_minutes = 0 from attendance where employee_id = '00000000-0000-0000-0000-0000000c0e02' and date = '2026-11-29'), 'weekly off never late');

-- The CEO changes the rule: start 09:00, no grace, no staff notice
update business_settings set data = '{"start": "09:00", "end": "18:00", "grace_minutes": 0, "notify_staff": false, "notify_ceo": true}' where key = 'office_hours';
insert into attendance (employee_id, work_type, date, clock_in_time) values
 ('00000000-0000-0000-0000-0000000c0e02', 'site', '2026-12-01', '2026-12-01 09:01:00+05:30');
select pg_temp.ok((select late_minutes = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000c0e02' and date = '2026-12-01'), 'new rule applies');
select pg_temp.ok(not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0e02' and title = 'Late today'), 'staff notice switched off');
-- A broken setting falls back to the defaults instead of breaking clock-in
update business_settings set data = '{"start": "nonsense", "grace_minutes": "x"}' where key = 'office_hours';
insert into attendance (employee_id, work_type, date, clock_in_time) values
 ('00000000-0000-0000-0000-0000000c0e04', 'site', '2026-12-01', '2026-12-01 10:30:00+05:30');
select pg_temp.ok((select late_minutes = 50 from attendance where employee_id = '00000000-0000-0000-0000-0000000c0e04' and date = '2026-12-01'), 'bad setting → 09:40 + 40');

-- Excusing: CEO only, with a reason
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0e05');
select pg_temp.fails($f$select excuse_late('c7000000-0000-0000-0000-000000000002', true, 'EB office')$f$, 'admin manager excuses');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0e03');
select pg_temp.fails($f$select excuse_late('c7000000-0000-0000-0000-000000000002', true, 'my own excuse')$f$, 'staff excuse themselves');
update attendance set late_minutes = 0 where id = 'c7000000-0000-0000-0000-000000000002';   -- no policy: nothing changes
commit;
select pg_temp.ok((select late_minutes = 55 and not late_excused from attendance where id = 'c7000000-0000-0000-0000-000000000002'), 'late mark untouched');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0e01');
select pg_temp.fails($f$select excuse_late('c7000000-0000-0000-0000-000000000002', true, '')$f$, 'excuse without a reason');
select pg_temp.fails($f$select excuse_late('c7000000-0000-0000-0000-000000000001', true, 'not late')$f$, 'excuse a clock-in that was not late');
select excuse_late('c7000000-0000-0000-0000-000000000002', true, 'EB office visit first');
commit;
select pg_temp.ok((select late_excused and late_excuse_note = 'EB office visit first' and late_excused_by = '00000000-0000-0000-0000-0000000c0e01'
  and late_minutes = 55 from attendance where id = 'c7000000-0000-0000-0000-000000000002'), 'CEO excused it (minutes kept)');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0e03' and title = 'Late mark excused'), 'B told it was excused');

select 'ALL LATE MARK CHECKS PASSED';
