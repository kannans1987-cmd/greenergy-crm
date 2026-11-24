-- Price list access checks. Run on a THROWAWAY database after workflow_v2_test.sql
-- (reuses its users and quotations) and after the private pricing seed.
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

select pg_temp.ok((select count(*) = 2 from pricing_config), 'price list and cost model loaded');
select pg_temp.ok((select (data->'panels'->'kandha-solar-vikram-dcr-550'->>'rate')::numeric = 24
                     and (data->'inverters'->'g-nexter-solaryaan-1ph-3'->>'price')::numeric = 14900
                     and (data->'panels'->'g-nexter-solex-dcr-545'->>'active')::boolean = false
                     from pricing_config where key = 'catalogue'), 'November prices loaded; old G-nexter panels switched off');

-- Costing written by the server (service role) for the first quotation
insert into quotation_costings (quotation_id, data, catalogue_version, model_version)
values ('10000000-0000-0000-0000-000000000002', '{"subtotal": 400000}', 1, 1);

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) = 2 from pricing_config), 'CEO reads the price list');
select pg_temp.ok((select count(*) = 1 from quotation_costings), 'CEO reads costings');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select count(*) = 0 from pricing_config), 'admin manager cannot read supplier prices');
select pg_temp.ok((select count(*) = 1 from quotation_costings), 'admin manager reads costings');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((select count(*) = 0 from pricing_config), 'sales cannot read supplier prices');
select pg_temp.ok((select count(*) = 0 from quotation_costings), 'sales cannot read costings');
update pricing_config set data = '{}'::jsonb where key = 'catalogue';
commit;
select pg_temp.ok((select data ? 'panels' from pricing_config where key = 'catalogue'), 'sales cannot change the price list');

-- Specification locks with the price after approval
insert into quotation_requests (id, customer_name, mobile, status, assigned_sales_id, panel_brand, panel_count)
values ('10000000-0000-0000-0000-000000000003', 'Spec test', '9000000001', 'owner_approval_pending', '00000000-0000-0000-0000-0000000000b1', 'Vikram', 6);
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update quotation_requests set status = 'approved' where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.fails($$update quotation_requests set panel_brand = 'Waaree' where id = '10000000-0000-0000-0000-000000000003'$$, 'panel changed after approval');
update quotation_requests set status = 'drafted' where id = '10000000-0000-0000-0000-000000000003';
update quotation_requests set panel_brand = 'Waaree', panel_count = 7 where id = '10000000-0000-0000-0000-000000000003';
commit;

-- Delegated price editing
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
select pg_temp.fails($$update profiles set price_access = 'prices_and_margin' where id = auth.uid()$$, 'staff give themselves price access');
select pg_temp.fails($$update profiles set role = 'admin' where id = auth.uid()$$, 'staff make themselves CEO');
update profiles set phone = '9876500000' where id = auth.uid();
commit;
select pg_temp.ok((select phone = '9876500000' and price_access is null from profiles where email = 'sales@gss.test'), 'staff update their own phone, nothing else');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update profiles set price_access = 'prices' where email = 'officer@gss.test';
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok(can_edit_prices() and not can_edit_margin(), 'delegated editor: prices yes, margin no');
select pg_temp.ok((select count(*) = 2 from pricing_config), 'delegated editor reads the price list');
select pg_temp.ok((select count(*) = 0 from quotation_costings), 'delegated editor does not see quotation margins');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update profiles set price_access = null where email = 'officer@gss.test';
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) = 0 from pricing_config) and not can_edit_prices(), 'access removed by the CEO');
commit;

select 'ALL PRICING CHECKS PASSED' as result;
