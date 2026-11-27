-- "View all quotations, changes need the CEO": admin executives / project managers.
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
 ('00000000-0000-0000-0000-0000000c1e01', 'qv-ceo@gss.test',    now(), '{"full_name":"QV CEO"}'),
 ('00000000-0000-0000-0000-0000000c1e02', 'qv-viewer@gss.test', now(), '{"full_name":"QV Viewer"}'),
 ('00000000-0000-0000-0000-0000000c1e03', 'qv-sales@gss.test',  now(), '{"full_name":"QV Sales"}'),
 ('00000000-0000-0000-0000-0000000c1e04', 'qv-plain@gss.test',  now(), '{"full_name":"QV Plain"}');
update profiles set status = 'active' where email like 'qv-%@gss.test';
update profiles set role = 'admin' where email = 'qv-ceo@gss.test';
insert into quotation_requests (id, customer_name, mobile, city, status, source, assigned_sales_id) values
 ('c1000000-0000-0000-0000-0000000000a1', 'Kumar', '+91 90000 20001', 'Lawspet', 'drafted', 'phone', '00000000-0000-0000-0000-0000000c1e03');
insert into quotation_line_items (quotation_id, description, quantity, unit_price) values ('c1000000-0000-0000-0000-0000000000a1', 'Extra wiring', 1, 5000);
insert into quotation_follow_ups (quotation_id, contact_type, notes, created_by) values ('c1000000-0000-0000-0000-0000000000a1', 'call', 'Called', '00000000-0000-0000-0000-0000000c1e03');

-- Before the CEO gives access: sees nothing; cannot give it to themself
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e02');
select pg_temp.ok((select count(*) = 0 from quotation_requests), 'no access before');
select pg_temp.fails($$update profiles set quotation_view = true where id = auth.uid()$$, 'gives self view access');
commit;
update profiles set quotation_view = true where email = 'qv-viewer@gss.test';

-- Sees everything about the quotation; supplier costing stays hidden
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e02');
select pg_temp.ok((select count(*) = 1 from quotation_requests), 'sees every quotation');
select pg_temp.ok((select count(*) = 1 from quotation_line_items), 'sees line items');
select pg_temp.ok((select count(*) = 1 from quotation_follow_ups), 'sees follow-ups');
select pg_temp.ok((select count(*) = 0 from quotation_costings), 'no supplier costing');
-- Cannot change, delete or write on it directly
update quotation_requests set city = 'Hacked' where id = 'c1000000-0000-0000-0000-0000000000a1';
delete from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($$insert into quotation_follow_ups (quotation_id, contact_type, notes, created_by) values ('c1000000-0000-0000-0000-0000000000a1', 'call', 'x', auth.uid())$$, 'adds a follow-up');
select pg_temp.fails($$insert into quotation_status_history (quotation_id, from_status, to_status, changed_by) values ('c1000000-0000-0000-0000-0000000000a1', 'drafted', 'approved', auth.uid())$$, 'writes history');
update quotation_line_items set unit_price = 1 where quotation_id = 'c1000000-0000-0000-0000-0000000000a1';
select pg_temp.fails($$insert into quotation_change_requests (quotation_id, requested_by, reason) values ('c1000000-0000-0000-0000-0000000000a1', auth.uid(), 'direct')$$, 'writes a request directly');
-- Logs a phone enquiry
insert into quotation_requests (customer_name, mobile, status, source) values ('Phone Caller', '+91 90000 20002', 'new', 'phone');
commit;
select pg_temp.ok((select city = 'Lawspet' from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'direct edit did nothing');
select pg_temp.ok(exists (select 1 from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'direct delete did nothing');
select pg_temp.ok((select unit_price = 5000 from quotation_line_items where quotation_id = 'c1000000-0000-0000-0000-0000000000a1'), 'line item unchanged');
select pg_temp.ok(exists (select 1 from quotation_requests where customer_name = 'Phone Caller' and quotation_number is not null), 'phone enquiry registered and numbered');

-- A plain employee still sees only their own work
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e04');
select pg_temp.ok((select count(*) = 0 from quotation_requests), 'plain employee sees none');
select pg_temp.fails($$select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"city":"X"}', null, 'because')$$, 'plain employee requests a change');
commit;

-- Change request: only allowed fields, a reason, and something that actually changes
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e02');
select pg_temp.fails($$select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"price_per_kw":1}', null, 'cheaper')$$, 'asks to change the price field');
select pg_temp.fails($$select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"city":"Muthialpet"}', null, '')$$, 'no reason');
select pg_temp.fails($$select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"city":"Lawspet"}', null, 'same value')$$, 'nothing changes');
select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"city":"Muthialpet","mobile":"+91 90000 29999","notes":""}', 'Please make it 5 kW', 'Customer called with new address');
select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"email":"k@x.in"}', null, 'Wrong request');
select pg_temp.fails($$select decide_quotation_change((select id from quotation_change_requests where reason = 'Customer called with new address'), true, 'ok')$$, 'viewer approves own request');
select withdraw_quotation_change((select id from quotation_change_requests where reason = 'Wrong request'));
commit;
select pg_temp.ok((select old_values = '{"city":"Lawspet","mobile":"+91 90000 20001"}'::jsonb and changes ? 'city' and not changes ? 'notes'
  from quotation_change_requests where reason = 'Customer called with new address'), 'only real changes stored, with old values');
select pg_temp.ok((select city = 'Lawspet' from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'nothing applied before the CEO');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c1e01' and title like 'Change request:%'), 'CEO told');
select pg_temp.ok((select status = 'withdrawn' from quotation_change_requests where reason = 'Wrong request'), 'withdrawn');

-- The CEO approves: values applied, comment written, requester told; reject needs a note
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e01');
select decide_quotation_change((select id from quotation_change_requests where reason = 'Customer called with new address'), true, 'Done, 5 kW I will re-price');
select pg_temp.fails($$select decide_quotation_change((select id from quotation_change_requests where reason = 'Customer called with new address'), false, 'again')$$, 'decided twice');
commit;
select pg_temp.ok((select city = 'Muthialpet' and mobile = '+91 90000 29999' from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'approved values applied');
select pg_temp.ok(exists (select 1 from quotation_comments where quotation_id = 'c1000000-0000-0000-0000-0000000000a1' and content like 'Change request approved%'), 'comment on the quotation');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c1e02' and title like 'Change approved:%'), 'requester told');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e02');
select request_quotation_change('c1000000-0000-0000-0000-0000000000a1', '{"customer_name":"Kumar R"}', null, 'Full name');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e01');
select pg_temp.fails($$select decide_quotation_change((select id from quotation_change_requests where reason = 'Full name'), false, '')$$, 'reject without a note');
select decide_quotation_change((select id from quotation_change_requests where reason = 'Full name'), false, 'Name is right as it is');
commit;
select pg_temp.ok((select customer_name = 'Kumar' from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'rejected change not applied');

-- The assigned salesperson keeps editing as before
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c1e03');
update quotation_requests set notes = 'sales edit' where id = 'c1000000-0000-0000-0000-0000000000a1';
commit;
select pg_temp.ok((select notes = 'sales edit' from quotation_requests where id = 'c1000000-0000-0000-0000-0000000000a1'), 'assigned salesperson still edits');

select 'ALL QUOTATION VIEW CHECKS PASSED';
