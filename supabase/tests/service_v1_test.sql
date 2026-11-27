-- Service v1 checks: AMC contracts and visits, tickets, technician rights, invoices, O&M clock-in on a job, alerts.
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
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.headers', '{"user-agent":"Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"}', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000b0c01', 'sv-ceo@gss.test',  now(), '{"full_name":"SV CEO"}'),
 ('00000000-0000-0000-0000-0000000b0c02', 'sv-mgr@gss.test',  now(), '{"full_name":"SV Manager"}'),
 ('00000000-0000-0000-0000-0000000b0c03', 'sv-tech@gss.test', now(), '{"full_name":"SV Tech"}'),
 ('00000000-0000-0000-0000-0000000b0c04', 'sv-other@gss.test', now(), '{"full_name":"SV Other"}');
update profiles set status = 'active' where email like 'sv-%@gss.test';
update profiles set role = 'admin' where email = 'sv-ceo@gss.test';
update profiles set role = 'task_manager' where email = 'sv-mgr@gss.test';
update profiles set attendance_mode = 'field' where email = 'sv-tech@gss.test';
insert into trusted_devices (id, employee_id, secret_hash, status) values
 ('a0000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000b0c03', _sha256_hex(repeat('7', 64)), 'approved');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- ── AMC contract books its visits ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c02');
insert into service_contracts (customer_name, customer_mobile, start_date, end_date, fee, visits_per_year)
values ('Lakshmi', '+91 90000 11111', current_date - 1, current_date + 364, 4000, 2);
insert into ids select 'c1', id from service_contracts;
commit;
select pg_temp.ok((select contract_number ~ '^GSS/AMC/\d{4}-\d{2}/0001$' from service_contracts), 'contract numbered');
select pg_temp.ok((select count(*) = 2 and min(scheduled_for) between current_date + 80 and current_date + 100 from service_tickets where kind = 'amc_visit'), 'two visits spread over the year');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
select pg_temp.ok((select count(*) = 0 from service_contracts) and (select count(*) = 0 from service_tickets), 'technician sees no contracts or other jobs');
select pg_temp.fails($$insert into service_contracts (customer_name, start_date, end_date) values ('x', current_date, current_date + 10)$$, 'technician adds a contract');
-- A technician can report a fault, but not assign it or put a price on it
insert into service_tickets (customer_name, description, kind, assigned_to, chargeable, charge_amount, created_by)
values ('Roadside customer', 'Inverter shows earth fault', 'breakdown', auth.uid(), true, 9999, auth.uid());
commit;
select pg_temp.ok((select assigned_to is null and status = 'open' and not chargeable and charge_amount = 0 and due_date = (now() at time zone 'Asia/Kolkata')::date + 3
  from service_tickets where customer_name = 'Roadside customer'), 'reported fault waits for the manager');
select pg_temp.ok(exists (select 1 from notifications where title like 'New breakdown%'), 'managers told about the breakdown');

-- ── Manager assigns; technician works it ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c02');
update service_tickets set assigned_to = '00000000-0000-0000-0000-0000000b0c03', priority = 'urgent', chargeable = true, charge_amount = 1500
 where customer_name = 'Roadside customer';
insert into ids select 't1', id from service_tickets where customer_name = 'Roadside customer';
commit;
select pg_temp.ok((select status = 'assigned' from service_tickets where id = (select v from ids where k = 't1')), 'assigned');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000b0c03' and title = 'Service job given to you'), 'technician told');

