-- Sr / Jr Admin Manager: who may allocate work to whom (tasks, quotations, service jobs).
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

-- e01 CEO · e02 Sr (Kalyana) · e03 Jr (Deviga) · e04 staff · e05 technician
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000a1e01', 'al-ceo@gss.test',  now(), '{"full_name":"AL CEO"}'),
 ('00000000-0000-0000-0000-0000000a1e02', 'al-sr@gss.test',   now(), '{"full_name":"AL Senior"}'),
 ('00000000-0000-0000-0000-0000000a1e03', 'al-jr@gss.test',   now(), '{"full_name":"AL Junior"}'),
 ('00000000-0000-0000-0000-0000000a1e04', 'al-staff@gss.test', now(), '{"full_name":"AL Staff"}'),
 ('00000000-0000-0000-0000-0000000a1e05', 'al-tech@gss.test', now(), '{"full_name":"AL Tech"}');
update profiles set status = 'active' where email like 'al-%@gss.test';
update profiles set role = 'admin' where email = 'al-ceo@gss.test';
insert into quotation_requests (id, customer_name, mobile, city, status, source, assigned_sales_id) values
 ('a2000000-0000-0000-0000-0000000000a1', 'Allocated Home', '+91 90000 40001', 'Lawspet', 'new', 'phone', '00000000-0000-0000-0000-0000000a1e04');
insert into service_tickets (id, customer_name, description, kind, status, priority) values ('a2000000-0000-0000-0000-0000000000c1', 'Service Home', 'Inverter off', 'breakdown', 'open', 'normal');

-- Only the CEO sets the level
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
select pg_temp.fails($$update profiles set allocation_level = 'senior' where id = auth.uid()$$, 'gives self a level');
select pg_temp.fails($$insert into tasks (title, assigned_to) values ('x', '00000000-0000-0000-0000-0000000a1e04')$$, 'allocates before having a level');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e01');
update profiles set allocation_level = 'senior', designation = 'Sr Admin Manager' where id = '00000000-0000-0000-0000-0000000a1e02';
update profiles set allocation_level = 'junior', designation = 'Jr Admin Manager' where id = '00000000-0000-0000-0000-0000000a1e03';
commit;
select pg_temp.fails($$update profiles set allocation_level = 'boss' where id = '00000000-0000-0000-0000-0000000a1e04'$$, 'unknown level');

-- ═══ Tasks ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
insert into tasks (title, assigned_to, due_date) values ('Jr to staff', '00000000-0000-0000-0000-0000000a1e04', current_date + 1);
insert into tasks (title, assigned_to) values ('Jr to self', '00000000-0000-0000-0000-0000000a1e03');
select pg_temp.fails($$insert into tasks (title, assigned_to) values ('Jr to Sr', '00000000-0000-0000-0000-0000000a1e02')$$, 'Jr gives a task to the Sr');
select pg_temp.fails($$update tasks set assigned_to = '00000000-0000-0000-0000-0000000a1e02' where title = 'Jr to staff'$$, 'Jr moves a task to the Sr');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e02');
insert into tasks (title, assigned_to) values ('Sr to Jr', '00000000-0000-0000-0000-0000000a1e03');
insert into tasks (title, assigned_to) values ('Sr to staff', '00000000-0000-0000-0000-0000000a1e04');
insert into tasks (title, assigned_to) values ('Sr to CEO', '00000000-0000-0000-0000-0000000a1e01');
select pg_temp.ok((select count(*) >= 5 from tasks), 'Sr sees every task');
commit;
select pg_temp.ok((select assigned_by = '00000000-0000-0000-0000-0000000a1e03' from tasks where title = 'Jr to staff'), 'giver recorded by the database');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000a1e04' and title = 'New task for you'), 'staff told about the task');

-- Jr cannot touch a task the Sr gave; staff only update progress; staff cannot allocate
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
update tasks set title = 'changed by Jr' where title = 'Sr to staff';
commit;
select pg_temp.ok(exists (select 1 from tasks where title = 'Sr to staff'), 'Jr cannot edit the Sr''s task');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e04');
update tasks set status = 'in_progress', completion_notes = 'started' where title = 'Jr to staff';
select pg_temp.fails($$update tasks set assigned_to = '00000000-0000-0000-0000-0000000a1e05' where title = 'Jr to staff'$$, 'staff passes the task on');
select pg_temp.fails($$update tasks set due_date = current_date + 30 where title = 'Jr to staff'$$, 'staff moves the due date');
select pg_temp.fails($$insert into tasks (title, assigned_to) values ('staff task', '00000000-0000-0000-0000-0000000a1e05')$$, 'staff creates a task');
commit;
select pg_temp.ok((select status = 'in_progress' from tasks where title = 'Jr to staff'), 'staff updates progress');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
update tasks set assigned_to = '00000000-0000-0000-0000-0000000a1e05', priority = 'high' where title = 'Jr to staff';
commit;
select pg_temp.ok((select assigned_to = '00000000-0000-0000-0000-0000000a1e05' and priority = 'high' from tasks where title = 'Jr to staff'), 'Jr reassigns own task within the rule');

