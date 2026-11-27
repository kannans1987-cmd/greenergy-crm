-- Project Manager: gives work to technicians, helpers and Jr Admin Managers, never to a Sr Admin Manager.
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

-- e01 CEO · e02 Sr · e03 Jr · e04 PM · e05 Solar Technician · e06 Helper · e07 sales staff
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000b0e01', 'pm-ceo@gss.test',   now(), '{"full_name":"PM CEO"}'),
 ('00000000-0000-0000-0000-0000000b0e02', 'pm-sr@gss.test',    now(), '{"full_name":"PM Senior"}'),
 ('00000000-0000-0000-0000-0000000b0e03', 'pm-jr@gss.test',    now(), '{"full_name":"PM Junior"}'),
 ('00000000-0000-0000-0000-0000000b0e04', 'pm-pm@gss.test',    now(), '{"full_name":"PM Project"}'),
 ('00000000-0000-0000-0000-0000000b0e05', 'pm-tech@gss.test',  now(), '{"full_name":"PM Tech"}'),
 ('00000000-0000-0000-0000-0000000b0e06', 'pm-help@gss.test',  now(), '{"full_name":"PM Helper"}'),
 ('00000000-0000-0000-0000-0000000b0e07', 'pm-sales@gss.test', now(), '{"full_name":"PM Sales"}');
update profiles set status = 'active' where email like 'pm-%@gss.test';
update profiles set role = 'admin' where email = 'pm-ceo@gss.test';
update profiles set allocation_level = 'senior', designation = 'Sr Admin Manager' where email = 'pm-sr@gss.test';
update profiles set allocation_level = 'junior', designation = 'Jr Admin Manager' where email = 'pm-jr@gss.test';
update profiles set designation = 'Solar Technician' where email = 'pm-tech@gss.test';
update profiles set designation = 'Site Helper' where email = 'pm-help@gss.test';
update profiles set designation = 'Sales Executive' where email = 'pm-sales@gss.test';

-- Only the CEO makes someone Project Manager
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
select pg_temp.fails($f$update profiles set allocation_level = 'project' where id = auth.uid()$f$, 'gives self the PM level');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e01');
update profiles set allocation_level = 'project', designation = 'Project Manager' where id = '00000000-0000-0000-0000-0000000b0e04';
commit;

insert into quotation_requests (id, customer_name, mobile, city, status, source, assigned_sales_id) values
 ('b2000000-0000-0000-0000-0000000000a1', 'PM Home', '+91 90000 50001', 'Lawspet', 'new', 'phone', '00000000-0000-0000-0000-0000000b0e07');
insert into service_tickets (id, customer_name, description, kind, status, priority) values
 ('b2000000-0000-0000-0000-0000000000c1', 'PM Service Home', 'Inverter off', 'breakdown', 'open', 'normal');

-- ═══ Tasks ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
insert into tasks (title, assigned_to) values ('PM to tech', '00000000-0000-0000-0000-0000000b0e05');
insert into tasks (title, assigned_to) values ('PM to helper', '00000000-0000-0000-0000-0000000b0e06');
insert into tasks (title, assigned_to) values ('PM to Jr', '00000000-0000-0000-0000-0000000b0e03');
insert into tasks (title, assigned_to) values ('PM to self', '00000000-0000-0000-0000-0000000b0e04');
select pg_temp.fails($f$insert into tasks (title, assigned_to) values ('PM to Sr', '00000000-0000-0000-0000-0000000b0e02')$f$, 'PM gives a task to the Sr');
select pg_temp.fails($f$insert into tasks (title, assigned_to) values ('PM to sales', '00000000-0000-0000-0000-0000000b0e07')$f$, 'PM gives a task to sales staff');
select pg_temp.fails($f$insert into tasks (title, assigned_to) values ('PM to CEO', '00000000-0000-0000-0000-0000000b0e01')$f$, 'PM gives a task to the CEO');
select pg_temp.fails($f$update tasks set assigned_to = '00000000-0000-0000-0000-0000000b0e02' where title = 'PM to tech'$f$, 'PM moves a task to the Sr');
update tasks set assigned_to = '00000000-0000-0000-0000-0000000b0e06' where title = 'PM to tech';   -- tech → helper: fine
commit;
select pg_temp.ok((select count(*) = 4 from tasks where title like 'PM to %'), 'PM gave four tasks');
select pg_temp.ok((select assigned_to = '00000000-0000-0000-0000-0000000b0e06' from tasks where title = 'PM to tech'), 'PM moved a task within the crew');

-- The Jr (and Sr) can still give work to the PM
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e03');
insert into tasks (title, assigned_to) values ('Jr to PM', '00000000-0000-0000-0000-0000000b0e04');
commit;

-- ═══ Service jobs ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
select pg_temp.fails($f$update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000b0e02' where id = 'b2000000-0000-0000-0000-0000000000c1'$f$, 'PM gives a job to the Sr');
select pg_temp.fails($f$update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000b0e07' where id = 'b2000000-0000-0000-0000-0000000000c1'$f$, 'PM gives a job to sales');
update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000b0e05' where id = 'b2000000-0000-0000-0000-0000000000c1';
commit;
select pg_temp.ok((select assigned_to = '00000000-0000-0000-0000-0000000b0e05' from service_tickets where id = 'b2000000-0000-0000-0000-0000000000c1'), 'PM gave the service job to the technician');

-- ═══ Quotations: site visit to the technician, never the Sr ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
select pg_temp.ok((select count(*) = 1 from quotation_requests where id = 'b2000000-0000-0000-0000-0000000000a1'), 'PM sees quotations');
select pg_temp.ok((select count(*) = 0 from quotation_costings), 'PM sees no supplier costing');
update quotation_requests set assigned_engineer_id = '00000000-0000-0000-0000-0000000b0e05' where id = 'b2000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($f$update quotation_requests set follow_up_manager_id = '00000000-0000-0000-0000-0000000b0e02' where id = 'b2000000-0000-0000-0000-0000000000a1'$f$, 'PM gives follow-up to the Sr');
commit;
select pg_temp.ok((select assigned_engineer_id = '00000000-0000-0000-0000-0000000b0e05' from quotation_requests where id = 'b2000000-0000-0000-0000-0000000000a1'), 'PM sent the technician on the site visit');

-- PM sees team attendance (view only) but does not approve leave
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
select pg_temp.ok(can_view_team_attendance(), 'PM sees team attendance');
select pg_temp.ok(not leave_reviewer(), 'PM does not approve leave');
commit;

-- A crew member who becomes Sr is no longer the PM's to allocate
update profiles set allocation_level = 'senior' where id = '00000000-0000-0000-0000-0000000b0e05';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0e04');
select pg_temp.fails($f$insert into tasks (title, assigned_to) values ('PM to tech now Sr', '00000000-0000-0000-0000-0000000b0e05')$f$, 'PM gives work to a technician who is now Sr');
commit;

select 'ALL PROJECT MANAGER CHECKS PASSED';
