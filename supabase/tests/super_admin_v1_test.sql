-- Super Admin: CEO powers, cannot touch the CEO, every change flagged to the CEO.
-- Run on a THROWAWAY database after the setup scripts (see README.md). Raises an error on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $f$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $f$;
create or replace function pg_temp.fails(stmt text, what text) returns void language plpgsql as $f$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have been refused): %', what;
end $f$;
create or replace function pg_temp.act(u text) returns void language sql as $f$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claim.role', 'authenticated', true);
$f$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- e01 CEO · e02 Super Admin · e03 staff · e04 staff
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000005ae01', 'sa-ceo@gss.test',   now(), '{"full_name":"SA CEO"}'),
 ('00000000-0000-0000-0000-00000005ae02', 'sa-super@gss.test', now(), '{"full_name":"SA Super"}'),
 ('00000000-0000-0000-0000-00000005ae03', 'sa-staff@gss.test', now(), '{"full_name":"SA Staff"}'),
 ('00000000-0000-0000-0000-00000005ae04', 'sa-staff2@gss.test', now(), '{"full_name":"SA Staff Two"}');
update profiles set status = 'active' where email like 'sa-%@gss.test';
update profiles set role = 'admin' where email = 'sa-ceo@gss.test';

-- Only the CEO makes a Super Admin
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae03');
update profiles set super_admin = true where id = auth.uid();
commit;
select pg_temp.ok((select not super_admin from profiles where id = '00000000-0000-0000-0000-00000005ae03'), 'staff cannot make themselves Super Admin');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae01');
update profiles set role = 'admin', super_admin = true where id = '00000000-0000-0000-0000-00000005ae02';
select pg_temp.ok(is_ceo() and not is_super_admin(), 'CEO is the CEO');
commit;
select pg_temp.ok(not exists (select 1 from super_admin_changes), 'CEO changes are not flagged');

-- The Super Admin has the CEO's powers…
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae02');
select pg_temp.ok(is_admin() and is_super_admin() and not is_ceo(), 'Super Admin is an admin, not the CEO');
update profiles set designation = 'Site Engineer' where id = '00000000-0000-0000-0000-00000005ae03';
insert into tasks (title, assigned_to) values ('Super task', '00000000-0000-0000-0000-00000005ae04');
update profiles set phone = '+91 90000 11111' where id = auth.uid();   -- own contact details: fine
commit;
select pg_temp.ok((select designation = 'Site Engineer' from profiles where id = '00000000-0000-0000-0000-00000005ae03'), 'Super Admin edits staff');

-- …but cannot touch the CEO, promote anyone, or change their own access
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae02');
select pg_temp.fails($f$update profiles set status = 'inactive' where id = '00000000-0000-0000-0000-00000005ae01'$f$, 'Super Admin deactivates the CEO');
select pg_temp.fails($f$update profiles set role = 'employee' where id = '00000000-0000-0000-0000-00000005ae01'$f$, 'Super Admin demotes the CEO');
select pg_temp.fails($f$update profiles set full_name = 'Not the CEO' where id = '00000000-0000-0000-0000-00000005ae01'$f$, 'Super Admin edits the CEO');
delete from profiles where id = '00000000-0000-0000-0000-00000005ae01';   -- no delete policy on profiles: nothing happens
select pg_temp.fails($f$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000005ae03'$f$, 'Super Admin makes someone CEO');
select pg_temp.fails($f$update profiles set super_admin = false where id = auth.uid()$f$, 'Super Admin turns themselves into the CEO');
select pg_temp.fails($f$update profiles set role = 'employee' where id = auth.uid()$f$, 'Super Admin changes own role');
commit;
select pg_temp.ok((select role = 'admin' and status = 'active' and not super_admin and full_name = 'SA CEO' from profiles where id = '00000000-0000-0000-0000-00000005ae01'), 'CEO untouched');

-- Every change was flagged, with what changed; the CEO got one running notification
select pg_temp.ok((select count(*) = 3 from super_admin_changes where actor = '00000000-0000-0000-0000-00000005ae02'), 'three changes flagged');
select pg_temp.ok(exists (select 1 from super_admin_changes where table_name = 'profiles' and action = 'update'
  and changes -> 'designation' ->> 'to' = 'Site Engineer' and summary like 'Staff profile changed · SA Staff (designation)%'), 'profile change recorded with before / after');
select pg_temp.ok(exists (select 1 from super_admin_changes where table_name = 'tasks' and action = 'insert' and summary like 'Task added · Super task%'), 'new task recorded');
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-00000005ae01' and type = 'super_admin'), 'CEO notified once (grouped)');
select pg_temp.ok((select message like '%3 change(s) to review%' from notifications where user_id = '00000000-0000-0000-0000-00000005ae01' and type = 'super_admin'), 'notification counts the changes');
select pg_temp.ok(not exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000005ae02' and type = 'super_admin'), 'Super Admin not told about own changes');

-- A server action (audit log) by the Super Admin is flagged too
insert into audit_log (action_by, action_type, target_entity, target_id, description)
values ('00000000-0000-0000-0000-00000005ae02', 'staff_status_changed', 'profiles', '00000000-0000-0000-0000-00000005ae04', 'SA Staff Two is now inactive.');
insert into audit_log (action_by, action_type, target_entity, description) values ('00000000-0000-0000-0000-00000005ae01', 'x', 'profiles', 'CEO action');
select pg_temp.ok((select count(*) = 4 from super_admin_changes), 'Super Admin server action flagged, CEO action not');
select pg_temp.ok(exists (select 1 from super_admin_changes where action = 'action' and summary = 'SA Staff Two is now inactive.'), 'server action recorded');

-- Only the CEO reads the record; nobody rewrites or deletes it
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae02');
select pg_temp.ok((select count(*) = 0 from super_admin_changes), 'Super Admin cannot read the record');
delete from super_admin_changes;
update super_admin_changes set reviewed_at = now();
select pg_temp.fails($f$select super_admin_flag(auth.uid(), 'tasks', null, 'action', 'fake', null)$f$, 'Super Admin calls the flag function');
commit;
select pg_temp.ok((select count(*) = 4 and bool_and(reviewed_at is null) from super_admin_changes), 'record not deleted or reviewed by the Super Admin');
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae01');
select pg_temp.ok((select count(*) = 4 from super_admin_changes), 'CEO reads the record');
select pg_temp.fails($f$update super_admin_changes set summary = 'nothing' where table_name = 'tasks'$f$, 'CEO rewrites the record');
update super_admin_changes set reviewed_at = now() where table_name = 'tasks';
delete from super_admin_changes;   -- no delete policy: nothing happens
commit;
select pg_temp.ok((select count(*) = 4 from super_admin_changes), 'record cannot be deleted');
select pg_temp.ok((select reviewed_by = '00000000-0000-0000-0000-00000005ae01' from super_admin_changes where table_name = 'tasks'), 'CEO marked it reviewed');

-- Staff changes are not flagged
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae03');
update profiles set phone = '+91 90000 22222' where id = auth.uid();
commit;
select pg_temp.ok((select count(*) = 4 from super_admin_changes), 'staff changes not flagged');

-- The CEO removes Super Admin: back to staff, flag cleared
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000005ae01');
update profiles set role = 'employee' where id = '00000000-0000-0000-0000-00000005ae02';
commit;
select pg_temp.ok((select role = 'employee' and not super_admin from profiles where id = '00000000-0000-0000-0000-00000005ae02'), 'demoted Super Admin loses the flag');

select 'ALL SUPER ADMIN CHECKS PASSED';
