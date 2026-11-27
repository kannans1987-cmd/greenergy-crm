-- Work allocation levels: Sr / Jr Admin Manager (27 Nov 2026)
--  * profiles.allocation_level, set by the CEO in User Management:
--      senior : "Sr Admin Manager" — allocates work to anyone in the organisation
--      junior : "Jr Admin Manager" — allocates work to anyone except a Sr Admin Manager
--  * "Allocating work" means: creating and giving tasks, choosing the three people on a quotation
--    (site visit, prepares, follows up) and planning the site visit, and giving service jobs to a
--    technician. The database checks every allocation, not just the screen.
--  * It does not make them CEO / admin manager: supplier cost and margin stay hidden, and changes to a
--    quotation they are not working on still go to the CEO as a change request (quotation_view_v1.sql).
--  * Tasks: allocators see every task and change the ones they gave. The person a task is given to can
--    only update its progress (they can no longer reassign it).
-- Needs quotation_view_v1.sql and service_v1.sql. Safe to run more than once.

alter table profiles add column if not exists allocation_level text;
alter table profiles drop constraint if exists profiles_allocation_level_check;
alter table profiles add constraint profiles_allocation_level_check check (allocation_level is null or allocation_level in ('senior', 'junior'));

-- Only the CEO gives or removes it (same rule as the other access rights)
create or replace function profile_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.price_access is distinct from old.price_access or new.email is distinct from old.email
     or new.approved_by is distinct from old.approved_by
     or new.quotation_access is distinct from old.quotation_access
     or new.quotation_view is distinct from old.quotation_view
     or new.allocation_level is distinct from old.allocation_level then
    raise exception 'Only the CEO can change role, status or access rights.';
  end if;
  return new;
end;$$;

create or replace function my_allocation_level()
returns text language sql stable security definer set search_path = public as $$
  select allocation_level from profiles where id = auth.uid() and status = 'active' and role = 'employee';
$$;

-- May this person allocate work at all?
create or replace function can_allocate()
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or my_allocation_level() is not null;
$$;