-- O&M clock-in on the job (no project): hours belong to the ticket
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
select pg_temp.fails($$select attendance_clock_in('a0000000-0000-0000-0000-0000000000d3', repeat('7', 64), 'site', null, 12.1, 79.7, 10, 'x')$$, 'site clock-in with no project and no job');
select attendance_clock_in('a0000000-0000-0000-0000-0000000000d3', repeat('7', 64), 'site', null, 12.1, 79.7, 10, 'Customer site', (select v from ids where k = 't1'));
commit;
select pg_temp.ok((select service_ticket_id = (select v from ids where k = 't1') from attendance where employee_id = '00000000-0000-0000-0000-0000000b0c03'), 'session linked to the job');
select pg_temp.ok((select status = 'in_progress' from service_tickets where id = (select v from ids where k = 't1')), 'clock-in starts the job');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
select attendance_clock_out('a0000000-0000-0000-0000-0000000000d3', repeat('7', 64), 12.1, 79.7, 10, 'Customer site');
select pg_temp.fails($$update service_tickets set charge_amount = 100 where id = (select v from ids where k = 't1')$$, 'technician changes the charge');
select pg_temp.fails($$update service_tickets set status = 'resolved' where id = (select v from ids where k = 't1')$$, 'resolved without notes');
select pg_temp.fails($$update service_tickets set status = 'closed', resolution_notes = 'x' where id = (select v from ids where k = 't1')$$, 'technician closes');
update service_tickets set status = 'resolved', resolution_notes = 'Replaced DC SPD, IR test 45 MΩ' where id = (select v from ids where k = 't1');
commit;
select pg_temp.ok((select resolved_at is not null from service_tickets where id = (select v from ids where k = 't1')), 'resolved');
select pg_temp.ok(exists (select 1 from notifications where title like 'Service job resolved — send the invoice%'), 'managers asked to invoice');

-- ── Invoices: one series, numbers fixed ──
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c03');
select pg_temp.fails($$select issue_service_invoice('ticket', (select v from ids where k = 't1'))$$, 'technician invoices');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c02');
select issue_service_invoice('ticket', (select v from ids where k = 't1'));
select issue_service_invoice('ticket', (select v from ids where k = 't1'));   -- same number again
select issue_service_invoice('amc', (select v from ids where k = 'c1'));
select pg_temp.fails($$update service_tickets set invoice_number = 'X' where id = (select v from ids where k = 't1')$$, 'invoice number edited');
select pg_temp.fails($$update service_tickets set charge_amount = 1 where id = (select v from ids where k = 't1')$$, 'invoiced amount edited');
select pg_temp.fails($$select issue_service_invoice('ticket', (select id from service_tickets where kind = 'amc_visit' limit 1))$$, 'invoice for a free AMC visit');
select record_service_payment('ticket', (select v from ids where k = 't1'), 'upi', 'UPI 9', current_date);
commit;
select pg_temp.ok((select invoice_number like 'GSS/SI/%/0001' from service_tickets where id = (select v from ids where k = 't1'))
  and (select invoice_number like 'GSS/SI/%/0002' from service_contracts), 'invoice numbers in one series');
select pg_temp.ok((select status = 'closed' and paid_at = current_date from service_tickets where id = (select v from ids where k = 't1')), 'paid job closes');

-- ── Alerts: AMC visit to assign, overdue job, renewal ──
update service_tickets set scheduled_for = current_date + 3 where id = (select id from service_tickets where kind = 'amc_visit' order by scheduled_for limit 1);
insert into service_tickets (customer_name, description, kind, due_date, assigned_to, status)
values ('Late job', 'Cleaning', 'cleaning', current_date - 2, '00000000-0000-0000-0000-0000000b0c04', 'assigned');
update service_contracts set end_date = current_date + 20;
select run_scheduled_alerts();
select pg_temp.ok(exists (select 1 from notifications where title = 'AMC visit to assign'), 'AMC visit alert');
select pg_temp.ok(exists (select 1 from notifications where title = 'Service job overdue' and user_id = '00000000-0000-0000-0000-0000000b0c04'), 'overdue alert to the technician');
select pg_temp.ok(exists (select 1 from notifications where title like 'AMC ends soon%'), 'renewal alert');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b0c02');
insert into ids values ('c2', renew_amc_contract((select v from ids where k = 'c1')));
select pg_temp.fails($$select renew_amc_contract((select v from ids where k = 'c1'))$$, 'renew twice');
commit;
select pg_temp.ok((select start_date = current_date + 21 and fee = 4000 and contract_number like '%/0002' from service_contracts where id = (select v from ids where k = 'c2')), 'renewal starts the day after');

select 'ALL SERVICE CHECKS PASSED';
