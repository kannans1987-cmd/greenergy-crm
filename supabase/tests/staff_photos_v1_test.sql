-- Staff photos: own photo, CEO sets anyone's, nobody else's, and only links into the staff-photos bucket.
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
grant select, insert, update, delete on storage.objects to authenticated;  -- as in Supabase

insert into auth.users (id, email, invited_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000f0e01', 'ph-ceo@gss.test', now(), '{"full_name":"PH CEO"}'),
 ('00000000-0000-0000-0000-0000000f0e02', 'ph-a@gss.test',   now(), '{"full_name":"PH A"}'),
 ('00000000-0000-0000-0000-0000000f0e03', 'ph-b@gss.test',   now(), '{"full_name":"PH B"}');
update profiles set status = 'active' where email like 'ph-%@gss.test';
update profiles set role = 'admin' where email = 'ph-ceo@gss.test';

select pg_temp.ok((select public from storage.buckets where id = 'staff-photos'), 'bucket exists');

-- A uploads and sets their own photo
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e02');
insert into storage.objects (bucket_id, name) values ('staff-photos', '00000000-0000-0000-0000-0000000f0e02/abc.jpg');
update profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/staff-photos/00000000-0000-0000-0000-0000000f0e02/abc.jpg' where id = auth.uid();
select pg_temp.fails($f$insert into storage.objects (bucket_id, name) values ('staff-photos', '00000000-0000-0000-0000-0000000f0e03/evil.jpg')$f$, 'A uploads into B''s folder');
select pg_temp.fails($f$update profiles set avatar_url = 'https://evil.example/track.png' where id = auth.uid()$f$, 'outside link as photo');
select pg_temp.fails($f$update profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/staff-photos/00000000-0000-0000-0000-0000000f0e03/b.jpg' where id = auth.uid()$f$, 'someone else''s file as own photo');
update profiles set avatar_url = 'https://x/staff-photos-hack' where id = '00000000-0000-0000-0000-0000000f0e03';  -- RLS: not A's row, nothing changes
commit;
select pg_temp.ok((select avatar_url like '%0000000f0e02/abc.jpg' from profiles where id = '00000000-0000-0000-0000-0000000f0e02'), 'A has a photo');
select pg_temp.ok((select avatar_url is null from profiles where id = '00000000-0000-0000-0000-0000000f0e03'), 'A cannot set B''s photo');

-- B cannot delete A's file; A can remove their own photo
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e03');
delete from storage.objects where bucket_id = 'staff-photos' and name like '00000000-0000-0000-0000-0000000f0e02/%';
commit;
select pg_temp.ok(exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000f0e02/abc.jpg'), 'B cannot delete A''s photo');

-- The CEO sets B's photo
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e01');
insert into storage.objects (bucket_id, name) values ('staff-photos', '00000000-0000-0000-0000-0000000f0e03/ceo.jpg');
update profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/staff-photos/00000000-0000-0000-0000-0000000f0e03/ceo.jpg' where id = '00000000-0000-0000-0000-0000000f0e03';
commit;
select pg_temp.ok((select avatar_url like '%0000000f0e03/ceo.jpg' from profiles where id = '00000000-0000-0000-0000-0000000f0e03'), 'CEO set B''s photo');

-- Removing a photo is always allowed
begin; set local role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000f0e02');
update profiles set avatar_url = null where id = auth.uid();
delete from storage.objects where bucket_id = 'staff-photos' and name like '00000000-0000-0000-0000-0000000f0e02/%';
commit;
select pg_temp.ok((select avatar_url is null from profiles where id = '00000000-0000-0000-0000-0000000f0e02'), 'A removed the photo');
select pg_temp.ok(not exists (select 1 from storage.objects where name like '00000000-0000-0000-0000-0000000f0e02/%'), 'A deleted the file');

select 'ALL STAFF PHOTO CHECKS PASSED';
