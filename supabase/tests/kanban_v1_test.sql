-- Kanban for tasks: stamps, WIP limit, blocked flag, notifications, who may move cards.
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

-- k01 CEO · k02 Jr Admin Manager (gives tasks) · k03 staff · k04 other staff
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000b1e01', 'kb-ceo@gss.test',   now(), '{"full_name":"KB CEO"}'),
 ('00000000-0000-0000-0000-0000000b1e02', 'kb-jr@gss.test',    now(), '{"full_name":"KB Junior"}'),
 ('00000000-0000-0000-0000-0000000b1e03', 'kb-staff@gss.test', now(), '{"full_name":"KB Staff"}'),
 ('00000000-0000-0000-0000-0000000b1e04', 'kb-other@gss.test', now(), '{"full_name":"KB Other"}');
update profiles set status = 'active' where email like 'kb-%@gss.test';
update profiles set role = 'admin' where email = 'kb-ceo@gss.test';
update profiles set allocation_level = 'junior' where email = 'kb-jr@gss.test';
update business_settings set data = '{"wip_per_person": 2, "aging_days": 3}' where key = 'kanban';
select pg_temp.ok((select status_changed_at is not null from tasks limit 1) or not exists (select 1 from tasks), 'old tasks get a column time');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e02');
insert into tasks (title, assigned_to) values ('T1', '00000000-0000-0000-0000-0000000b1e03'), ('T2', '00000000-0000-0000-0000-0000000b1e03'),
  ('T3', '00000000-0000-0000-0000-0000000b1e03'), ('T4', '00000000-0000-0000-0000-0000000b1e04');
commit;
select pg_temp.ok((select count(*) = 4 and bool_and(status = 'pending' and status_changed_at is not null and started_at is null) from tasks where title like 'T_'), 'new cards in To do with a column time');

-- The person pulls work into Doing, up to the WIP limit
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e03');
update tasks set status = 'in_progress' where title = 'T1';
update tasks set status = 'in_progress' where title = 'T2';
select pg_temp.fails($$update tasks set status = 'in_progress' where title = 'T3'$$, 'third card into Doing over the limit of 2');
-- a card of someone else cannot be moved
update tasks set status = 'in_progress' where title = 'T4';
commit;
select pg_temp.ok((select started_at is not null from tasks where title = 'T1'), 'start time stamped');
select pg_temp.ok((select status = 'pending' from tasks where title = 'T4'), 'cannot move another person''s card');

-- Blocked needs a reason and tells the giver; review tells the giver; done frees a WIP slot
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e03');
select pg_temp.fails($$update tasks set blocked = true where title = 'T1'$$, 'blocked without a reason');
update tasks set blocked = true, blocked_reason = 'Waiting for EB inspection date' where title = 'T1';
select pg_temp.fails($$update tasks set title = 'renamed' where title = 'T1'$$, 'staff renames the card');
update tasks set status = 'review' where title = 'T2';
update tasks set status = 'in_progress' where title = 'T3';
commit;
select pg_temp.ok((select blocked and blocked_at is not null from tasks where title = 'T1'), 'card flagged blocked');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000b1e02' and title = 'Task blocked'), 'giver told it is blocked');
select pg_temp.ok(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000b1e02' and title = 'Task ready for review'), 'giver told it is ready for review');
select pg_temp.ok((select status = 'in_progress' from tasks where title = 'T3'), 'moving one to Review made room in Doing');

begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e03');
update tasks set blocked = false where title = 'T1';
update tasks set status = 'completed' where title = 'T2';
commit;
select pg_temp.ok((select not blocked and blocked_reason is null from tasks where title = 'T1'), 'unblocked clears the reason');
select pg_temp.ok((select completed_at is not null and started_at is not null from tasks where title = 'T2'), 'done: cycle time can be measured');

-- Back from Done clears the completion; the CEO may go over the limit
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e03');
select pg_temp.fails($$update tasks set status = 'in_progress' where title = 'T2'$$, 'reopening into a full Doing column');
update tasks set status = 'review' where title = 'T2';
commit;
select pg_temp.ok((select completed_at is null from tasks where title = 'T2'), 'reopened card is no longer done');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e01');
insert into tasks (title, assigned_to, status) values ('CEO urgent', '00000000-0000-0000-0000-0000000b1e03', 'in_progress');
commit;
select pg_temp.ok((select count(*) = 3 from tasks where assigned_to = '00000000-0000-0000-0000-0000000b1e03' and status = 'in_progress'), 'the CEO can expedite over the limit');

-- Limit 0 = no limit
update business_settings set data = '{"wip_per_person": 0}' where key = 'kanban';
update tasks set status = 'pending' where title = 'T3';
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000b1e03');
update tasks set status = 'in_progress' where title = 'T3';
commit;
select pg_temp.ok((select status = 'in_progress' from tasks where title = 'T3'), 'no limit when set to 0');

select 'ALL KANBAN CHECKS PASSED';
