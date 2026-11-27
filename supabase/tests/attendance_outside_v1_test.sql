-- "Out on work" sessions: site visits for leads, EB office, purchases, bank / govt office.
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
 ('00000000-0000-0000-0000-0000000a0d01', 'ao-ceo@gss.test',   now(), '{"full_name":"AO CEO"}'),
 ('00000000-0000-0000-0000-0000000a0d02', 'ao-selvam@gss.test', now(), '{"full_name":"AO Selvam"}'),
 ('00000000-0000-0000-0000-0000000a0d03', 'ao-other@gss.test',  now(), '{"full_name":"AO Other"}');
update profiles set status = 'active' where email like 'ao-%@gss.test';
update profiles set role = 'admin' where email = 'ao-ceo@gss.test';
update profiles set attendance_mode = 'field' where email = 'ao-selvam@gss.test';
insert into office_locations (name, lat, lng, radius_m) values ('Office', 11.9600, 79.8100, 150);
insert into trusted_devices (id, employee_id, secret_hash, status) values
 ('a1000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000a0d02', _sha256_hex(repeat('4', 64)), 'approved'),
 ('a1000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000a0d03', _sha256_hex(repeat('5', 64)), 'approved');
insert into quotation_requests (id, customer_name, mobile, status, source, assigned_sales_id) values
 ('a1000000-0000-0000-0000-0000000000a1', 'Ravi', '+91 90000 10001', 'site_visit_scheduled', 'phone', '00000000-0000-0000-0000-0000000a0d02'),
 ('a1000000-0000-0000-0000-0000000000a2', 'Not his', '+91 90000 10002', 'new', 'phone', '00000000-0000-0000-0000-0000000a0d03');
insert into projects (id, name, customer_name, status) values ('a1000000-0000-0000-0000-0000000000b1', 'Unrelated site', 'X', 'in_progress');

-- A day of office → site visit → EB office → office, all on one phone
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a0d02');
select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'office', null, 11.9601, 79.8101, 10, 'Office');
select attendance_clock_out('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 11.9601, 79.8101, 10, 'Office');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 12.0, 79.7, 10, 'x')$$, 'outside with no purpose');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 12.0, 79.7, 10, 'x', null, 'eb_office', null, null)$$, 'EB office with no note and no project');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 12.0, 79.7, 10, 'x', null, 'site_visit', null, 'a1000000-0000-0000-0000-0000000000a2')$$, 'site visit for someone else''s lead');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', 'a1000000-0000-0000-0000-0000000000b1', 12.0, 79.7, 10, 'x', null, 'eb_office', null, null)$$, 'EB office for a project he cannot see');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 12.0, 79.7, 10, 'x', null, 'party', 'zzz', null)$$, 'unknown purpose');
select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 12.05, 79.75, 10, 'Ravi house', null, 'site_visit', null, 'a1000000-0000-0000-0000-0000000000a1');
select attendance_clock_out('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 12.05, 79.75, 10, 'Ravi house');
select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'outside', null, 11.93, 79.82, 10, 'EB office', null, 'eb_office', '  EB Lawspet – net meter file  ', null);
commit;
select pg_temp.ok((select array_agg(work_type order by session_no) = '{office,outside,outside}' from attendance where employee_id = '00000000-0000-0000-0000-0000000a0d02'), 'office, then two outside sessions');
select pg_temp.ok((select quotation_id = 'a1000000-0000-0000-0000-0000000000a1' and purpose = 'site_visit' and office_location_id is null and clock_in_distance_m is null
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a0d02' and session_no = 2), 'site visit linked to the lead, no office radius');
select pg_temp.ok((select purpose = 'eb_office' and purpose_note = 'EB Lawspet – net meter file' and quotation_id is null
  from attendance where employee_id = '00000000-0000-0000-0000-0000000a0d02' and session_no = 3), 'EB office with the note');

-- The purpose cannot be changed on clock-out
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a0d02');
update attendance set purpose = 'other', purpose_note = 'changed' where employee_id = auth.uid() and session_no = 3;
select attendance_clock_out('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 11.93, 79.82, 10, 'EB office');
commit;
select pg_temp.ok((select purpose = 'eb_office' and purpose_note = 'EB Lawspet – net meter file' from attendance
  where employee_id = '00000000-0000-0000-0000-0000000a0d02' and session_no = 3), 'purpose and note kept');

-- Office type: an outside day still counts as the one session
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a0d03');
select attendance_clock_in('a1000000-0000-0000-0000-0000000000d3', repeat('5', 64), 'outside', null, 12.0, 79.7, 10, 'Bank', null, 'bank_govt', 'SBI Main – loan papers', null);
select attendance_clock_out('a1000000-0000-0000-0000-0000000000d3', repeat('5', 64), 12.0, 79.7, 10, 'Bank');
select pg_temp.fails($$select attendance_clock_in('a1000000-0000-0000-0000-0000000000d3', repeat('5', 64), 'office', null, 11.9601, 79.8101, 10, 'Office')$$, 'office-type staff clock in twice');
commit;

-- Office sessions ignore purpose fields; the old 8- and 9-argument calls still work
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000a0d02');
select attendance_clock_in('a1000000-0000-0000-0000-0000000000d2', repeat('4', 64), 'office', null, 11.9601, 79.8101, 10, 'Office', null, 'other', 'ignored', 'a1000000-0000-0000-0000-0000000000a1');
commit;
select pg_temp.ok((select purpose is null and purpose_note is null and quotation_id is null from attendance
  where employee_id = '00000000-0000-0000-0000-0000000a0d02' and session_no = 4), 'office session has no purpose');

select 'ALL OUT-ON-WORK ATTENDANCE CHECKS PASSED';
