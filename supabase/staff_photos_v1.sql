-- ═══════════════════════════════════════════════════════════════
-- staff_photos_v1.sql
-- A photo for each staff member (profiles.avatar_url), shown on the dashboard, header, sidebar,
-- User Management and Team attendance.
--   · Each person uploads their own photo (My Profile); the CEO can set anyone's (User Management).
--   · Files live in the "staff-photos" bucket, one folder per person: <user id>/<random>.jpg.
--     The bucket is public-read (an <img> can show it) but file names are random, so a photo
--     cannot be found without its link; only staff see the links.
--   · avatar_url may only point at the person's own folder in this bucket (no outside links).
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public) values ('staff-photos', 'staff-photos', true)
on conflict (id) do update set public = true;
-- Images only, at most 2 MB (the app shrinks photos to about 100 KB before uploading)
do $$ begin
  update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'staff-photos';
exception when undefined_column then null;   -- older storage versions: the app still limits size and type
end $$;

drop policy if exists "staff photos read" on storage.objects;
create policy "staff photos read" on storage.objects for select
  using (bucket_id = 'staff-photos' and is_staff());
drop policy if exists "staff photos upload" on storage.objects;
create policy "staff photos upload" on storage.objects for insert
  with check (bucket_id = 'staff-photos' and is_staff() and (split_part(name, '/', 1) = auth.uid()::text or is_admin()));
drop policy if exists "staff photos replace" on storage.objects;
create policy "staff photos replace" on storage.objects for update
  using (bucket_id = 'staff-photos' and (split_part(name, '/', 1) = auth.uid()::text or is_admin()));
drop policy if exists "staff photos remove" on storage.objects;
create policy "staff photos remove" on storage.objects for delete
  using (bucket_id = 'staff-photos' and (split_part(name, '/', 1) = auth.uid()::text or is_admin()));

-- The photo link must be this person's own file in staff-photos (or empty)
create or replace function profile_avatar_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url
     and position('/storage/v1/object/public/staff-photos/' || new.id::text || '/' in new.avatar_url) = 0 then
    raise exception 'The photo must be uploaded from the CRM (My Profile or User Management).';
  end if;
  return new;
end;$$;
drop trigger if exists trg_profile_avatar_guard on profiles;
create trigger trg_profile_avatar_guard before update of avatar_url on profiles
  for each row execute function profile_avatar_guard();
