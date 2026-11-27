-- Growth v1 checks: first contact + alerts, lost reasons, auto-approval, referrals, payments, commissioning.
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
 ('00000000-0000-0000-0000-0000000f0c01', 'gr-ceo@gss.test',   now(), '{"full_name":"GR CEO"}'),
 ('00000000-0000-0000-0000-0000000f0c02', 'gr-mgr@gss.test',   now(), '{"full_name":"GR Manager"}'),
 ('00000000-0000-0000-0000-0000000f0c03', 'gr-staff@gss.test', now(), '{"full_name":"GR Staff"}'),
 ('00000000-0000-0000-0000-0000000f0c04', 'gr-tech@gss.test',  now(), '{"full_name":"GR Tech"}');
update profiles set status = 'active' where email like 'gr-%@gss.test';
update profiles set role = 'admin' where email = 'gr-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'gr-mgr@gss.test';
update business_settings set data = data || '{"day_start": 0, "day_end": 24}' where key = 'alerts';   -- any time of day for the test

-- ── Settings: CEO only ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select pg_temp.ok((select count(*) >= 5 from business_settings), 'staff can read the rules');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
update business_settings set data = '{"enabled": true}' where key = 'auto_approval';   -- no policy: 0 rows
commit;
select pg_temp.ok((select not coalesce((data->>'enabled')::boolean, false) from business_settings where key = 'auto_approval'), 'auto-approval still off after a manager tried');

-- ── First contact ──
insert into quotation_requests (id, customer_name, mobile, status, source, created_at, assigned_engineer_id)
values ('90000000-0000-0000-0000-0000000000a1', 'Web Lead', '+91 90000 00001', 'new', 'website', now() - interval '2 hours', '00000000-0000-0000-0000-0000000f0c03');
select pg_temp.ok((select first_contact_at is null from quotation_requests where id = '90000000-0000-0000-0000-0000000000a1'), 'website lead starts not contacted');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
insert into quotation_requests (id, customer_name, mobile, status, source) values ('90000000-0000-0000-0000-0000000000a2', 'Phone Lead', '+91 90000 00002', 'new', 'phone');
commit;
select pg_temp.ok((select first_contact_at is not null from quotation_requests where id = '90000000-0000-0000-0000-0000000000a2'), 'phone enquiry typed by staff counts as contacted');

-- ── Alerts: nobody called within the hour ──
select run_scheduled_alerts();
select pg_temp.ok((select count(*) = 3 from notifications where title like 'Call this lead now%'), 'CEO, manager and the visit person alerted');
select pg_temp.ok((select first_call_alerted_at is not null from quotation_requests where id = '90000000-0000-0000-0000-0000000000a1'), 'alert stamped');
select run_scheduled_alerts();
select pg_temp.ok((select count(*) = 3 from notifications where title like 'Call this lead now%'), 'no repeat alert');
-- Staff cannot trigger it more than once in 5 minutes (no error, just skipped)
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
select pg_temp.ok((select run_scheduled_alerts() ? 'skipped'), 'staff run is throttled');
commit;

-- The visit person logs the first call
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
insert into quotation_follow_ups (quotation_id, contact_type, notes, created_by) values ('90000000-0000-0000-0000-0000000000a1', 'call', 'Called, visit on Monday', auth.uid());
commit;
select pg_temp.ok((select first_contact_at is not null from quotation_requests where id = '90000000-0000-0000-0000-0000000000a1'), 'first call recorded');

-- ── Lost reason codes ──
select pg_temp.fails($$update quotation_requests set lost_reason_code = 'too_lazy' where id = '90000000-0000-0000-0000-0000000000a2'$$, 'unknown lost reason');
update quotation_requests set status = 'cancelled', lost_reason_code = 'price_high', lost_reason = 'Cheaper quote' where id = '90000000-0000-0000-0000-0000000000a2';

-- ── Auto-approval ──
insert into quotation_requests (id, customer_name, mobile, status, consumer_type, admin_capacity_kw, admin_system_cost, discount, priced_from_list, assigned_sales_id)
values ('90000000-0000-0000-0000-0000000000b1', 'Auto Home', '+91 90000 00003', 'drafted', 'domestic', 3, 150000, 2000, true, '00000000-0000-0000-0000-0000000f0c03');
insert into quotation_costings (quotation_id, data) values ('90000000-0000-0000-0000-0000000000b1',
  '{"subtotal": 120000, "lines": [{"id": "panels", "qty": 3000, "rate": 20, "amount": 60000, "label": "Panels", "unit": "W"}]}');
