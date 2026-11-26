-- Quotation work allocation checks: site visit person, preparer, follow-up person, CEO approval.
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
 ('00000000-0000-0000-0000-0000000a1c01', 'al-ceo@gss.test',     now(), '{"full_name":"AL CEO"}'),
 ('00000000-0000-0000-0000-0000000a1c02', 'al-manager@gss.test', now(), '{"full_name":"AL Manager"}'),
 ('00000000-0000-0000-0000-0000000a1c03', 'al-visit@gss.test',   now(), '{"full_name":"AL Visitor"}'),
 ('00000000-0000-0000-0000-0000000a1c04', 'al-prep@gss.test',    now(), '{"full_name":"AL Preparer"}'),
 ('00000000-0000-0000-0000-0000000a1c05', 'al-fu@gss.test',      now(), '{"full_name":"AL FollowUp"}'),
 ('00000000-0000-0000-0000-0000000a1c06', 'al-other@gss.test',   now(), '{"full_name":"AL Other"}');
update profiles set status = 'active' where email like 'al-%@gss.test';
update profiles set role = 'admin' where email = 'al-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'al-manager@gss.test';

-- A website enquiry (no user)
insert into quotation_requests (id, customer_name, mobile, city, status, region)
  values ('30000000-0000-0000-0000-0000000000b1', 'Allocation test', '9000000011', 'Lawspet', 'new', 'puducherry');

-- Plain staff cannot hand out work
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c06');
select pg_temp.ok((select count(*) from quotation_requests where id = '30000000-0000-0000-0000-0000000000b1') = 0, 'unassigned staff cannot see the enquiry');
rollback;

-- Admin manager allocates the three jobs and the visit date
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c02');
update quotation_requests set assigned_engineer_id = '00000000-0000-0000-0000-0000000a1c03',
  assigned_sales_id = '00000000-0000-0000-0000-0000000a1c04', follow_up_manager_id = '00000000-0000-0000-0000-0000000a1c05',
  site_visit_at = now() + interval '1 day', status = 'site_visit_scheduled'
  where id = '30000000-0000-0000-0000-0000000000b1';
commit;
select pg_temp.ok((select count(*) from notifications where link = '/staff/quotations/30000000-0000-0000-0000-0000000000b1'
  and title in ('Site visit given to you', 'Quotation to prepare', 'Customer follow-up given to you')) = 3, 'three people notified');

-- Site-visit person: records the visit, cannot price or reassign
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c03');
select pg_temp.fails($$update quotation_requests set price_per_kw = 1 where id = '30000000-0000-0000-0000-0000000000b1'$$, 'visitor changes the price');
select pg_temp.fails($$update quotation_requests set assigned_sales_id = '00000000-0000-0000-0000-0000000a1c03' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'visitor reassigns');
select pg_temp.fails($$update quotation_requests set status = 'owner_approval_pending' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'visitor submits for approval');
update quotation_requests set status = 'site_visit_done', site_visit_done_at = now(), site_visit_notes = 'RCC roof, 600 sq ft shadow-free',
  roof_type = 'rcc', available_roof_area_sqft = 600, site_visit_lat = 11.95, site_visit_lng = 79.80
  where id = '30000000-0000-0000-0000-0000000000b1';
commit;
select pg_temp.ok((select status = 'site_visit_done' and roof_type = 'rcc' from quotation_requests where id = '30000000-0000-0000-0000-0000000000b1'), 'visitor records the visit');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000a1c04' and title like 'Site visit done%'), 'preparer told the visit is done');

-- Follow-up person cannot touch the draft
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c05');
select pg_temp.fails($$update quotation_requests set customer_name = 'x' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'follow-up edits the draft');
select pg_temp.fails($$update quotation_requests set status = 'owner_approval_pending' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'follow-up submits');
rollback;

-- Preparer prices it and submits; cannot approve
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c04');
update quotation_requests set admin_capacity_kw = 3, price_per_kw = 60000, admin_total_cost = 196020, status = 'drafted' where id = '30000000-0000-0000-0000-0000000000b1';
update quotation_requests set status = 'owner_approval_pending' where id = '30000000-0000-0000-0000-0000000000b1';
select pg_temp.fails($$update quotation_requests set status = 'approved' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'preparer approves');
commit;

-- Admin manager cannot approve either; the CEO approves
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c02');
select pg_temp.fails($$update quotation_requests set status = 'approved' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'admin manager approves');
rollback;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c01');
update quotation_requests set status = 'approved' where id = '30000000-0000-0000-0000-0000000000b1';
commit;
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000a1c05' and title like 'Quotation approved — ready%'), 'follow-up person told it is approved');

-- Follow-up person shares, logs a call, marks hot, records acceptance; cannot change the price
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c05');
update quotation_requests set status = 'sent_to_customer' where id = '30000000-0000-0000-0000-0000000000b1';
insert into quotation_follow_ups (quotation_id, contact_type, notes, temperature, next_follow_up_date, created_by)
  values ('30000000-0000-0000-0000-0000000000b1', 'call', 'Wants it before Pongal', 'hot', current_date + 3, '00000000-0000-0000-0000-0000000a1c05');
select pg_temp.fails($$update quotation_requests set price_per_kw = 1 where id = '30000000-0000-0000-0000-0000000000b1'$$, 'follow-up changes the approved price');
update quotation_requests set status = 'customer_accepted', accepted_via = 'staff', accepted_note = 'Signed copy received' where id = '30000000-0000-0000-0000-0000000000b1';
commit;
select pg_temp.ok((select status = 'customer_accepted' and lead_temperature = 'hot' and follow_up_count = 1
  from quotation_requests where id = '30000000-0000-0000-0000-0000000000b1'), 'follow-up person shares, marks hot and records acceptance');

-- The site-visit person cannot do the follow-up steps
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a1c03');
select pg_temp.fails($$update quotation_requests set status = 'cancelled', lost_reason = 'x' where id = '30000000-0000-0000-0000-0000000000b1'$$, 'visitor marks lost');
rollback;

select 'ALL ALLOCATION CHECKS PASSED';
