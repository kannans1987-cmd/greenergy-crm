-- Sr / Jr Admin Manager see everyone's attendance but cannot change it.
-- Run on a THROWAWAY database after the setup scripts (see README.md). Raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create or replace function pg_temp.act(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create or replace function pg_temp.try(stmt text) returns void language plpgsql as $$
begin execute stmt; exception when others then null; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- e01 CEO · e02 Sr · e03 Jr · e04 staff · e05 staff
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000a7e01', 'av-ceo@gss.test',   now(), '{"full_name":"AV CEO"}'),
 ('00000000-0000-0000-0000-0000000a7e02', 'av-sr@gss.test',    now(), '{"full_name":"AV Senior"}'),
 ('00000000-0000-0000-0000-0000000a7e03', 'av-jr@gss.test',    now(), '{"full_name":"AV Junior"}'),
 ('00000000-0000-0000-0000-0000000a7e04', 'av-staff@gss.test', now(), '{"full_name":"AV Staff"}'),
 ('00000000-0000-0000-0000-0000000a7e05', 'av-staff2@gss.test', now(), '{"full_name":"AV Staff 2"}');
update profiles set status = 'active' where email like 'av-%@gss.test';
update profiles set role = 'admin' where email = 'av-ceo@gss.test';
update profiles set allocation_level = 'senior' where email = 'av-sr@gss.test';
update profiles set allocation_level = 'junior' where email = 'av-jr@gss.test';

-- One session each for the two staff and the Sr (written as the owner, bypassing the clock-in checks)
set session_replication_role = replica;
insert into attendance (id, employee_id, date, work_type, clock_in_time, clock_out_time, total_hours) values
 ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e04', current_date, 'office', now() - interval '3 hours', null, null),
 ('a7000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000a7e05', current_date - 1, 'office', now() - interval '27 hours', now() - interval '19 hours', 8),
 ('a7000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000a7e02', current_date, 'office', now() - interval '2 hours', null, null);
set session_replication_role = origin;

-- Staff see only their own
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7e04');
select pg_temp.ok((select count(*) = 1 from attendance), 'staff see only their own attendance');
select pg_temp.ok(not can_view_team_attendance(), 'staff have no team view');
commit;

-- Sr and Jr see everyone (including each other)
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7e02');
select pg_temp.ok((select count(*) = 3 from attendance), 'Sr sees everyone');
select pg_temp.ok(can_view_team_attendance(), 'Sr has the team view');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7e03');
select pg_temp.ok((select count(*) = 3 from attendance), 'Jr sees everyone, the Sr too');
select pg_temp.ok(can_view_team_attendance(), 'Jr has the team view');

-- …but cannot change anything (rows silently untouched, or refused)
select pg_temp.try($$update attendance set clock_out_time = now(), total_hours = 9 where id = 'a7000000-0000-0000-0000-000000000001'$$);
select pg_temp.try($$delete from attendance where id = 'a7000000-0000-0000-0000-000000000002'$$);
commit;
select pg_temp.ok((select clock_out_time is null from attendance where id = 'a7000000-0000-0000-0000-000000000001'), 'Jr cannot set a clock-out');
select pg_temp.ok(exists (select 1 from attendance where id = 'a7000000-0000-0000-0000-000000000002'), 'Jr cannot delete attendance');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7e02');
select pg_temp.try($$insert into attendance (employee_id, date, work_type, clock_in_time) values ('00000000-0000-0000-0000-0000000a7e05', current_date, 'office', now())$$);
select pg_temp.try($$update profiles set attendance_mode = 'field' where id = '00000000-0000-0000-0000-0000000a7e04'$$);
commit;
select pg_temp.ok((select count(*) = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000a7e05'), 'Sr cannot clock someone in');

select pg_temp.ok((select coalesce(attendance_mode, 'office') = 'office' from profiles where id = '00000000-0000-0000-0000-0000000a7e04'), 'Sr cannot change attendance type');

-- Back to staff: the level goes, so does the view
update profiles set allocation_level = null where email = 'av-jr@gss.test';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a7e03');
select pg_temp.ok((select count(*) = 0 from attendance), 'former Jr no longer sees the team');
commit;

select 'ALL ATTENDANCE VIEW CHECKS PASSED';
