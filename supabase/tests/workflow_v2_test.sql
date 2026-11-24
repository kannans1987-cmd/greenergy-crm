-- Workflow v2 checks. Run against a THROWAWAY database after the setup scripts
-- (see supabase/tests/README.md). Every check raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create or replace function pg_temp.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have been refused): %', what;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- People
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1', 'ceo@gss.test',     now(), '{"full_name":"Kannan CEO"}'),
 ('00000000-0000-0000-0000-0000000000a1', 'manager@gss.test', now(), '{"full_name":"Priya Manager"}'),
 ('00000000-0000-0000-0000-0000000000b1', 'sales@gss.test',   now(), '{"full_name":"Ravi Sales"}'),
 ('00000000-0000-0000-0000-0000000000b2', 'sales2@gss.test',  now(), '{"full_name":"Other Sales"}'),
 ('00000000-0000-0000-0000-0000000000d1', 'officer@gss.test', now(), '{"full_name":"Arun Officer"}'),
 ('00000000-0000-0000-0000-0000000000e1', 'intruder@x.test',  null,  '{"full_name":"Intruder","role":"admin"}');
update profiles set role = 'admin'        where email = 'ceo@gss.test';
update profiles set role = 'task_manager' where email = 'manager@gss.test';

select pg_temp.ok((select role = 'employee' and status = 'inactive' from profiles where email = 'intruder@x.test'),
                  'public sign-up cannot make itself admin and gets no access');

-- Helper to act as a user inside a transaction
create or replace function pg_temp.act(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
grant execute on function pg_temp.act(text) to authenticated;

-- ── Sales creates a quotation ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
insert into quotation_requests (id, customer_name, mobile, consumer_type, solar_type, region, status, assigned_sales_id,
                                follow_up_manager_id, admin_capacity_kw, admin_total_cost, central_subsidy, state_subsidy)
values ('10000000-0000-0000-0000-000000000001', 'Selvam', '9876543210', 'domestic', 'ongrid', 'puducherry', 'drafted',
        '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 3, 210000, 78000, 30000);
select pg_temp.ok((select assigned_sales_id = '00000000-0000-0000-0000-0000000000b1' and created_by = '00000000-0000-0000-0000-0000000000b1'
                     from quotation_requests where id = '10000000-0000-0000-0000-000000000001'), 'sales quotation is assigned to its author');
select pg_temp.fails($$insert into quotation_requests (customer_name, mobile, status) values ('X', '1', 'approved')$$, 'create already approved');
insert into quotation_line_items (quotation_id, description, quantity, unit_price) values ('10000000-0000-0000-0000-000000000001', 'Elevated structure', 1, 18000);
update quotation_requests set status = 'owner_approval_pending' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.fails($$update quotation_requests set status = 'approved' where id = '10000000-0000-0000-0000-000000000001'$$, 'sales approves');
commit;

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok((select count(*) = 0 from quotation_requests), 'other sales staff cannot see the quotation');
commit;

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$update quotation_requests set status = 'approved' where id = '10000000-0000-0000-0000-000000000001'$$, 'admin manager approves');
commit;

select pg_temp.ok((select count(*) = 1 from notifications n join profiles p on p.id = n.user_id where p.role = 'admin' and n.title like '%approval%'),
                  'CEO notified of pending approval');

-- ── CEO approves ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update quotation_requests set status = 'approved', approved_by = '00000000-0000-0000-0000-0000000000b1' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.ok((select approved_by = '00000000-0000-0000-0000-0000000000c1' and approved_by_name = 'Kannan CEO' and approved_at is not null
                     from quotation_requests where id = '10000000-0000-0000-0000-000000000001'), 'approval stamped with the CEO, not the client value');
commit;

-- ── Sales shares, follows up, marks hot ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($$update quotation_requests set admin_total_cost = 150000 where id = '10000000-0000-0000-0000-000000000001'$$, 'price change after approval');
select pg_temp.fails($$insert into quotation_line_items (quotation_id, description, quantity, unit_price) values ('10000000-0000-0000-0000-000000000001', 'Extra', 1, 1)$$, 'line item after approval');
select pg_temp.fails($$update quotation_requests set lead_temperature = 'hot' where id = '10000000-0000-0000-0000-000000000001'$$, 'hot before sharing');
select pg_temp.fails($$update quotation_requests set follow_up_manager_id = null where id = '10000000-0000-0000-0000-000000000001'$$, 'sales reassigns');
update quotation_requests set status = 'sent_to_customer' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.ok((select next_follow_up_date = current_date + 1 and sent_to_customer_at is not null from quotation_requests where id = '10000000-0000-0000-0000-000000000001'), 'share sets first follow-up');
insert into quotation_follow_ups (quotation_id, contact_type, notes, temperature, next_follow_up_date)
values ('10000000-0000-0000-0000-000000000001', 'call', 'Wants it before Pongal', 'hot', current_date + 3);
select pg_temp.ok((select lead_temperature = 'hot' and follow_up_count = 1 and next_follow_up_date = current_date + 3
                     from quotation_requests where id = '10000000-0000-0000-0000-000000000001'), 'follow-up updates hot, count and next date');
select pg_temp.ok((select created_by_name = 'Ravi Sales' from quotation_follow_ups limit 1), 'follow-up author name recorded');
select pg_temp.fails($$select convert_quotation_to_project('10000000-0000-0000-0000-000000000001')$$, 'sales creates job card');
commit;
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and title like '%follow up%'), 'admin manager notified');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$select convert_quotation_to_project('10000000-0000-0000-0000-000000000001')$$, 'job card before customer accepts');
commit;

