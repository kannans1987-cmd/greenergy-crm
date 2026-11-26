-- Lead hot / cold v1 (26 Nov 2026)
--  * Hot / cold can be set at any stage, from the first enquiry (before only after sharing),
--    by the CEO, admin manager or any of the people working on the quotation.
--  * When it changes, the time and a short reason are kept; history shows who changed it.
--  * Logging a follow-up with hot / cold updates the quotation at any open stage.
-- Replaces quotation_guard() and follow_up_sync() from workflow_v2.sql. Safe to run more than once.

alter table quotation_requests add column if not exists lead_temperature_at   timestamptz;
alter table quotation_requests add column if not exists lead_temperature_note text;

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

  -- Only managers reassign people
  if v_role = 'employee' and (new.assigned_sales_id is distinct from old.assigned_sales_id
       or new.assigned_engineer_id is distinct from old.assigned_engineer_id
       or new.follow_up_manager_id is distinct from old.follow_up_manager_id) then
    raise exception 'Only the CEO or admin manager can reassign a quotation.';
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

create or replace function follow_up_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update quotation_requests
     set next_follow_up_date = new.next_follow_up_date,
         follow_up_count     = follow_up_count + 1,
         lead_temperature    = coalesce(new.temperature, lead_temperature),
         lead_temperature_note = case when new.temperature is not null then left(new.notes, 300) else lead_temperature_note end
   where id = new.quotation_id and status not in ('project_created','cancelled','rejected');
  return new;
end;$$;

-- Stamp when the temperature changed (runs after the permission checks)
create or replace function quotation_temperature_stamp()
returns trigger language plpgsql as $$
begin
  if new.lead_temperature is distinct from old.lead_temperature then
    new.lead_temperature_at := case when new.lead_temperature is null then null else now() end;
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_temp_stamp on quotation_requests;
create trigger trg_quotation_temp_stamp before update on quotation_requests
  for each row execute function quotation_temperature_stamp();
