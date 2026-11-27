-- ═══════════════════════════════════════════════════════════════
-- super_admin_v1.sql
-- Super Admin: a second person with everything the CEO has, except:
--   · cannot change, deactivate or delete the CEO (or another Super Admin)
--   · cannot make anyone CEO or Super Admin, and cannot change their own role or status
--   · every change they make is recorded and flagged to the CEO ("Super Admin activity"),
--     which only the CEO can read and mark as reviewed; nobody can edit or delete it.
-- A Super Admin is role 'admin' with super_admin = true, so every CEO screen and rule works for them.
-- The CEO is role 'admin' with super_admin = false.
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

alter table profiles add column if not exists super_admin boolean not null default false;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active' and super_admin);
$$;
create or replace function is_ceo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active' and not super_admin);
$$;
grant execute on function is_super_admin(), is_ceo() to authenticated;

-- ── Protect the CEO; only the CEO hands out CEO / Super Admin ──
create or replace function profile_super_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Leaving the admin role also ends Super Admin
  if tg_op <> 'DELETE' and new.role <> 'admin' then new.super_admin := false; end if;
  if auth.uid() is null then return coalesce(new, old); end if;   -- server (its own checks)
  if tg_op = 'DELETE' then
    if is_super_admin() and old.role = 'admin' then raise exception 'A Super Admin cannot delete the CEO or another Super Admin.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if (new.super_admin or new.role = 'admin') and not is_ceo() then raise exception 'Only the CEO can give CEO or Super Admin access.'; end if;
    return new;
  end if;
  if new.super_admin is distinct from old.super_admin and not is_ceo() then
    raise exception 'Only the CEO can make or remove a Super Admin.';
  end if;
  if is_super_admin() then
    if old.role = 'admin' and old.id <> auth.uid() then
      raise exception 'A Super Admin cannot change the account of the CEO or another Super Admin.';
    end if;
    if new.role = 'admin' and old.role <> 'admin' then raise exception 'Only the CEO can give CEO or Super Admin access.'; end if;
    if old.id = auth.uid() and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'Only the CEO can change your role or status.';
    end if;
  end if;
  return new;
end;$$;
drop trigger if exists trg_profile_super_guard on profiles;
create trigger trg_profile_super_guard before insert or update or delete on profiles
  for each row execute function profile_super_guard();

-- ── What the Super Admin did ──
create table if not exists super_admin_changes (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references profiles(id) on delete set null,
  actor_name  text,
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('insert', 'update', 'delete', 'action')),
  summary     text not null,
  changes     jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id) on delete set null
);
create index if not exists super_admin_changes_open on super_admin_changes (at desc) where reviewed_at is null;
create index if not exists super_admin_changes_at on super_admin_changes (at desc);
alter table super_admin_changes enable row level security;
drop policy if exists "ceo reads super admin changes" on super_admin_changes;
create policy "ceo reads super admin changes" on super_admin_changes for select using (is_ceo());
drop policy if exists "ceo reviews super admin changes" on super_admin_changes;
create policy "ceo reviews super admin changes" on super_admin_changes for update using (is_ceo()) with check (is_ceo());
-- no insert / delete policies: only the functions below write here

-- The CEO may only mark a change reviewed (or not), never rewrite it
create or replace function super_admin_changes_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'reviewed_at' - 'reviewed_by') is distinct from (to_jsonb(old) - 'reviewed_at' - 'reviewed_by') then
    raise exception 'The Super Admin activity record cannot be changed.';
  end if;
  new.reviewed_by := case when new.reviewed_at is null then null else auth.uid() end;
  return new;
end;$$;
drop trigger if exists trg_super_admin_changes_guard on super_admin_changes;
create trigger trg_super_admin_changes_guard before update on super_admin_changes
  for each row execute function super_admin_changes_guard();

-- Plain names for the record types
create or replace function super_admin_label(t text)
returns text language sql immutable as $$
  select case t
    when 'quotation_requests' then 'Quotation' when 'projects' then 'Project' when 'tasks' then 'Task'
    when 'leaves' then 'Leave' when 'attendance' then 'Attendance' when 'profiles' then 'Staff profile'
    when 'business_settings' then 'Business rules' when 'pricing_config' then 'Price list'
    when 'service_tickets' then 'Service job' when 'payments' then 'Payment' when 'job_cards' then 'Job card'
    when 'trusted_devices' then 'Attendance phone' when 'office_locations' then 'Office location'
    when 'quotation_change_requests' then 'Quotation change request' when 'employee_registrations' then 'Staff registration'
    else initcap(replace(t, '_', ' ')) end;
