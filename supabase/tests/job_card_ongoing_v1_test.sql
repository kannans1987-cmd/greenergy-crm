-- Job cards for ongoing projects: numbering, milestones from the current stage, opening balance, who may do it.
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
 ('00000000-0000-0000-0000-0000000b0c01', 'og-ceo@gss.test',   now(), '{"full_name":"OG CEO"}'),
 ('00000000-0000-0000-0000-0000000b0c02', 'og-mgr@gss.test',   now(), '{"full_name":"OG Manager"}'),
 ('00000000-0000-0000-0000-0000000b0c03', 'og-staff@gss.test', now(), '{"full_name":"OG Staff"}');
update profiles set status = 'active' where email like 'og-%@gss.test';
update profiles set role = 'admin' where email = 'og-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'og-mgr@gss.test';

-- An old project record without a job card (as created by the old All Projects page)
insert into projects (id, name, customer_name, site_address, project_type, capacity_kwp, start_date, status)
values ('50000000-0000-0000-0000-0000000000d1', 'pinakin', 'kini', 'reddiyarpalayam', 'residential', 5, '2026-03-16', 'in_progress');

-- Staff cannot; nobody can type a job number by hand
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
select pg_temp.fails($$select create_job_card_for_ongoing('50000000-0000-0000-0000-0000000000d1', '{}')$$, 'staff creates a job card');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c01');
select pg_temp.fails($$update projects set job_number = 'GSS/JC/X/1' where id = '50000000-0000-0000-0000-0000000000d1'$$, 'job number typed by hand');
rollback;

-- Admin manager gives the old project a job card: panels already installed, ₹2,00,000 of ₹3,10,000 received
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c02');
select pg_temp.fails($$select create_job_card_for_ongoing('50000000-0000-0000-0000-0000000000d1', '{"order_value": 100, "received": 500}')$$, 'received more than the order');
select create_job_card_for_ongoing('50000000-0000-0000-0000-0000000000d1',
  '{"customer_mobile":"9000000031","order_value":310000,"received":200000,"current_stage":"inverter_electrical","subsidy_job":true,"region":"puducherry","legacy_ref":"JC-OLD-17","admin_officer_id":"00000000-0000-0000-0000-0000000b0c03"}');
commit;
select pg_temp.ok((select job_number like 'GSS/JC/%/0001' and legacy_ref = 'JC-OLD-17' and onboarded_at is not null and customer_mobile = '9000000031'
  and admin_officer_id is null from projects where id = '50000000-0000-0000-0000-0000000000d1'), 'numbered, old ref kept, officer left to the CEO');
select pg_temp.ok((select count(*) = 9 from project_stage_history where project_id = '50000000-0000-0000-0000-0000000000d1' and status = 'completed'), 'stages before the current one are done (subsidy ones included)');
select pg_temp.ok((select status = 'in_progress' from project_stage_history where project_id = '50000000-0000-0000-0000-0000000000d1' and stage_code = 'inverter_electrical'), 'current stage in progress');
select pg_temp.ok((select count(*) = 13 from project_stage_history where project_id = '50000000-0000-0000-0000-0000000000d1' and status = 'pending'), 'later stages pending');
select pg_temp.ok((select sum(amount) filter (where status = 'paid') = 200000 and sum(amount) filter (where status = 'pending') = 110000
  from project_payments where project_id = '50000000-0000-0000-0000-0000000000d1'), 'opening balance: received and balance due');

-- Not twice
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c01');
select pg_temp.fails($$select create_job_card_for_ongoing('50000000-0000-0000-0000-0000000000d1', '{}')$$, 'second job card for the same project');
-- CEO enters a brand-new ongoing project in one step, appoints the officer; no subsidy → subsidy stages skipped
select create_job_card_for_ongoing(null, '{"customer_name":"Ramesh K","customer_mobile":"9000000032","capacity_kwp":"3","project_type":"residential","order_value":"190000","received":"95000","start_date":"2026-10-01","current_stage":"material_delivery","admin_officer_id":"00000000-0000-0000-0000-0000000b0c03"}');
commit;
select pg_temp.ok((select job_number like 'GSS/JC/%/0002' and admin_officer_id = '00000000-0000-0000-0000-0000000b0c03' and status = 'in_progress'
  from projects where customer_name = 'Ramesh K'), 'new ongoing project numbered next, officer appointed');
select pg_temp.ok((select count(*) = 4 from project_stage_history h join projects p on p.id = h.project_id where p.customer_name = 'Ramesh K' and h.status = 'skipped'), 'no subsidy: subsidy stages skipped');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000b0c03' and title like 'You are the administrative officer%'), 'officer notified');
select pg_temp.ok((select count(*) = 2 from audit_log where action_type = 'job_card_ongoing'), 'both recorded in the audit log');

-- The officer can now track milestones on it
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
update project_stage_history set status = 'completed' where stage_code = 'material_delivery'
  and project_id = (select id from projects where customer_name = 'Ramesh K');
commit;
select pg_temp.ok((select h.status = 'completed' from project_stage_history h join projects p on p.id = h.project_id
  where p.customer_name = 'Ramesh K' and h.stage_code = 'material_delivery'), 'officer updates a milestone');

select 'ALL ONGOING JOB CARD CHECKS PASSED';
