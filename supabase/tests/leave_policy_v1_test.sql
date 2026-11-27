-- Leave policy and two-level approval (Sr Admin Manager → CEO).
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
create or replace function pg_temp.d(n int) returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date + n $$;

-- No weekly off in the test, so day counts do not depend on today's weekday
update business_settings set data = data || '{"week_off": []}' where key = 'leave';

-- l01 CEO · l02 Sr Admin Manager · l03 staff · l04 staff
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000c2e01', 'lv-ceo@gss.test',  now(), '{"full_name":"LV CEO"}'),
 ('00000000-0000-0000-0000-0000000c2e02', 'lv-sr@gss.test',   now(), '{"full_name":"LV Senior"}'),
 ('00000000-0000-0000-0000-0000000c2e03', 'lv-a@gss.test',    now(), '{"full_name":"LV Staff A"}'),
 ('00000000-0000-0000-0000-0000000c2e04', 'lv-b@gss.test',    now(), '{"full_name":"LV Staff B"}');
update profiles set status = 'active', created_at = now() - interval '60 days' where email like 'lv-%@gss.test';
update profiles set role = 'admin' where email = 'lv-ceo@gss.test';
update profiles set allocation_level = 'senior' where email = 'lv-sr@gss.test';

-- ═══ Casual leave, 5+ days' notice: 1 paid, genuine → 2 paid, 3rd day on LOP ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e03');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(7), pg_temp.d(9), 'Sister''s wedding in Chennai');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(-1), pg_temp.d(-1), 'Was unwell yesterday')$$, 'casual leave in the past');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(8), pg_temp.d(8), 'Overlapping day')$$, 'overlapping leave');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(20), pg_temp.d(20), 'x')$$, 'no real reason');
select pg_temp.fails($$update leaves set status = 'approved' where employee_id = auth.uid()$$, 'approves own leave');
commit;
select pg_temp.ok((select status = 'pending' and days = 3 and notice_days = 7 and not abrupt and paid_days = 1 and lop_days = 2
  from leaves where reason like 'Sister%'), '3 days with notice: 1 paid, 2 LOP');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e02' and title = 'Leave to approve (1st level)'), 'Sr Admin Manager told first');
select pg_temp.ok(not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e01' and title like 'Leave%'), 'CEO not asked yet');

-- The CEO cannot jump the first level; another staff member cannot decide
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
select pg_temp.fails($$update leaves set status = 'approved' where reason like 'Sister%'$$, 'CEO approves before the Sr Admin Manager');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e04');
update leaves set status = 'sr_approved' where reason like 'Sister%';
commit;
select pg_temp.ok((select status = 'pending' from leaves where reason like 'Sister%'), 'other staff cannot touch it');

-- 1st level: genuine reason → 2 paid; the Sr cannot give the final approval
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
select pg_temp.fails($$update leaves set status = 'approved' where reason like 'Sister%'$$, 'Sr gives the final approval');
select pg_temp.fails($$update leaves set paid_days = 3 where reason like 'Sister%'$$, 'Sr edits the paid days');
update leaves set status = 'sr_approved', genuine = true, sr_note = 'Family wedding, informed early' where reason like 'Sister%';
commit;
select pg_temp.ok((select status = 'sr_approved' and paid_days = 2 and lop_days = 1 and sr_by = '00000000-0000-0000-0000-0000000c2e02' from leaves where reason like 'Sister%'), 'genuine: 2 paid, 3rd day LOP');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e01' and title = 'Leave for your final approval'), 'CEO asked for final approval');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
update leaves set status = 'approved' where reason like 'Sister%';
commit;
select pg_temp.ok((select status = 'approved' and approved_by = '00000000-0000-0000-0000-0000000c2e01' from leaves where reason like 'Sister%'), 'CEO final approval');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e03' and title = 'Leave approved'), 'staff told');

-- ═══ Abrupt casual leave: all LOP ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e03');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(2), pg_temp.d(3), 'Personal work at the bank');
commit;
select pg_temp.ok((select abrupt and paid_days = 0 and lop_days = 2 from leaves where reason like 'Personal work%'), 'abrupt casual leave: all LOP');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
update leaves set status = 'sr_approved', genuine = true where reason like 'Personal work%';
commit;
select pg_temp.ok((select paid_days = 0 from leaves where reason like 'Personal work%'), 'genuine does not pay an abrupt leave');

-- ═══ Sick leave: paid only with a certificate; can be applied after it started ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e03');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'sick', pg_temp.d(-3), pg_temp.d(-2), 'Viral fever');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'sick', pg_temp.d(-20), pg_temp.d(-19), 'Old fever')$$, 'sick leave too far back');
select pg_temp.fails($$update leaves set certificate_path = '00000000-0000-0000-0000-0000000c2e04/cert.pdf' where reason = 'Viral fever'$$, 'certificate from someone else''s folder');
commit;
select pg_temp.ok((select paid_days = 0 and lop_days = 2 from leaves where reason = 'Viral fever'), 'sick without certificate: LOP');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e03');
update leaves set certificate_path = '00000000-0000-0000-0000-0000000c2e03/fever.pdf' where reason = 'Viral fever';
commit;
select pg_temp.ok((select paid_days = 2 and lop_days = 0 from leaves where reason = 'Viral fever'), 'sick with certificate: paid');

-- ═══ Rejection needs a note; withdrawal ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e04');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(10), pg_temp.d(10), 'Temple festival at home');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(30), pg_temp.d(30), 'Changed my mind later');
update leaves set status = 'cancelled' where reason = 'Changed my mind later';
commit;
select pg_temp.ok((select status = 'cancelled' from leaves where reason = 'Changed my mind later'), 'staff withdraws a pending leave');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
select pg_temp.fails($$update leaves set status = 'rejected' where reason = 'Temple festival at home'$$, 'reject without a note');
update leaves set status = 'rejected', sr_note = 'Site commissioning that day' where reason = 'Temple festival at home';
commit;
select pg_temp.ok((select status = 'rejected' from leaves where reason = 'Temple festival at home'), 'rejected at the first level');

-- ═══ The Sr Admin Manager's own leave goes straight to the CEO ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(6), pg_temp.d(6), 'Child''s school annual day');
commit;
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e01' and title = 'Leave for your approval'), 'Sr''s leave goes to the CEO');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
update leaves set status = 'approved' where reason like 'Child%';
commit;
select pg_temp.ok((select status = 'approved' from leaves where reason like 'Child%'), 'CEO approves the Sr''s leave directly');

-- ═══ More than 10 days needs a proper explanation ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e04');
insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'casual', pg_temp.d(40), pg_temp.d(52), 'Going to my native place');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
update leaves set status = 'sr_approved' where reason = 'Going to my native place';
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
select pg_temp.fails($$update leaves set status = 'approved' where reason = 'Going to my native place'$$, 'long leave approved without an accepted explanation');
select pg_temp.fails($$update leaves set explanation_accepted = true where reason = 'Going to my native place'$$, 'explanation accepted without a note');
update leaves set explanation_accepted = true, ceo_note = 'Father''s surgery, letter from the hospital seen', status = 'approved' where reason = 'Going to my native place';
commit;
select pg_temp.ok((select status = 'approved' and days = 13 and paid_days = 1 and lop_days = 12 from leaves where reason = 'Going to my native place'), 'long leave: 1 paid, rest LOP');