-- May this person give work to p_target? (CEO / admin manager: anyone active; Sr: anyone active;
-- Jr: anyone active except a Sr Admin Manager.) Empty = taking the work away, always allowed to allocators.
create or replace function can_allocate_to(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not can_allocate() then false
    when p_target is null then true
    when not exists (select 1 from profiles where id = p_target and status = 'active') then false
    when is_manager() then true
    when my_allocation_level() = 'senior' then true
    else not exists (select 1 from profiles where id = p_target and allocation_level = 'senior' and role = 'employee')
  end;
$$;

create or replace function allocation_refusal()
returns text language sql stable security definer set search_path = public as $$
  select case when my_allocation_level() = 'junior'
    then 'A Jr Admin Manager can allocate work to anyone except a Sr Admin Manager. Ask the Sr Admin Manager or the CEO.'
    else 'You can only allocate work to active staff.' end;
$$;

-- Allocators see every quotation (to allocate it); costing stays CEO / admin manager only
create or replace function can_view_all_quotations()
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or can_manage_quotations()
      or exists (select 1 from profiles where id = auth.uid() and status = 'active' and (quotation_view or allocation_level is not null));
$$;

-- ═══ Quotations ═══
drop policy if exists "allocators_update_quotations" on quotation_requests;
create policy "allocators_update_quotations" on quotation_requests for update
  using (my_allocation_level() is not null) with check (my_allocation_level() is not null);

-- The quotation history records who allocated / planned the visit
drop policy if exists "Add status history" on quotation_status_history;
create policy "Add status history" on quotation_status_history for insert
  with check ((can_view_quotation(quotation_id) or can_allocate()) and changed_by = auth.uid());

create or replace function quotation_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_from  text := old.status;
  v_to    text := new.status;
  v_move  text := old.status || '>' || new.status;
  v_conv  boolean := coalesce(current_setting('greenergy.converting', true), '') = 'on';
begin
  -- Server-side service calls (public form, customer portal) and the SQL editor run without a user
  if v_uid is null then
    if v_to = 'customer_accepted' and v_from <> 'customer_accepted' and new.customer_response_at is null then
      new.customer_response_at := now();
    end if;
    return new;
  end if;

  v_role := my_role();
  if v_role is null then raise exception 'Your staff account is not active.'; end if;

  if v_from = 'project_created' and not v_conv then
    raise exception 'This quotation has a job card (%) and is locked.', old.job_number;
  end if;

  -- Job-card number and project link only come from convert_quotation_to_project()
  if not v_conv and (new.job_number is distinct from old.job_number or new.project_id is distinct from old.project_id
                     or new.converted_at is distinct from old.converted_at or new.converted_by is distinct from old.converted_by) then
    raise exception 'Job card numbers are issued only by "Create job card".';
  end if;
  if not v_conv and v_to = 'project_created' then
    raise exception 'Use "Create job card" to convert an accepted, hot quotation.';
  end if;

  -- Only managers and the Sr / Jr Admin Managers reassign people (allocation_levels_v1.sql)
  if v_role = 'employee' and (new.assigned_sales_id is distinct from old.assigned_sales_id
       or new.assigned_engineer_id is distinct from old.assigned_engineer_id
       or new.follow_up_manager_id is distinct from old.follow_up_manager_id) then
    if not can_allocate() then
      raise exception 'Only the CEO, the admin manager or a Sr / Jr Admin Manager can reassign a quotation.';
    end if;
    if (new.assigned_sales_id is distinct from old.assigned_sales_id and not can_allocate_to(new.assigned_sales_id))
       or (new.assigned_engineer_id is distinct from old.assigned_engineer_id and not can_allocate_to(new.assigned_engineer_id))
       or (new.follow_up_manager_id is distinct from old.follow_up_manager_id and not can_allocate_to(new.follow_up_manager_id)) then
      raise exception '%', allocation_refusal();
    end if;
  end if;

  -- Stage moves
  if v_from <> v_to then
    if quotation_editable(v_from) and (quotation_editable(v_to) or v_to = 'owner_approval_pending') then
      null;                                                     -- prepare / submit for approval
    elsif v_from = 'owner_approval_pending' and v_to in ('approved','more_info_requested','rejected') then
      if v_role <> 'admin' then raise exception 'Only the CEO can approve, reject or send back a quotation.'; end if;
    elsif v_from = 'owner_approval_pending' and v_to = 'drafted' then
      null;                                                     -- withdrawn or sent back for changes
    elsif v_move in ('approved>sent_to_customer','sent_to_customer>customer_accepted','customer_accepted>advance_pending') then
      null;
    elsif v_from in ('approved','sent_to_customer','customer_accepted','advance_pending') and v_to = 'drafted' then
      -- Revision: approval is cleared and the old customer link stops working
      new.revision         := old.revision + 1;
      new.approved_by      := null;
      new.approved_by_name := null;
      new.approved_at      := null;
      new.portal_token     := uuid_generate_v4();
    elsif v_from in ('sent_to_customer','customer_accepted','advance_pending') and v_to = 'cancelled' then
      null;                                                     -- lost / declined
    elsif quotation_editable(v_from) and v_to in ('cancelled','rejected') then
      if v_role = 'employee' then raise exception 'Only the CEO or admin manager can close this quotation.'; end if;
    elsif v_from in ('cancelled','rejected') and v_to = 'drafted' then
      if v_role = 'employee' then raise exception 'Only the CEO or admin manager can reopen a quotation.'; end if;
    elsif v_to = 'project_created' and v_conv then
      null;
    else
      raise exception 'A quotation cannot move from "%" to "%".', v_from, v_to;
    end if;
  end if;

  -- Approval is stamped by the database, never by the client
  if v_to = 'approved' and v_from <> 'approved' then
    new.approved_by      := v_uid;
    new.approved_by_name := my_name();
    new.approved_at      := now();
    new.reviewed_by      := v_uid;
    new.reviewed_at      := now();
  elsif v_to = 'approved' and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'Approval details cannot be edited.';
  elsif v_to <> 'approved' and v_from = v_to and (new.approved_by is distinct from old.approved_by) then
    raise exception 'Approval details cannot be edited.';
  end if;

  -- Prices and scope change only while editable (a revision makes it editable again)
  if not (quotation_editable(v_to) or (quotation_editable(v_from) and v_to = 'owner_approval_pending')) and (
       new.admin_capacity_kw is distinct from old.admin_capacity_kw or new.admin_system_cost is distinct from old.admin_system_cost
    or new.admin_gst_amount  is distinct from old.admin_gst_amount  or new.admin_total_cost  is distinct from old.admin_total_cost
    or new.admin_subsidy     is distinct from old.admin_subsidy     or new.admin_net_cost    is distinct from old.admin_net_cost
    or new.central_subsidy   is distinct from old.central_subsidy   or new.state_subsidy     is distinct from old.state_subsidy
    or new.price_per_kw      is distinct from old.price_per_kw      or new.discount          is distinct from old.discount
    or new.region            is distinct from old.region            or new.panel_type        is distinct from old.panel_type
    or new.solar_type        is distinct from old.solar_type        or new.consumer_type     is distinct from old.consumer_type
    or new.valid_until       is distinct from old.valid_until) then
    raise exception 'Prices are locked after approval. Use "Revise" — the CEO must approve the new version.';
  end if;

  -- Hot / cold can be set at any stage (from the first enquiry), but not on a closed quotation
  if new.lead_temperature is distinct from old.lead_temperature
     and v_to in ('cancelled','rejected','project_created') and not v_conv then
    raise exception 'Hot / cold cannot be changed on a closed quotation.';
  end if;

  if v_to = 'sent_to_customer' and v_from <> 'sent_to_customer' then
    new.sent_to_customer_at := now();
    if new.next_follow_up_date is null or new.next_follow_up_date < current_date then
      new.next_follow_up_date := current_date + 1;
    end if;
  end if;
  if v_to = 'customer_accepted' and v_from <> 'customer_accepted' then
    new.customer_response_at := coalesce(new.customer_response_at, now());
    new.accepted_via := coalesce(new.accepted_via, 'staff');
  end if;
  return new;
end;$$;

create or replace function quotation_role_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  uid     uuid := auth.uid();
  visitor boolean;
  fu      boolean;
  allowed text[] := array['updated_at', 'next_follow_up_date', 'follow_up_count', 'lead_temperature', 'lead_temperature_note', 'lead_temperature_at',
                          'first_contact_at', 'first_call_alerted_at', 'follow_up_alerted_on'];
  move    text := old.status || '>' || new.status;
begin
  if uid is null or is_manager() or can_manage_quotations() or old.assigned_sales_id = uid
     or coalesce(current_setting('greenergy.converting', true), '') = 'on' then
    return new;
  end if;
  visitor := old.assigned_engineer_id = uid;
  fu      := old.follow_up_manager_id = uid;
  -- Sr / Jr Admin Managers allocate work: the three people and the site-visit plan (allocation_levels_v1.sql)
  if can_allocate() then
    allowed := allowed || array['assigned_sales_id', 'assigned_engineer_id', 'follow_up_manager_id', 'site_visit_at', 'status'];
    if new.status is distinct from old.status and not visitor and not fu and not (
         old.status in ('new', 'sales_review', 'site_details_pending', 'site_visit_scheduled') and new.status = 'site_visit_scheduled') then
      raise exception 'You can allocate the work and plan the site visit. Other steps are done by the people working on the quotation.';
    end if;
    if new.status is distinct from old.status and new.status = 'site_visit_scheduled'
       and old.status in ('new', 'sales_review', 'site_details_pending', 'site_visit_scheduled') then
      if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
        raise exception 'You can allocate the work and plan the site visit. Changes to the quotation itself go to the CEO as a change request.';
      end if;
      return new;
    end if;
  end if;
  if visitor then
    allowed := allowed || array['status', 'site_visit_at', 'site_visit_done_at', 'site_visit_notes', 'site_visit_lat', 'site_visit_lng',
      'address', 'city', 'eb_consumer_number', 'sanctioned_load_kw', 'avg_monthly_units', 'avg_monthly_bill', 'roof_type',
      'available_roof_area_sqft', 'current_phase', 'notes', 'roof_photo_url', 'eb_bill_url', 'pincode'];
  end if;
  if fu then
    allowed := allowed || array['status', 'sent_to_customer_at', 'accepted_by_name', 'accepted_via', 'accepted_note',
      'customer_response_at', 'lost_reason', 'lost_reason_code'];
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception '%', case
      when visitor and fu then 'You can update the site visit and the follow-up of this quotation. Prices are changed by the person preparing it.'
      when visitor then 'You can update the site visit of this quotation. The quotation itself is prepared by someone else.'
      when fu then 'You can follow up this quotation. Changes to it are made by the person preparing it.'
      when can_allocate() then 'You can allocate the work and plan the site visit. Changes to the quotation itself go to the CEO as a change request.'
      else 'You do not have access to change this quotation.' end;
  end if;
  if new.status is distinct from old.status and not (
       (visitor and old.status in ('new', 'sales_review', 'site_details_pending', 'site_visit_scheduled')
                and new.status in ('site_visit_scheduled', 'site_visit_done'))
    or (fu and move in ('approved>sent_to_customer', 'sent_to_customer>customer_accepted', 'customer_accepted>advance_pending',
                        'sent_to_customer>cancelled', 'customer_accepted>cancelled', 'advance_pending>cancelled'))) then
    raise exception 'This step is done by the person preparing the quotation, the admin manager or the CEO.';
  end if;
  return new;
end;$$;

create or replace function quotation_insert_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;               -- public form via the server
  if not quotation_editable(new.status) then
    raise exception 'New quotations start as a draft.';
  end if;
  new.created_by := auth.uid();
  new.approved_by := null; new.approved_at := null; new.job_number := null; new.project_id := null;
  new.lead_temperature := null;
  if my_role() = 'employee' then
    if can_allocate() then
      if (new.assigned_sales_id is not null and not can_allocate_to(new.assigned_sales_id))
         or (new.assigned_engineer_id is not null and not can_allocate_to(new.assigned_engineer_id))
         or (new.follow_up_manager_id is not null and not can_allocate_to(new.follow_up_manager_id)) then
        raise exception '%', allocation_refusal();
      end if;
    else
      new.assigned_sales_id := auth.uid();
    end if;
  end if;
  return new;
end;$$;

-- ═══ Tasks ═══
drop policy if exists "View own tasks" on tasks;
create policy "View own tasks" on tasks for select using (assigned_to = auth.uid() or assigned_by = auth.uid() or can_allocate());
drop policy if exists "Manager create tasks" on tasks;
create policy "Manager create tasks" on tasks for insert with check (can_allocate());
drop policy if exists "Update own task" on tasks;
create policy "Update own task" on tasks for update using (assigned_to = auth.uid() or assigned_by = auth.uid() or is_manager());

create or replace function task_allocation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;
  if tg_op = 'INSERT' then
    new.assigned_by := uid;
    if not can_allocate_to(new.assigned_to) then raise exception '%', allocation_refusal(); end if;
    return new;
  end if;
  if is_manager() then return new; end if;
  -- An allocator may change the tasks they gave: who does it (within their rule), title, notes, dates, priority
  if can_allocate() and old.assigned_by = uid then
    if new.assigned_to is distinct from old.assigned_to and not can_allocate_to(new.assigned_to) then
      raise exception '%', allocation_refusal();
    end if;
    new.assigned_by := old.assigned_by;
    return new;
  end if;
  -- The person doing the task: progress and notes only
  if (to_jsonb(new) - array['status', 'completion_notes', 'completed_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'completion_notes', 'completed_at', 'updated_at']) then
    raise exception 'You can update the progress of your task. Ask the person who gave it to change anything else.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_task_allocation_guard on tasks;
create trigger trg_task_allocation_guard before insert or update on tasks
  for each row execute function task_allocation_guard();

-- Tell people when a task is given to them
create or replace function task_assign_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into notifications (user_id, type, title, message, link)
      values (new.assigned_to, 'task', 'New task for you',
              new.title || coalesce(' · due ' || to_char(new.due_date, 'DD Mon'), '')
                || coalesce(' · from ' || (select full_name from profiles where id = auth.uid()), ''),
              '/staff/tasks');
  end if;
  return new;
end;$$;
drop trigger if exists trg_task_assign_notify on tasks;
create trigger trg_task_assign_notify after insert or update of assigned_to on tasks
  for each row execute function task_assign_notify();

-- ═══ Service jobs ═══
drop policy if exists "allocators_view_tickets" on service_tickets;
create policy "allocators_view_tickets" on service_tickets for select using (my_allocation_level() is not null);
drop policy if exists "allocators_edit_tickets" on service_tickets;
create policy "allocators_edit_tickets" on service_tickets for update
  using (my_allocation_level() is not null) with check (my_allocation_level() is not null);

create or replace function service_ticket_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare mgr boolean := auth.uid() is null or is_manager(); alloc boolean := can_allocate(); today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if tg_op = 'INSERT' then
    new.ticket_number := next_doc_number('SR');
    new.invoice_number := null; new.invoiced_at := null; new.paid_at := null;
    if not mgr then
      if not alloc then new.assigned_to := null;
      elsif new.assigned_to is not null and not can_allocate_to(new.assigned_to) then raise exception '%', allocation_refusal(); end if;
      new.status := 'open'; new.chargeable := false; new.charge_amount := 0;
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.assigned_to is not null and new.status = 'open' then new.status := 'assigned'; end if;
    new.due_date := coalesce(new.due_date, new.scheduled_for + 7,
      today + case new.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 7 end);
    return new;
  end if;
  if new.ticket_number is distinct from old.ticket_number
     or (new.invoice_number is distinct from old.invoice_number and coalesce(current_setting('greenergy.invoicing', true), '') <> 'on') then
    raise exception 'Ticket and invoice numbers are issued by the CRM and cannot be changed.';
  end if;
  if old.invoice_number is not null and auth.uid() is not null
     and (new.charge_amount, new.gst_pct, new.chargeable, new.customer_name, new.region) is distinct from (old.charge_amount, old.gst_pct, old.chargeable, old.customer_name, old.region) then
    raise exception 'This ticket is invoiced: the charge, customer and state are fixed.';
  end if;
  if not mgr and alloc and new.assigned_to is distinct from old.assigned_to
     and (to_jsonb(new) - array['assigned_to', 'status', 'updated_at']) is not distinct from (to_jsonb(old) - array['assigned_to', 'status', 'updated_at']) then
    -- Sr / Jr Admin Manager: gives the job to a technician (nothing else)
    if new.assigned_to is not null and not can_allocate_to(new.assigned_to) then raise exception '%', allocation_refusal(); end if;
    if new.status is distinct from old.status and not (old.status in ('open', 'assigned') and new.status in ('open', 'assigned')) then
      raise exception 'You can give the job to a technician. Its progress is updated by the technician.';
    end if;
    if new.assigned_to is null and old.status = 'assigned' then new.status := 'open'; end if;
  elsif not mgr then
    if old.assigned_to is distinct from auth.uid() then
      raise exception 'You can give the job to a technician. Its progress is updated by the technician doing it.';
    end if;
    -- The technician: progress, resolution notes and closing the job only
    if (to_jsonb(new) - array['status', 'resolution_notes', 'resolved_at', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'resolution_notes', 'resolved_at', 'updated_at']) then
      raise exception 'You can update the progress and the resolution. The admin manager changes the rest.';
    end if;
    if new.status is distinct from old.status and new.status not in ('in_progress', 'resolved') then
      raise exception 'You can mark the job in progress or resolved.';
    end if;
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then
    if coalesce(trim(new.resolution_notes), '') = '' then raise exception 'Write what was done before marking it resolved.'; end if;
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to and new.status = 'open' then new.status := 'assigned'; end if;
  new.updated_at := now();
  return new;
end;$$;
