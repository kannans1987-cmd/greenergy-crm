-- Quotation access v1 checks: who may edit and delete quotations.
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
 ('00000000-0000-0000-0000-00000000acc1', 'qa-ceo@gss.test',      now(), '{"full_name":"QA CEO"}'),
 ('00000000-0000-0000-0000-00000000ac01', 'qa-manager@gss.test',  now(), '{"full_name":"QA Manager"}'),
 ('00000000-0000-0000-0000-00000000acd1', 'qa-delegate@gss.test', now(), '{"full_name":"QA Delegate"}'),
 ('00000000-0000-0000-0000-00000000ac51', 'qa-sales@gss.test',    now(), '{"full_name":"QA Sales"}');
update profiles set status = 'active' where email like 'qa-%@gss.test';
update profiles set role = 'admin'        where email = 'qa-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'qa-manager@gss.test';

-- Three quotations owned by someone else
insert into quotation_requests (id, customer_name, mobile, status, region, assigned_sales_id) values
 ('20000000-0000-0000-0000-0000000000a1', 'Wrong one', '9000000001', 'new', 'puducherry', null),
 ('20000000-0000-0000-0000-0000000000a2', 'Keep me',   '9000000002', 'drafted', 'puducherry', '00000000-0000-0000-0000-00000000ac51'),
 ('20000000-0000-0000-0000-0000000000a3', 'Job card',  '9000000003', 'new', 'puducherry', null);
insert into quotation_line_items (quotation_id, description, quantity, unit_price) values ('20000000-0000-0000-0000-0000000000a1', 'x', 1, 10);
update quotation_requests set job_number = 'GSS/JC/2026-27/9999', status = 'project_created' where id = '20000000-0000-0000-0000-0000000000a3';

-- Only the CEO can give the access
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000ac01');
update profiles set quotation_access = true where email = 'qa-delegate@gss.test';   -- not their row: silently 0 rows
select pg_temp.fails($$update profiles set quotation_access = true where id = '00000000-0000-0000-0000-00000000ac01'$$, 'admin manager gives itself quotation access');
commit;
select pg_temp.ok((select not quotation_access from profiles where email = 'qa-delegate@gss.test'), 'admin manager cannot give quotation access');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acd1');
select pg_temp.fails($$update profiles set quotation_access = true where id = '00000000-0000-0000-0000-00000000acd1'$$, 'staff gives itself quotation access');
rollback;

-- Plain staff: cannot see or delete others' quotations
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acd1');
select pg_temp.ok((select count(*) from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1') = 0, 'staff without access cannot see others');
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1';
rollback;
select pg_temp.ok(exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1'), 'staff without access cannot delete');

-- Admin manager: still edits, but cannot delete
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000ac01');
update quotation_requests set city = 'Lawspet' where id = '20000000-0000-0000-0000-0000000000a1';
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1';
commit;
select pg_temp.ok((select city = 'Lawspet' from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1'), 'admin manager can still edit');
select pg_temp.ok(exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1'), 'admin manager cannot delete by default');

-- CEO gives the delegate access
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acc1');
update profiles set quotation_access = true where email = 'qa-delegate@gss.test';
commit;
select pg_temp.ok((select quotation_access from profiles where email = 'qa-delegate@gss.test'), 'CEO gives quotation access');

-- Delegate: sees all, edits others', deletes a wrong one; line items go with it
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acd1');
select pg_temp.ok((select count(*) from quotation_requests where id::text like '20000000-%') = 3, 'delegate sees every quotation');
update quotation_requests set customer_name = 'Keep me (fixed)' where id = '20000000-0000-0000-0000-0000000000a2';
select pg_temp.ok((select count(*) from quotation_line_items where quotation_id = '20000000-0000-0000-0000-0000000000a1') = 1, 'delegate sees line items');
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1';
commit;
select pg_temp.ok((select customer_name = 'Keep me (fixed)' from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2'), 'delegate edits another person''s quotation');
select pg_temp.ok(not exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a1'), 'delegate deletes a quotation');
select pg_temp.ok(not exists (select 1 from quotation_line_items where quotation_id = '20000000-0000-0000-0000-0000000000a1'), 'line items deleted with it');

-- Nobody deletes a job-card quotation, not even the CEO or the server
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acc1');
select pg_temp.fails($$delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a3'$$, 'CEO deletes a job-card quotation');
rollback;
select pg_temp.fails($$delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a3'$$, 'server deletes a job-card quotation');

-- Access removed → no more deleting; deactivated delegate has no access either
update profiles set quotation_access = false where email = 'qa-delegate@gss.test';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acd1');
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2';
commit;
select pg_temp.ok(exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2'), 'removed access stops deleting');
update profiles set quotation_access = true, status = 'inactive' where email = 'qa-delegate@gss.test';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acd1');
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2';
commit;
select pg_temp.ok(exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2'), 'inactive delegate cannot delete');

-- CEO can delete
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000acc1');
delete from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2';
commit;
select pg_temp.ok(not exists (select 1 from quotation_requests where id = '20000000-0000-0000-0000-0000000000a2'), 'CEO deletes a quotation');

select 'ALL QUOTATION ACCESS CHECKS PASSED';