-- ═══ Absence without intimation: LOP; more than 10 days → termination review ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e04');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values ('00000000-0000-0000-0000-0000000c2e03', 'absence', pg_temp.d(-30), pg_temp.d(-30), 'Did not come')$$, 'staff records an absence');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
insert into leaves (employee_id, type, from_date, to_date, reason) values ('00000000-0000-0000-0000-0000000c2e04', 'absence', pg_temp.d(-25), pg_temp.d(-20), 'No call, no show');
select pg_temp.fails($$insert into leaves (employee_id, type, from_date, to_date, reason) values (auth.uid(), 'absence', pg_temp.d(-15), pg_temp.d(-15), 'Myself away')$$, 'records own absence');
commit;
select pg_temp.ok((select status = 'approved' and paid_days = 0 and lop_days = 6 and not termination_review from leaves where reason = 'No call, no show'), 'absence: all LOP');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e04' and title = 'Recorded as absent without intimation'), 'staff told about the absence');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
insert into leaves (employee_id, type, from_date, to_date, reason) values ('00000000-0000-0000-0000-0000000c2e04', 'absence', pg_temp.d(-19), pg_temp.d(-14), 'Still not reachable by phone');
commit;
select pg_temp.ok((select termination_review from leaves where reason = 'Still not reachable by phone'), '12 days of absence: termination review');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000c2e01' and title like 'Termination review%'), 'CEO told');
select pg_temp.ok(exists (select 1 from audit_log where action_type = 'leave_termination_review'), 'kept in the audit log');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
update leaves set show_cause_at = now() where reason = 'Still not reachable by phone';
commit;
select pg_temp.ok((select show_cause_at is not null and termination_review from leaves where reason = 'Still not reachable by phone'), 'show-cause notice recorded');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e01');
update leaves set explanation_accepted = true, ceo_note = 'Hospitalised, discharge summary received' where reason = 'Still not reachable by phone';
commit;
select pg_temp.ok((select not termination_review and lop_days = 6 from leaves where reason = 'Still not reachable by phone'), 'explanation accepted clears the review (still LOP)');

-- ═══ Reports ═══
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e02');
select pg_temp.ok((select count(*) >= 1 from unexplained_absences(14) where employee_id = '00000000-0000-0000-0000-0000000c2e03'), 'days with no clock-in and no leave are listed');
select pg_temp.ok((select count(*) = 0 from unexplained_absences(14) where employee_id = '00000000-0000-0000-0000-0000000c2e03' and day between pg_temp.d(-3) and pg_temp.d(-2)), 'days on sick leave are not listed');
select pg_temp.ok((select coalesce(sum(lop), 0) + coalesce(sum(absences), 0) > 0 from leave_month_summary(pg_temp.d(-20))), 'month summary has the LOP');
commit;
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000c2e03');
select pg_temp.ok((select count(*) = 0 from unexplained_absences(14)), 'staff cannot run the absence report');
select pg_temp.ok((select count(*) = 0 from leaves where employee_id = '00000000-0000-0000-0000-0000000c2e04'), 'staff see only their own leave');
commit;

select 'ALL LEAVE POLICY CHECKS PASSED';
