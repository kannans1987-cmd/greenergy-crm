-- Task delete checks: CEO only, audit copy, assignee told.
-- Run on a THROWAWAY database after the setup scripts (see README.md). Raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create or replace function pg_temp.act(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000c0c01', 'td-ceo@gss.test', now(), '{"full_name":"TD CEO"}'),
 ('00000000-0000-0000-0000-0000000c0c02', 'td-mgr@gss.test', now(), '{"full_name":"TD Manager"}'),
 ('00000000-0000-0000-0000-0000000c0c03', 'td-staff@gss.test', now(), '{"full_name":"TD Staff"}');
update profiles set status = 'active' where email like 'td-%@gss.test';
update profiles set role = 'admin' where email = 'td-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'td-mgr@gss.test';

insert into tasks (id, title, assigned_to, assigned_by, status) values
 ('70000000-0000-0000-0000-0000000000f1', 'Visit Lawspet site', '00000000-0000-0000-0000-0000000c0c03', '00000000-0000-0000-0000-0000000c0c02', 'pending'),
 ('70000000-0000-0000-0000-0000000000f2', 'Old done task',      '00000000-0000-0000-0000-0000000c0c03', '00000000-0000-0000-0000-0000000c0c02', 'completed');

-- Staff (the assignee) and the admin manager (who created it) cannot delete
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0c03');
delete from tasks where id = '70000000-0000-0000-0000-0000000000f1';
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0c02');
delete from tasks where id = '70000000-0000-0000-0000-0000000000f1';
commit;
select pg_temp.ok((select count(*) = 2 from tasks where id::text like '70000000-%'), 'only the CEO can delete');

-- CEO deletes both
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c0c01');
delete from tasks where id::text like '70000000-%';
commit;
select pg_temp.ok(not exists (select 1 from tasks where id::text like '70000000-%'), 'CEO deletes tasks');
select pg_temp.ok((select count(*) = 2 from audit_log where action_type = 'task_deleted' and action_by = '00000000-0000-0000-0000-0000000c0c01'
  and metadata->'task'->>'title' in ('Visit Lawspet site', 'Old done task')), 'copies kept in the audit log');
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c0c03' and title like 'A task given to you was removed%'),
  'assignee told only about the open task');

select 'ALL TASK DELETE CHECKS PASSED';
