-- Lead hot / cold checks: any stage, who may set it, closed quotations, follow-ups.
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
 ('00000000-0000-0000-0000-0000000f0c01', 'lt-ceo@gss.test',   now(), '{"full_name":"LT CEO"}'),
 ('00000000-0000-0000-0000-0000000f0c02', 'lt-visit@gss.test', now(), '{"full_name":"LT Visitor"}'),
 ('00000000-0000-0000-0000-0000000f0c03', 'lt-fu@gss.test',    now(), '{"full_name":"LT FollowUp"}'),
 ('00000000-0000-0000-0000-0000000f0c04', 'lt-other@gss.test', now(), '{"full_name":"LT Other"}');
update profiles set status = 'active' where email like 'lt-%@gss.test';
update profiles set role = 'admin' where email = 'lt-ceo@gss.test';

insert into quotation_requests (id, customer_name, mobile, status, region, assigned_engineer_id, follow_up_manager_id) values
 ('40000000-0000-0000-0000-0000000000c1', 'Fresh enquiry', '9000000021', 'new', 'puducherry',
  '00000000-0000-0000-0000-0000000f0c02', '00000000-0000-0000-0000-0000000f0c03'),
 ('40000000-0000-0000-0000-0000000000c2', 'Lost one', '9000000022', 'new', 'puducherry', null, null);

-- CEO marks a brand-new enquiry HOT (was refused before sharing)
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c01');
update quotation_requests set lead_temperature = 'hot', lead_temperature_note = 'Called twice, wants it this month' where id = '40000000-0000-0000-0000-0000000000c1';
commit;
select pg_temp.ok((select lead_temperature = 'hot' and lead_temperature_at is not null from quotation_requests where id = '40000000-0000-0000-0000-0000000000c1'), 'CEO marks a new enquiry hot, time stamped');

-- The site-visit person and the follow-up person can change it; someone not on it cannot
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c02');
update quotation_requests set lead_temperature = 'cold', lead_temperature_note = 'Only comparing prices' where id = '40000000-0000-0000-0000-0000000000c1';
commit;
select pg_temp.ok((select lead_temperature = 'cold' from quotation_requests where id = '40000000-0000-0000-0000-0000000000c1'), 'site-visit person marks it cold');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c04');
update quotation_requests set lead_temperature = 'hot' where id = '40000000-0000-0000-0000-0000000000c1';   -- cannot see it: 0 rows
commit;
select pg_temp.ok((select lead_temperature = 'cold' from quotation_requests where id = '40000000-0000-0000-0000-0000000000c1'), 'unrelated staff cannot change it');

-- A follow-up logged with HOT before the quotation is shared updates it too
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c03');
insert into quotation_follow_ups (quotation_id, contact_type, notes, temperature, next_follow_up_date)
  values ('40000000-0000-0000-0000-0000000000c1', 'call', 'Loan approved, ready to go', 'hot', current_date + 1);
select pg_temp.fails($$update quotation_requests set customer_name = 'x' where id = '40000000-0000-0000-0000-0000000000c1'$$, 'follow-up person still cannot edit the quotation');
commit;
select pg_temp.ok((select lead_temperature = 'hot' and lead_temperature_note = 'Loan approved, ready to go' and next_follow_up_date = current_date + 1
  from quotation_requests where id = '40000000-0000-0000-0000-0000000000c1'), 'follow-up sets hot, note and next date before sharing');

-- Closed quotations keep their last temperature
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0c01');
update quotation_requests set status = 'cancelled' where id = '40000000-0000-0000-0000-0000000000c2';
select pg_temp.fails($$update quotation_requests set lead_temperature = 'hot' where id = '40000000-0000-0000-0000-0000000000c2'$$, 'hot on a closed quotation');
commit;

select 'ALL HOT / COLD CHECKS PASSED';
