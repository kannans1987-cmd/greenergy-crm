-- Quotation access v1 (26 Nov 2026)
--  * The CEO can give a staff member "Quotations: edit & delete" in User Management
--    (profiles.quotation_access). They see and edit every quotation and may delete wrong ones.
--  * Only the CEO and those people can delete a quotation (the admin manager no longer can by default).
--  * A quotation with a numbered job card can never be deleted, by anyone.
-- Safe to run more than once.

alter table profiles add column if not exists quotation_access boolean not null default false;

create or replace function can_manage_quotations()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and status = 'active' and quotation_access);
$$;

-- Only the CEO gives or removes this access (same rule as role, status and price access)
create or replace function profile_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.price_access is distinct from old.price_access or new.email is distinct from old.email
     or new.approved_by is distinct from old.approved_by
     or new.quotation_access is distinct from old.quotation_access then
    raise exception 'Only the CEO can change role, status or access rights.';
  end if;
  return new;
end;$$;

-- Managers keep read / create / edit; deleting becomes its own, narrower rule
drop policy if exists "admin_full_quotations" on quotation_requests;
drop policy if exists "managers_read_quotations" on quotation_requests;
create policy "managers_read_quotations" on quotation_requests for select using (is_manager() or can_manage_quotations());
drop policy if exists "managers_insert_quotations" on quotation_requests;
create policy "managers_insert_quotations" on quotation_requests for insert with check (is_manager() or can_manage_quotations());
drop policy if exists "managers_update_quotations" on quotation_requests;
create policy "managers_update_quotations" on quotation_requests for update using (is_manager() or can_manage_quotations());
drop policy if exists "delete_quotations" on quotation_requests;
create policy "delete_quotations" on quotation_requests for delete using (can_manage_quotations());

drop policy if exists "delegate_lineitems" on quotation_line_items;
create policy "delegate_lineitems" on quotation_line_items for all using (can_manage_quotations()) with check (can_manage_quotations());

-- History, comments and follow-ups of every quotation are visible to the people who manage them
create or replace function can_view_quotation(p_quotation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or can_manage_quotations() or exists (
    select 1 from quotation_requests q where q.id = p_quotation and is_staff()
       and (q.assigned_sales_id = auth.uid() or q.assigned_engineer_id = auth.uid() or q.follow_up_manager_id = auth.uid()));
$$;

-- Never delete a quotation that became a job card (applies to server calls too)
create or replace function quotation_delete_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.project_id is not null or old.job_number is not null or old.status = 'project_created'
     or exists (select 1 from projects where quotation_id = old.id) then
    raise exception 'Quotation % has a job card (%) and cannot be deleted.', old.quotation_number, coalesce(old.job_number, 'project');
  end if;
  return old;
end;$$;
drop trigger if exists trg_quotation_delete_guard on quotation_requests;
create trigger trg_quotation_delete_guard before delete on quotation_requests
  for each row execute function quotation_delete_guard();