-- ═══ Quotations ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
select pg_temp.ok((select count(*) = 1 from quotation_requests where id = 'a2000000-0000-0000-0000-0000000000a1'), 'Jr sees quotations to allocate');
update quotation_requests set assigned_engineer_id = '00000000-0000-0000-0000-0000000a1e05', follow_up_manager_id = '00000000-0000-0000-0000-0000000a1e03'
  where id = 'a2000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($$update quotation_requests set follow_up_manager_id = '00000000-0000-0000-0000-0000000a1e02' where id = 'a2000000-0000-0000-0000-0000000000a1'$$, 'Jr gives the follow-up to the Sr');
select pg_temp.fails($$update quotation_requests set city = 'Changed' where id = 'a2000000-0000-0000-0000-0000000000a1'$$, 'Jr edits the quotation itself');
select pg_temp.fails($$update quotation_requests set status = 'cancelled' where id = 'a2000000-0000-0000-0000-0000000000a1'$$, 'Jr closes the quotation');
update quotation_requests set site_visit_at = now() + interval '1 day', status = 'site_visit_scheduled' where id = 'a2000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select count(*) = 0 from quotation_costings), 'Jr sees no supplier costing');
-- an enquiry logged by the Jr can go to someone else (not the Sr)
insert into quotation_requests (customer_name, mobile, status, source, assigned_sales_id) values ('Jr Enquiry', '+91 90000 40002', 'new', 'phone', '00000000-0000-0000-0000-0000000a1e04');
select pg_temp.fails($$insert into quotation_requests (customer_name, mobile, status, source, assigned_sales_id) values ('To Sr', '+91 90000 40003', 'new', 'phone', '00000000-0000-0000-0000-0000000a1e02')$$, 'Jr enquiry given to the Sr');
commit;
select pg_temp.ok((select assigned_engineer_id = '00000000-0000-0000-0000-0000000a1e05' and status = 'site_visit_scheduled' and city = 'Lawspet'
  from quotation_requests where id = 'a2000000-0000-0000-0000-0000000000a1'), 'Jr allocated the visit and planned it; nothing else changed');
select pg_temp.ok((select assigned_sales_id = '00000000-0000-0000-0000-0000000a1e04' from quotation_requests where customer_name = 'Jr Enquiry'), 'Jr enquiry kept the chosen preparer');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e02');
update quotation_requests set follow_up_manager_id = '00000000-0000-0000-0000-0000000a1e02' where id = 'a2000000-0000-0000-0000-0000000000a1';
commit;
select pg_temp.ok((select follow_up_manager_id = '00000000-0000-0000-0000-0000000a1e02' from quotation_requests where id = 'a2000000-0000-0000-0000-0000000000a1'), 'Sr gives work to anyone, incl. a Sr');
-- staff without a level still cannot reassign
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e04');
select pg_temp.fails($$update quotation_requests set assigned_engineer_id = '00000000-0000-0000-0000-0000000a1e04' where id = 'a2000000-0000-0000-0000-0000000000a1'$$, 'staff reassigns');
insert into quotation_requests (customer_name, mobile, status, source, assigned_sales_id) values ('Staff Enquiry', '+91 90000 40004', 'new', 'phone', '00000000-0000-0000-0000-0000000a1e05');
commit;
select pg_temp.ok((select assigned_sales_id = '00000000-0000-0000-0000-0000000a1e04' from quotation_requests where customer_name = 'Staff Enquiry'), 'staff enquiry stays with the staff member');

-- ═══ Service jobs ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
select pg_temp.ok((select count(*) = 1 from service_tickets), 'Jr sees service jobs');
update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000a1e05' where id = 'a2000000-0000-0000-0000-0000000000c1';
select pg_temp.fails($$update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000a1e02' where id = 'a2000000-0000-0000-0000-0000000000c1'$$, 'Jr gives a job to the Sr');
select pg_temp.fails($$update service_tickets set chargeable = true, charge_amount = 5000 where id = 'a2000000-0000-0000-0000-0000000000c1'$$, 'Jr sets the charge');
select pg_temp.fails($$update service_tickets set status = 'resolved', resolution_notes = 'x' where id = 'a2000000-0000-0000-0000-0000000000c1'$$, 'Jr closes the job');
commit;
select pg_temp.ok((select assigned_to = '00000000-0000-0000-0000-0000000a1e05' and status = 'assigned' from service_tickets where id = 'a2000000-0000-0000-0000-0000000000c1'), 'job given to the technician');

-- Taking the level away stops it
update profiles set allocation_level = null where id = '00000000-0000-0000-0000-0000000a1e03';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1e03');
select pg_temp.fails($$insert into tasks (title, assigned_to) values ('after', '00000000-0000-0000-0000-0000000a1e04')$$, 'allocates after the level is removed');
commit;

select 'ALL ALLOCATION LEVEL CHECKS PASSED';