select pg_temp.ok((select not (quotation_auto_approval('90000000-0000-0000-0000-0000000000b1')->>'eligible')::boolean), 'off by default');
update business_settings set data = '{"enabled": true, "max_kw": 10, "min_margin_pct": 15, "max_discount_pct": 3, "domestic_only": true}' where key = 'auto_approval';
select pg_temp.ok((select (r->>'eligible')::boolean and (r->>'margin_pct')::numeric = 20 from (select quotation_auto_approval('90000000-0000-0000-0000-0000000000b1') r) x), 'inside the rules: 20% margin');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
select pg_temp.ok((select (r->>'eligible')::boolean and not r ? 'margin_pct' from (select quotation_auto_approval('90000000-0000-0000-0000-0000000000b1') r) x), 'staff see the answer but not the margin');
commit;
update quotation_costings set data = jsonb_set(data, '{subtotal}', '135000') where quotation_id = '90000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select not (r->>'eligible')::boolean and r->>'reasons' like '%Margin 10%' from (select quotation_auto_approval('90000000-0000-0000-0000-0000000000b1') r) x), 'low margin needs the CEO');
update quotation_costings set data = jsonb_set(data, '{subtotal}', '120000') where quotation_id = '90000000-0000-0000-0000-0000000000b1';
update quotation_requests set admin_capacity_kw = 5 where id = '90000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select (quotation_auto_approval('90000000-0000-0000-0000-0000000000b1')->>'reasons') like '%Re-price%'), 'size changed after pricing is caught');
update quotation_requests set admin_capacity_kw = 3, discount = 20000 where id = '90000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select (quotation_auto_approval('90000000-0000-0000-0000-0000000000b1')->>'reasons') like '%Discount%'), 'big discount needs the CEO');
update quotation_requests set discount = 2000 where id = '90000000-0000-0000-0000-0000000000b1';
insert into quotation_line_items (quotation_id, description, quantity, unit_price) values ('90000000-0000-0000-0000-0000000000b1', 'Elevated structure', 1, 15000);
select pg_temp.ok((select (quotation_auto_approval('90000000-0000-0000-0000-0000000000b1')->>'reasons') like '%extra items%'), 'extras need the CEO');

-- ── Referral code, reward when the referred lead becomes a job ──
insert into projects (id, name, customer_name, status, job_number) values ('90000000-0000-0000-0000-0000000000c1', 'Old customer', 'Ravi', 'completed', 'GSS/JC/2026-27/0900');
select pg_temp.ok((select referral_code ~ '^G[A-Z2-9]{5}$' and report_token is not null from projects where id = '90000000-0000-0000-0000-0000000000c1'), 'customer gets a referral code and report link');
insert into quotation_requests (id, customer_name, mobile, status, referred_by_project, source)
values ('90000000-0000-0000-0000-0000000000c2', 'Ravi''s neighbour', '+91 90000 00004', 'advance_pending', '90000000-0000-0000-0000-0000000000c1', 'referral');
update quotation_requests set status = 'project_created', job_number = 'GSS/JC/2026-27/0901' where id = '90000000-0000-0000-0000-0000000000c2';
select pg_temp.ok((select status = 'due' and amount = 2000 from referral_rewards where quotation_id = '90000000-0000-0000-0000-0000000000c2'), 'reward due');
select pg_temp.ok(exists (select 1 from notifications where title = 'Referral reward due'), 'managers told about the reward');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
select pg_temp.fails($$select mark_referral_reward((select id from referral_rewards limit 1), 'paid', 'x')$$, 'staff marks reward paid');
select pg_temp.ok((select count(*) = 0 from referral_rewards), 'staff cannot see rewards');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select mark_referral_reward((select id from referral_rewards limit 1), 'paid', 'GPay to Ravi');
insert into group_buys (name, area) values ('Lawspet 4th Cross', 'Lawspet');
commit;
select pg_temp.ok((select status = 'paid' and paid_by is not null from referral_rewards), 'reward paid');
select pg_temp.ok((select code ~ '^N[A-Z2-9]{5}$' from group_buys), 'group gets a code');

-- ── Payments follow milestones; part payments ──
insert into projects (id, name, customer_name, status, job_number, start_date) values ('90000000-0000-0000-0000-0000000000d1', 'New job', 'Kumar', 'in_progress', 'GSS/JC/2026-27/0902', current_date - 40);
insert into project_stage_history (project_id, stage_code, stage_name, phase, sort_order, is_subsidy, status, planned_date)
select '90000000-0000-0000-0000-0000000000d1', t.stage_code, t.stage_name, t.phase, t.sort_order, t.is_subsidy, 'pending', current_date - 40 + t.day_offset
  from project_stage_template() t;
insert into project_payments (project_id, milestone_name, percentage, amount, status) values
 ('90000000-0000-0000-0000-0000000000d1', 'Advance on order (50%)', 50, 100000, 'pending'),
 ('90000000-0000-0000-0000-0000000000d1', 'Before material delivery (40%)', 40, 80000, 'pending'),
 ('90000000-0000-0000-0000-0000000000d1', 'On commissioning & handover (10%)', 10, 20000, 'pending');
