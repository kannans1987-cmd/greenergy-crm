-- Project delete checks: CEO only, never with a job card or quotation, reason, audit snapshot, what is kept.
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
 ('00000000-0000-0000-0000-0000000d0c01', 'pd-ceo@gss.test', now(), '{"full_name":"PD CEO"}'),
 ('00000000-0000-0000-0000-0000000d0c02', 'pd-mgr@gss.test', now(), '{"full_name":"PD Manager"}'),
 ('00000000-0000-0000-0000-0000000d0c03', 'pd-fit@gss.test', now(), '{"full_name":"PD Fitter"}');
update profiles set status = 'active' where email like 'pd-%@gss.test';
update profiles set role = 'admin' where email = 'pd-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'pd-mgr@gss.test';

-- A test project with a team member (→ field job card), a task and an attendance day
insert into projects (id, name, customer_name, status) values
 ('60000000-0000-0000-0000-0000000000e1', 'selvam', 'fdshfo', 'planning'),
 ('60000000-0000-0000-0000-0000000000e2', 'real job', 'Real customer', 'in_progress');
insert into project_employees (project_id, employee_id) values ('60000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000d0c03');
insert into tasks (title, project_id, assigned_to) values ('Check roof', '60000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000d0c03');
insert into attendance (employee_id, project_id, work_type, date, clock_in_time) values
 ('00000000-0000-0000-0000-0000000d0c03', '60000000-0000-0000-0000-0000000000e1', 'site', current_date - 3, now() - interval '3 days');
select pg_temp.ok((select count(*) = 1 from job_cards where project_id = '60000000-0000-0000-0000-0000000000e1'), 'field job card created on assignment');

-- The second project gets a numbered job card
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d0c01');
select create_job_card_for_ongoing('60000000-0000-0000-0000-0000000000e2', '{"current_stage":"design"}');
commit;

-- Admin manager and staff cannot delete; direct deletes are refused, even by the CEO
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d0c02');
select pg_temp.fails($$select delete_project('60000000-0000-0000-0000-0000000000e1', 'test')$$, 'admin manager deletes');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d0c01');
select pg_temp.fails($$delete from projects where id = '60000000-0000-0000-0000-0000000000e1'$$, 'direct delete bypassing the function');
select pg_temp.fails($$select delete_project('60000000-0000-0000-0000-0000000000e1', '  ')$$, 'delete without a reason');
select pg_temp.fails($$select delete_project('60000000-0000-0000-0000-0000000000e2', 'wrong')$$, 'delete a project with a job card');
select pg_temp.ok((select (project_delete_preview('60000000-0000-0000-0000-0000000000e1')->>'field_job_cards')::int = 1
  and (project_delete_preview('60000000-0000-0000-0000-0000000000e2')->>'can_delete')::boolean = false), 'preview shows what goes and blocks job cards');
select delete_project('60000000-0000-0000-0000-0000000000e1', 'Test entry from March');
commit;

select pg_temp.ok(not exists (select 1 from projects where id = '60000000-0000-0000-0000-0000000000e1'), 'CEO deletes the test project');
select pg_temp.ok(not exists (select 1 from job_cards where project_id = '60000000-0000-0000-0000-0000000000e1')
  and not exists (select 1 from project_employees where project_id = '60000000-0000-0000-0000-0000000000e1'), 'team and field job cards removed');
select pg_temp.ok((select project_id is null from tasks where title = 'Check roof'), 'task kept, link cleared');
select pg_temp.ok((select count(*) = 1 from attendance where employee_id = '00000000-0000-0000-0000-0000000d0c03' and project_id is null), 'attendance kept, link cleared');
select pg_temp.ok((select metadata->'project'->>'name' = 'selvam' and metadata->>'reason' = 'Test entry from March'
  and jsonb_array_length(metadata->'field_job_cards') = 1 from audit_log where action_type = 'project_deleted'), 'snapshot and reason in the audit log');
select pg_temp.ok(exists (select 1 from projects where id = '60000000-0000-0000-0000-0000000000e2'), 'job card project untouched');

select 'ALL PROJECT DELETE CHECKS PASSED';