-- ── Customer accepts on the portal (server, no user) ──
update quotation_requests set status = 'customer_accepted', accepted_via = 'portal', accepted_by_name = 'Selvam'
 where portal_token = (select portal_token from quotation_requests where id = '10000000-0000-0000-0000-000000000001') and status = 'sent_to_customer';
select pg_temp.ok((select customer_response_at is not null from quotation_requests where id = '10000000-0000-0000-0000-000000000001'), 'portal acceptance time recorded');

-- ── Admin manager creates the numbered job card ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select convert_quotation_to_project('10000000-0000-0000-0000-000000000001')->>'job_number'
                     = 'GSS/JC/' || fy_label((now() at time zone 'Asia/Kolkata')::date) || '/0001'), 'first job card number');
select pg_temp.fails($$select convert_quotation_to_project('10000000-0000-0000-0000-000000000001')$$, 'convert twice');
select pg_temp.fails($$update quotation_requests set notes = 'x' where id = '10000000-0000-0000-0000-000000000001'$$, 'edit after job card');
commit;

select pg_temp.ok((select count(*) = 23 and count(*) filter (where status = 'skipped') = 0 from project_stage_history), 'subsidy job has all 23 milestones');
select pg_temp.ok((select sum(amount) = 210000 and count(*) = 3 from project_payments), 'payments 50/40/10 add up to the order value');
select pg_temp.ok(fy_label('2027-03-31') = '2026-27' and fy_label('2027-04-01') = '2027-28', 'financial year label');

-- ── CEO appoints the officer; officer tracks milestones ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails($$update projects set admin_officer_id = '00000000-0000-0000-0000-0000000000d1'$$, 'admin manager appoints officer');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update projects set admin_officer_id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.fails($$update projects set job_number = 'X'$$, 'job number edited');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
update project_stage_history set status = 'completed' where stage_code = 'order_confirmed';
select pg_temp.ok((select actual_date is not null and completed_at is not null and updated_by_name = 'Arun Officer'
                     from project_stage_history where stage_code = 'order_confirmed'), 'officer completes a milestone');
select pg_temp.fails($$update projects set admin_officer_id = null$$, 'officer removes themselves');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
update project_stage_history set status = 'completed' where stage_code = 'site_survey';
select pg_temp.ok((select count(*) = 0 from project_stage_history), 'unrelated staff see no milestones');
commit;
select pg_temp.ok((select status = 'pending' from project_stage_history where stage_code = 'site_survey'), 'unrelated staff changed nothing');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((select count(*) = 1 from projects), 'sales sees the job card of their own quotation');
commit;

-- ── Second quotation: revise clears approval and link; cold cannot convert; numbers continue ──
insert into quotation_requests (id, customer_name, mobile, consumer_type, solar_type, region, status, assigned_sales_id, admin_total_cost, central_subsidy)
values ('10000000-0000-0000-0000-000000000002', 'Business', '9000000000', 'commercial', 'ongrid', 'tamilnadu', 'owner_approval_pending',
        '00000000-0000-0000-0000-0000000000b1', 500000, 0);
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update quotation_requests set status = 'approved' where id = '10000000-0000-0000-0000-000000000002';
update quotation_requests set status = 'sent_to_customer' where id = '10000000-0000-0000-0000-000000000002';
create temp table tok as select portal_token from quotation_requests where id = '10000000-0000-0000-0000-000000000002';
update quotation_requests set status = 'drafted' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.ok((select revision = 2 and approved_by is null and portal_token <> (select portal_token from tok)
                     from quotation_requests where id = '10000000-0000-0000-0000-000000000002'), 'revise: new revision, approval cleared, old link dead');
update quotation_requests set admin_total_cost = 480000, status = 'owner_approval_pending' where id = '10000000-0000-0000-0000-000000000002';
update quotation_requests set status = 'approved' where id = '10000000-0000-0000-0000-000000000002';
update quotation_requests set status = 'sent_to_customer' where id = '10000000-0000-0000-0000-000000000002';
update quotation_requests set status = 'customer_accepted', lead_temperature = 'cold' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.fails($$select convert_quotation_to_project('10000000-0000-0000-0000-000000000002')$$, 'cold quotation converted');
update quotation_requests set lead_temperature = 'hot' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.ok((select convert_quotation_to_project('10000000-0000-0000-0000-000000000002')->>'job_number' like '%/0002'), 'numbers continue in sequence');
commit;
select pg_temp.ok((select count(*) = 4 from project_stage_history s join projects p on p.id = s.project_id
                    where p.job_number like '%/0002' and s.status = 'skipped'), 'non-subsidy job skips the 4 subsidy milestones');

-- ── Anonymous visitors ──
begin; set local role anon; select set_config('request.jwt.claim.sub', '', true);
select pg_temp.fails($$insert into quotation_requests (customer_name, mobile, status) values ('Spam', '1', 'approved')$$, 'anonymous insert');
select pg_temp.ok((select count(*) = 0 from quotation_requests), 'anonymous cannot read quotations');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((select count(*) = 0 from quotation_requests) and not is_staff(), 'inactive self-sign-up sees nothing');
commit;

select 'ALL WORKFLOW CHECKS PASSED' as result;