select pg_temp.ok((select due_date = current_date - 26 from project_payments where milestone_name like 'Before material%'), 'due date from the materials milestone');
update project_stage_history set planned_date = current_date + 5 where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'material_procurement';
select pg_temp.ok((select due_date = current_date + 5 from project_payments where milestone_name like 'Before material%'), 'moves when the milestone moves');
select run_scheduled_alerts();   -- the server run is not throttled
select pg_temp.ok((select count(*) = 1 from project_payments where alerted_at is not null), 'overdue advance alerted');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
select pg_temp.fails($$select record_payment((select id from project_payments where milestone_name like 'Advance%'), 50000, 'upi', 'x', current_date)$$, 'staff records a payment');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select record_payment((select id from project_payments where milestone_name like 'Advance%'), 60000, 'upi', 'UPI 111', current_date - 1);
select pg_temp.fails($$select record_payment((select id from project_payments where milestone_name like 'Advance%'), 50000, 'upi', 'x', current_date)$$, 'more than is due');
select pg_temp.fails($$select record_payment((select id from project_payments where milestone_name like 'Advance%'), 100, 'upi', 'x', current_date + 3)$$, 'future date');
commit;
select pg_temp.ok((select status = 'partial' and amount_received = 60000 from project_payments where milestone_name like 'Advance%'), 'part payment');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select record_payment((select id from project_payments where milestone_name like 'Advance%'), 40000, 'neft', 'NEFT 222', current_date);
select record_payment((select id from project_payments where milestone_name like 'Before material%'), 80000, 'cheque', 'CHQ 3', current_date);
select record_payment((select id from project_payments where milestone_name like 'On commissioning%'), 20000, 'cash', '', current_date);
commit;
select pg_temp.ok((select bool_and(status = 'paid') from project_payments where project_id = '90000000-0000-0000-0000-0000000000d1'), 'all paid');
select pg_temp.ok((select count(*) = 4 from payment_receipts), 'every receipt kept');
select pg_temp.ok((select status = 'completed' from project_stage_history where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'final_payment'), 'final payment milestone done');

-- ── Commissioning gate ──
insert into project_employees (project_id, employee_id) values ('90000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000f0c04');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select pg_temp.fails($$update project_stage_history set status = 'completed' where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'commissioning'$$, 'commissioning ticked with no checklist');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
select pg_temp.fails($$insert into commissioning_reports (project_id) values ('90000000-0000-0000-0000-0000000000d1')$$, 'someone not on the project fills the checklist');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c04');
insert into commissioning_reports (project_id, data, photos, override_reason) values ('90000000-0000-0000-0000-0000000000d1',
  '{"inverter_serial": "INV123", "panel_serials": "P1, P2", "string_voc": "412 V", "insulation_mohm": "40", "earth_ohm": "1.2", "meter_reading": "0.4", "check_monitoring": true, "check_training": true}',
  '{"array": ["a.jpg"], "structure": ["b.jpg"], "inverter": ["c.jpg"], "acdb_dcdb": ["d.jpg"], "earthing": ["e.jpg"]}', 'technician tries to skip');
select pg_temp.ok((select override_reason is null from commissioning_reports), 'technician cannot set an override');
select pg_temp.ok((select complete_commissioning('90000000-0000-0000-0000-0000000000d1') @> array['Photo: net meter with reading', 'Warranty cards handed over', 'Customer signature']), 'missing items listed');
update commissioning_reports set photos = photos || '{"meter": ["f.jpg"]}', data = data || '{"check_warranty": true}',
       signature_url = 'sig.png', signed_name = 'Kumar' where project_id = '90000000-0000-0000-0000-0000000000d1';
select pg_temp.ok((select cardinality(complete_commissioning('90000000-0000-0000-0000-0000000000d1')) = 0), 'complete');
select pg_temp.fails($$update commissioning_reports set signed_name = 'Someone else' where project_id = '90000000-0000-0000-0000-0000000000d1'$$, 'technician edits a completed report');
commit;
select pg_temp.ok((select completed_at is not null and signed_at is not null from commissioning_reports), 'report completed and signed');
select pg_temp.ok((select status = 'completed' from project_stage_history where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'testing'), 'testing milestone ticked');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
update project_stage_history set status = 'completed' where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'commissioning';
commit;
select pg_temp.ok((select status = 'completed' from project_stage_history where project_id = '90000000-0000-0000-0000-0000000000d1' and stage_code = 'commissioning'), 'commissioning can be ticked now');

-- CEO override for a project where something cannot be done
insert into projects (id, name, customer_name, status) values ('90000000-0000-0000-0000-0000000000e1', 'Override job', 'Mani', 'in_progress');
insert into project_stage_history (project_id, stage_code, stage_name, sort_order, status) values ('90000000-0000-0000-0000-0000000000e1', 'commissioning', 'Commissioning', 14, 'pending');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
select pg_temp.fails($$select complete_commissioning('90000000-0000-0000-0000-0000000000e1', 'customer abroad')$$, 'manager overrides');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c01');
select pg_temp.ok((select cardinality(complete_commissioning('90000000-0000-0000-0000-0000000000e1', 'Customer abroad, signs on return')) = 0), 'CEO override');
update project_stage_history set status = 'completed' where project_id = '90000000-0000-0000-0000-0000000000e1' and stage_code = 'commissioning';
commit;
select pg_temp.ok(exists (select 1 from audit_log where action_type = 'commissioning_completed' and description like '%CEO override%'), 'override is in the audit log');

select 'ALL GROWTH CHECKS PASSED';
