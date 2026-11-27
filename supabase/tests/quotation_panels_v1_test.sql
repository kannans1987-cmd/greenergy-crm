-- Mixed DCR + Non-DCR panels and the chosen inverter phase: stored, checked, locked after approval.
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
 ('00000000-0000-0000-0000-0000000d1e01', 'qp-ceo@gss.test',   now(), '{"full_name":"QP CEO"}'),
 ('00000000-0000-0000-0000-0000000d1e02', 'qp-sales@gss.test', now(), '{"full_name":"QP Sales"}');
update profiles set status = 'active' where email like 'qp-%@gss.test';
update profiles set role = 'admin' where email = 'qp-ceo@gss.test';
insert into quotation_requests (id, customer_name, mobile, status, source, assigned_sales_id) values
 ('d1000000-0000-0000-0000-0000000000a1', 'Mixed Home', '+91 90000 30001', 'drafted', 'phone', '00000000-0000-0000-0000-0000000d1e02');

-- The preparer (e.g. Deviga on her own quotation) sets a mixed system and a phase
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d1e02');
update quotation_requests set panel_type = 'Mixed', dcr_kw = 3, panel_brand_nondcr = 'ImportCo', inverter_phase = '3', system_phase = 3,
  panel_mix = '[{"type":"DCR","brand":"IndoSun","wp":540,"count":6,"kwp":3.24},{"type":"NonDCR","brand":"ImportCo","wp":580,"count":6,"kwp":3.48}]'
  where id = 'd1000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($$update quotation_requests set inverter_phase = '2' where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'phase 2');
select pg_temp.fails($$update quotation_requests set dcr_kw = 0 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'DCR part 0 kW');
update quotation_requests set dcr_panel_qty = 6, nondcr_panel_qty = 6, panel_wp_nondcr = 580, inverter_choice = 't5', inverter_qty = 2,
  price_mode = 'total_incl', price_entry = 333333 where id = 'd1000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($$update quotation_requests set inverter_qty = 0 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'zero inverters');
select pg_temp.fails($$update quotation_requests set nondcr_panel_qty = -1 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'negative panels');
select pg_temp.fails($$update quotation_requests set price_mode = 'cheap' where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'unknown price mode');
select pg_temp.fails($$update quotation_requests set panel_type = 'Hybrid' where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'unknown panel type');
commit;
select pg_temp.ok((select panel_type = 'Mixed' and dcr_kw = 3 and inverter_phase = '3' and jsonb_array_length(panel_mix) = 2
  from quotation_requests where id = 'd1000000-0000-0000-0000-0000000000a1'), 'mixed system saved by the preparer');
select pg_temp.ok((select dcr_panel_qty = 6 and inverter_qty = 2 and price_mode = 'total_incl' and price_entry = 333333
  from quotation_requests where id = 'd1000000-0000-0000-0000-0000000000a1'), 'panel numbers, inverter and typed price saved');

-- After approval the mix and phase are locked, like the price
update quotation_requests set status = 'approved' where id = 'd1000000-0000-0000-0000-0000000000a1';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d1e02');
select pg_temp.fails($$update quotation_requests set dcr_kw = 2 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'DCR part changed after approval');
select pg_temp.fails($$update quotation_requests set inverter_phase = '1' where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'phase changed after approval');
select pg_temp.fails($$update quotation_requests set inverter_qty = 1 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'inverter count changed after approval');
select pg_temp.fails($$update quotation_requests set price_entry = 300000 where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'typed price changed after approval');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000d1e01');
select pg_temp.fails($$update quotation_requests set panel_mix = null where id = 'd1000000-0000-0000-0000-0000000000a1'$$, 'even the CEO revises instead');
commit;

-- Auto-approval counts both panel lines when checking the priced size
insert into quotation_costings (quotation_id, data) values ('d1000000-0000-0000-0000-0000000000a1',
  '{"subtotal": 200000, "lines": [{"id":"panels","qty":3240},{"id":"panels_nondcr","qty":3480}]}');
update quotation_requests set status = 'drafted', admin_capacity_kw = 6.72, priced_from_list = true where id = 'd1000000-0000-0000-0000-0000000000a1';
select pg_temp.ok(not exists (select 1 from jsonb_array_elements_text(quotation_auto_approval('d1000000-0000-0000-0000-0000000000a1')->'reasons') r
  where r like 'Size changed%'), 'mixed size matches the costing');

select 'ALL MIXED PANEL CHECKS PASSED';