$$;

-- Record one change and tell the CEO (one running notification per 30 minutes, not one per change).
-- Does nothing unless p_actor is an active Super Admin.
create or replace function super_admin_flag(p_actor uuid, p_table text, p_row text, p_action text, p_summary text, p_changes jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare who text; c record; nid uuid; open_n int;
begin
  select full_name into who from profiles where id = p_actor and role = 'admin' and super_admin;
  if who is null then return; end if;
  insert into super_admin_changes (actor, actor_name, table_name, row_id, action, summary, changes)
  values (p_actor, who, p_table, p_row, p_action, left(p_summary, 300), p_changes);
  select count(*) into open_n from super_admin_changes where actor = p_actor and reviewed_at is null;
  for c in select id from profiles where role = 'admin' and status = 'active' and not super_admin loop
    nid := null;
    select id into nid from notifications
     where user_id = c.id and type = 'super_admin' and not coalesce(is_read, false) and created_at > now() - interval '30 minutes'
     order by created_at desc limit 1;
    if nid is null then
      insert into notifications (user_id, type, title, message, link)
      values (c.id, 'super_admin', 'Super Admin change', who || ' (Super Admin): ' || left(p_summary, 200) || '. ' || open_n || ' change(s) to review.', '/staff/admin/super-activity');
    else
      update notifications set message = who || ' (Super Admin): ' || left(p_summary, 200) || '. ' || open_n || ' change(s) to review.', created_at = now()
       where id = nid;
    end if;
  end loop;
end;$$;
revoke all on function super_admin_flag(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function super_admin_flag(uuid, text, text, text, text, jsonb) to service_role;

-- On every table: when the person making the change is a Super Admin, flag it
create or replace function super_admin_track()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); o jsonb; n jsonb; d jsonb := '{}'; k text; j jsonb; lbl text; cols text;
begin
  if actor is null then return null; end if;
  if not exists (select 1 from profiles where id = actor and role = 'admin' and super_admin) then return null; end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'status_changed_at', 'last_used_at') and (n -> k) is distinct from (o -> k) then
        d := d || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
      end if;
    end loop;
    if d = '{}'::jsonb then return null; end if;
    select string_agg(x, ', ') into cols from jsonb_object_keys(d) x;
  else
    d := coalesce(n, o);
  end if;
  j := coalesce(n, o);
  lbl := coalesce(j ->> 'quotation_number', j ->> 'project_number', j ->> 'ticket_number', j ->> 'job_card_number',
                  j ->> 'title', j ->> 'full_name', j ->> 'customer_name', j ->> 'name', j ->> 'key');
  perform super_admin_flag(actor, tg_table_name, coalesce(j ->> 'id', j ->> 'key'),
    lower(tg_op),
    super_admin_label(tg_table_name) || ' ' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'deleted' end
      || coalesce(' · ' || lbl, '') || coalesce(' (' || cols || ')', ''),
    d);
  return null;
end;$$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r'
              and c.relname not in ('notifications', 'super_admin_changes', 'audit_log')
  loop
    execute format('drop trigger if exists trg_zz_super_admin_track on public.%I', t);
    execute format('create trigger trg_zz_super_admin_track after insert or update or delete on public.%I for each row execute function super_admin_track()', t);
  end loop;
end $$;

-- Server actions (User Management, login links, registrations, price list, quotation delete) write the
-- audit log with the person who asked; flag those made by a Super Admin too.
create or replace function super_admin_track_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.action_by is not null then
    perform super_admin_flag(new.action_by, coalesce(new.target_entity, 'audit_log'), new.target_id::text, 'action',
      coalesce(new.description, new.action_type), jsonb_build_object('action', new.action_type));
  end if;
  return null;
end;$$;
drop trigger if exists trg_zz_super_admin_audit on audit_log;
create trigger trg_zz_super_admin_audit after insert on audit_log
  for each row execute function super_admin_track_audit();
