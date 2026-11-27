-- Quotations: "view all, changes need the CEO" (27 Nov 2026)
--  * profiles.quotation_view: set by the CEO in User Management. The person sees EVERY quotation
--    (list, details, line items, history, comments, follow-ups, files) and can log phone / walk-in
--    enquiries. Supplier cost and margin stay CEO / admin manager only (quotation_costings).
--  * They cannot change a quotation they are not working on. Instead they send a change request:
--    new values for customer / site details, and / or a written request (price, size, stage …).
--    The CEO approves (the values are applied, with history) or rejects it, with a note.
--  * Quotations they are assigned to (sales / site visit / follow-up) work exactly as before.
--  * First run only: active Admin Executives and Project Managers get this access.
-- Needs quotation_access_v1.sql. Safe to run more than once.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'quotation_view') then
    alter table profiles add column quotation_view boolean not null default false;
    update profiles set quotation_view = true
      where role = 'employee' and status = 'active'
        and coalesce(designation, '') ~* '(admin(istrative)? executive|project manager)';
  end if;
end $$;

create or replace function can_view_all_quotations()
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or can_manage_quotations()
      or exists (select 1 from profiles where id = auth.uid() and status = 'active' and quotation_view);
$$;

-- Reading only. can_view_quotation() keeps deciding who may WRITE follow-ups, comments and history.
create or replace function can_read_quotation(p_quotation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_view_all_quotations() or can_view_quotation(p_quotation);
$$;

-- Only the CEO gives or removes it (same rule as the other access rights)
create or replace function profile_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.price_access is distinct from old.price_access or new.email is distinct from old.email
     or new.approved_by is distinct from old.approved_by
     or new.quotation_access is distinct from old.quotation_access
     or new.quotation_view is distinct from old.quotation_view then
    raise exception 'Only the CEO can change role, status or access rights.';
  end if;
  return new;
end;$$;

drop policy if exists "managers_read_quotations" on quotation_requests;
create policy "managers_read_quotations" on quotation_requests for select using (can_view_all_quotations());
-- Phone / walk-in enquiries
drop policy if exists "managers_insert_quotations" on quotation_requests;
create policy "managers_insert_quotations" on quotation_requests for insert with check (can_view_all_quotations());

drop policy if exists "viewers_read_lineitems" on quotation_line_items;
create policy "viewers_read_lineitems" on quotation_line_items for select using (can_view_all_quotations());

drop policy if exists "View status history" on quotation_status_history;
create policy "View status history" on quotation_status_history for select using (can_read_quotation(quotation_id));
drop policy if exists "View comments" on quotation_comments;
create policy "View comments" on quotation_comments for select
  using (can_read_quotation(quotation_id) and (not is_internal or is_manager() or author_id = auth.uid()));
drop policy if exists "View follow-ups" on quotation_follow_ups;
create policy "View follow-ups" on quotation_follow_ups for select using (can_read_quotation(quotation_id));
drop policy if exists "View documents" on project_documents;
create policy "View documents" on project_documents for select using (
  is_manager() or (project_id is not null and can_view_project(project_id))
  or (quotation_id is not null and can_read_quotation(quotation_id)));

-- ═══ Change requests ═══
create table if not exists quotation_change_requests (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotation_requests(id) on delete cascade,
  requested_by  uuid not null references profiles(id),
  changes       jsonb not null default '{}'::jsonb,   -- {"field": "new value"}
  old_values    jsonb not null default '{}'::jsonb,   -- the same fields when asked
  request_note  text,                                 -- anything else: price, size, stage …
  reason        text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by    uuid references profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create index if not exists quotation_change_requests_q on quotation_change_requests (quotation_id, created_at desc);
create index if not exists quotation_change_requests_pending on quotation_change_requests (created_at) where status = 'pending';
alter table quotation_change_requests enable row level security;
drop policy if exists "Read change requests" on quotation_change_requests;
create policy "Read change requests" on quotation_change_requests for select
  using (requested_by = auth.uid() or is_manager() or (can_read_quotation(quotation_id) and can_view_all_quotations()));
-- Written only through the functions below
revoke insert, update, delete on quotation_change_requests from anon, authenticated;
grant select on quotation_change_requests to authenticated;

-- Fields a request can change directly. Anything else (price, size, stage, people) goes in the note.
create or replace function quotation_change_fields()
returns text[] language sql immutable as $$
  select array['customer_name', 'mobile', 'email', 'city', 'address', 'pincode', 'eb_consumer_number',
               'avg_monthly_bill', 'avg_monthly_units', 'sanctioned_load_kw', 'roof_type', 'available_roof_area_sqft',
               'current_phase', 'notes', 'priority'];
$$;

create or replace function request_quotation_change(p_quotation uuid, p_changes jsonb, p_note text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q      quotation_requests%rowtype;
  clean  jsonb := '{}'::jsonb;
  olds   jsonb := '{}'::jsonb;
  k      text;
  v      jsonb;
  cur    jsonb;
  new_id uuid;
  who    text;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if not can_read_quotation(p_quotation) then raise exception 'You do not have access to this quotation.'; end if;
  select * into q from quotation_requests where id = p_quotation;
  if not found then raise exception 'Quotation not found.'; end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then raise exception 'Say why the change is needed.'; end if;
  if (select count(*) from quotation_change_requests where requested_by = auth.uid() and status = 'pending') >= 30 then
    raise exception 'You have 30 change requests waiting for the CEO already.';
  end if;

  cur := to_jsonb(q);
  for k, v in select * from jsonb_each(coalesce(p_changes, '{}'::jsonb)) loop
    if not (k = any (quotation_change_fields())) then
      raise exception 'The field "%" cannot be changed by a request. Describe it in "Other changes".', k;
    end if;
    if jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '' then v := 'null'::jsonb; end if;
    if (cur -> k) is distinct from v and coalesce(cur ->> k, '') is distinct from coalesce(v #>> '{}', '') then
      clean := clean || jsonb_build_object(k, v);
      olds  := olds  || jsonb_build_object(k, coalesce(cur -> k, 'null'::jsonb));
    end if;
  end loop;
  p_note := nullif(btrim(left(p_note, 2000)), '');
  if clean = '{}'::jsonb and p_note is null then raise exception 'Nothing to change: edit a field or describe the change.'; end if;

  insert into quotation_change_requests (quotation_id, requested_by, changes, old_values, request_note, reason)
    values (p_quotation, auth.uid(), clean, olds, p_note, btrim(left(p_reason, 500)))
    returning id into new_id;

  select full_name into who from profiles where id = auth.uid();
  insert into notifications (user_id, type, title, message, link)
    select id, 'quotation', 'Change request: ' || q.quotation_number,
           coalesce(who, 'Staff') || ' asks to change ' || q.customer_name || '''s quotation: ' || btrim(left(p_reason, 140)),
           '/staff/quotations/' || q.id
      from profiles where role = 'admin' and status = 'active';
  return new_id;
end;$$;
revoke all on function request_quotation_change(uuid, jsonb, text, text) from public, anon;
grant execute on function request_quotation_change(uuid, jsonb, text, text) to authenticated;

-- The requester can take back a request the CEO has not decided yet
create or replace function withdraw_quotation_change(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update quotation_change_requests set status = 'withdrawn', decided_at = now()
    where id = p_id and requested_by = auth.uid() and status = 'pending';
  if not found then raise exception 'That request is not yours or has already been decided.'; end if;
end;$$;
revoke all on function withdraw_quotation_change(uuid) from public, anon;
grant execute on function withdraw_quotation_change(uuid) to authenticated;

create or replace function decide_quotation_change(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      quotation_change_requests%rowtype;
  q      quotation_requests%rowtype;
  k      text;
  v      jsonb;
  typ    text;
  n      int := 0;
begin
  if not is_admin() then raise exception 'Only the CEO approves change requests.'; end if;
  select * into r from quotation_change_requests where id = p_id for update;
  if not found then raise exception 'Change request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %.', r.status; end if;
  if not p_approve and coalesce(length(btrim(p_note)), 0) < 3 then raise exception 'Say why you are rejecting it.'; end if;

  if p_approve then
    for k, v in select * from jsonb_each(r.changes) loop
      if not (k = any (quotation_change_fields())) then continue; end if;
      select format_type(a.atttypid, a.atttypmod) into typ from pg_attribute a
        where a.attrelid = 'public.quotation_requests'::regclass and a.attname = k and not a.attisdropped;
      if typ is null then continue; end if;
      execute format('update quotation_requests set %I = ($1 #>> ''{}'')::%s, updated_at = now() where id = $2', k, typ)
        using v, r.quotation_id;
      n := n + 1;
    end loop;
  end if;

  update quotation_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(left(p_note, 500)), '')
   where id = p_id;

  select * into q from quotation_requests where id = r.quotation_id;
  insert into quotation_comments (quotation_id, author_id, author_name, content, is_internal)
    select q.id, auth.uid(), p.full_name,
           case when p_approve then 'Change request approved' else 'Change request rejected' end
             || ' (asked by ' || coalesce((select full_name from profiles where id = r.requested_by), 'staff') || ': ' || r.reason || ')'
             || case when n > 0 then '. Updated: ' || (select string_agg(x, ', ') from jsonb_object_keys(r.changes) x) else '' end
             || case when nullif(btrim(p_note), '') is not null then '. CEO: ' || btrim(p_note) else '' end,
           false
      from profiles p where p.id = auth.uid();
  insert into notifications (user_id, type, title, message, link)
    values (r.requested_by, 'quotation',
            case when p_approve then 'Change approved: ' else 'Change rejected: ' end || q.quotation_number,
            q.customer_name || case when nullif(btrim(p_note), '') is not null then ' · CEO: ' || btrim(left(p_note, 200)) else '' end
              || case when p_approve and r.request_note is not null then ' · The CEO will make the other changes you asked for.' else '' end,
            '/staff/quotations/' || q.id);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'fields_applied', n);
end;$$;
revoke all on function decide_quotation_change(uuid, boolean, text) from public, anon;
grant execute on function decide_quotation_change(uuid, boolean, text) to authenticated;
