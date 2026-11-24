-- ═══════════════════════════════════════════════════════════════
-- GREENERGY CRM — SALES & PROJECT WORKFLOW (v2)
-- Run AFTER schema.sql, workflow_tables.sql, job_card_logs.sql,
-- quotation_module.sql and quotation_documents_bucket.sql.
-- Safe to re-run.
--
-- Flow:  quotation (sales / admin manager)
--        → CEO approval            (role 'admin' = CEO; only the CEO approves)
--        → shared with customer + admin manager (portal link, follow-ups)
--        → marked HOT or COLD
--        → customer accepts        (portal "Accept" or recorded by staff)
--        → HOT + accepted → numbered job card  GSS/JC/2026-27/0001  (project)
--        → CEO appoints an administrative officer
--        → cradle-to-grave milestones tracked on the project
--
-- Roles (profiles.role):  admin = CEO · task_manager = admin manager ·
--                         employee = sales / field staff / appointed officer
-- The rules below are enforced in the database (triggers + RLS), so they
-- hold even if someone calls Supabase directly with their login token.
-- ═══════════════════════════════════════════════════════════════

-- ─── 0. HARDENING ───────────────────────────────────────────────

-- New sign-ups are always plain employees. Only invited users are active;
-- anyone who signs up on their own (public sign-up) gets no access.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, phone, designation, department, date_of_joining, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'designation',
    new.raw_user_meta_data->>'department',
    nullif(new.raw_user_meta_data->>'date_of_joining', '')::date,
    'employee',
    case when new.invited_at is not null then 'active' else 'inactive' end
  )
  on conflict (id) do nothing;
  return new;
end;$$;

-- Helpers now also require an active profile
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','task_manager') and status = 'active');
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function my_name()
returns text language sql stable security definer set search_path = public as $$
  select full_name from profiles where id = auth.uid();
$$;

-- Fix: the original projects policy compared project_employees.id with itself
drop policy if exists "Employees view own projects" on projects;

-- ─── 1. NEW COLUMNS ─────────────────────────────────────────────

alter table quotation_requests add column if not exists region text default 'puducherry';
alter table quotation_requests add column if not exists panel_type text default 'DCR';
alter table quotation_requests add column if not exists lead_temperature text;
alter table quotation_requests add column if not exists follow_up_manager_id uuid references profiles(id);
alter table quotation_requests add column if not exists next_follow_up_date date;
alter table quotation_requests add column if not exists follow_up_count integer not null default 0;
alter table quotation_requests add column if not exists central_subsidy numeric;
alter table quotation_requests add column if not exists state_subsidy numeric;
alter table quotation_requests add column if not exists state_subsidy_name text;
alter table quotation_requests add column if not exists price_per_kw numeric;
alter table quotation_requests add column if not exists discount numeric default 0;
alter table quotation_requests add column if not exists revision integer not null default 1;
alter table quotation_requests add column if not exists valid_until date;
alter table quotation_requests add column if not exists approved_by uuid references profiles(id);
alter table quotation_requests add column if not exists approved_by_name text;
alter table quotation_requests add column if not exists accepted_by_name text;
alter table quotation_requests add column if not exists accepted_via text;
alter table quotation_requests add column if not exists accepted_note text;
alter table quotation_requests add column if not exists lost_reason text;
alter table quotation_requests add column if not exists job_number text;
alter table quotation_requests add column if not exists created_by uuid references profiles(id);

do $$ begin
  alter table quotation_requests add constraint qr_region_chk check (region in ('puducherry','tamilnadu'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotation_requests add constraint qr_panel_chk check (panel_type in ('DCR','NonDCR'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotation_requests add constraint qr_temp_chk check (lead_temperature in ('hot','cold'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotation_requests add constraint qr_accept_chk check (accepted_via in ('portal','staff'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotation_requests add constraint qr_job_number_key unique (job_number);
exception when duplicate_object or duplicate_table then null; end $$;

alter table projects add column if not exists job_number text;
alter table projects add column if not exists quotation_id uuid references quotation_requests(id);
alter table projects add column if not exists admin_officer_id uuid references profiles(id);
alter table projects add column if not exists customer_mobile text;
alter table projects add column if not exists region text;
alter table projects add column if not exists subsidy_job boolean not null default false;
alter table projects add column if not exists order_value numeric;
alter table projects add column if not exists target_commissioning date;
do $$ begin
  alter table projects add constraint projects_job_number_key unique (job_number);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table projects add constraint projects_quotation_key unique (quotation_id);
exception when duplicate_object or duplicate_table then null; end $$;

alter table project_stage_history add column if not exists sort_order integer not null default 0;
alter table project_stage_history add column if not exists phase text;
alter table project_stage_history add column if not exists planned_date date;
alter table project_stage_history add column if not exists actual_date date;
alter table project_stage_history add column if not exists is_subsidy boolean not null default false;
alter table project_stage_history add column if not exists updated_by_name text;

-- ─── 2. FOLLOW-UPS ──────────────────────────────────────────────

create table if not exists quotation_follow_ups (
  id               uuid default uuid_generate_v4() primary key,
  quotation_id     uuid references quotation_requests(id) on delete cascade not null,
  contact_type     text not null default 'call' check (contact_type in ('call','whatsapp','visit','email','note')),
  notes            text not null check (char_length(notes) between 1 and 2000),
  temperature      text check (temperature in ('hot','cold')),
  next_follow_up_date date,
  created_by       uuid references profiles(id) default auth.uid(),
  created_by_name  text,
  created_at       timestamptz default now()
);
create index if not exists quotation_follow_ups_q on quotation_follow_ups (quotation_id, created_at desc);
create index if not exists quotation_requests_follow_up on quotation_requests (next_follow_up_date) where status in ('sent_to_customer','customer_accepted','advance_pending');

-- ─── 3. JOB-CARD NUMBERS PER FINANCIAL YEAR ─────────────────────

create table if not exists doc_counters (
  prefix text not null,
  fy     text not null,
  last   integer not null,
  primary key (prefix, fy)
);
alter table doc_counters enable row level security;   -- no policies: only the function below writes

-- Indian financial year (April–March): 20 Nov 2026 → '2026-27'
create or replace function fy_label(d date)
returns text language sql immutable as $$
  select (case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end)::text
         || '-' ||
         lpad((((case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end) + 1) % 100)::text, 2, '0');
$$;

-- Gap-free, never-repeated numbers: the row lock serialises concurrent conversions
create or replace function next_doc_number(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_fy text := fy_label((now() at time zone 'Asia/Kolkata')::date);
  v_n  integer;
begin
  insert into doc_counters (prefix, fy, last) values (p_prefix, v_fy, 1)
  on conflict (prefix, fy) do update set last = doc_counters.last + 1
  returning last into v_n;
  return 'GSS/' || p_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;$$;
revoke all on function next_doc_number(text) from public;

-- ─── 4. QUOTATION RULES (state machine) ─────────────────────────

-- Stages before CEO approval, where the quotation can still be edited
create or replace function quotation_editable(s text)
returns boolean language sql immutable as $$
  select s in ('new','sales_review','site_details_pending','site_visit_scheduled','site_visit_done',
               'technical_review','drafted','more_info_requested');
$$;

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

  -- Hot / cold is a follow-up judgement, set once the customer has the quotation
  if new.lead_temperature is distinct from old.lead_temperature
     and v_to not in ('sent_to_customer','customer_accepted','advance_pending') then
    raise exception 'Mark hot or cold after the quotation is shared with the customer.';
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

drop trigger if exists trg_quotation_guard on quotation_requests;
create trigger trg_quotation_guard before update on quotation_requests
  for each row execute function quotation_guard();

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
  if my_role() = 'employee' then new.assigned_sales_id := auth.uid(); end if;
  return new;
end;$$;

drop trigger if exists trg_quotation_insert_guard on quotation_requests;
create trigger trg_quotation_insert_guard before insert on quotation_requests
  for each row execute function quotation_insert_guard();

-- Line items follow the same lock as prices
create or replace function line_item_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select status into v_status from quotation_requests where id = coalesce(new.quotation_id, old.quotation_id);
  if not quotation_editable(v_status) then
    raise exception 'Line items are locked after approval. Use "Revise" first.';
  end if;
  return coalesce(new, old);
end;$$;

drop trigger if exists trg_line_item_guard on quotation_line_items;
create trigger trg_line_item_guard before insert or update or delete on quotation_line_items
  for each row execute function line_item_guard();

-- Follow-up entries keep the quotation's next date and count in step
create or replace function follow_up_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by_name := coalesce(new.created_by_name, my_name());
  return new;
end;$$;
drop trigger if exists trg_follow_up_name on quotation_follow_ups;
create trigger trg_follow_up_name before insert on quotation_follow_ups
  for each row execute function follow_up_after_insert();

create or replace function follow_up_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update quotation_requests
     set next_follow_up_date = new.next_follow_up_date,
         follow_up_count     = follow_up_count + 1,
         lead_temperature    = case when new.temperature is not null
                                     and status in ('sent_to_customer','customer_accepted','advance_pending')
                                    then new.temperature else lead_temperature end
   where id = new.quotation_id and status <> 'project_created';
  return new;
end;$$;
drop trigger if exists trg_follow_up_sync on quotation_follow_ups;
create trigger trg_follow_up_sync after insert on quotation_follow_ups
  for each row execute function follow_up_sync();

-- In-app notifications for each hand-over in the flow
create or replace function quotation_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_link text := '/staff/quotations/' || new.id;
  v_who  text := coalesce(new.customer_name, 'customer') || ' · ' || coalesce(new.quotation_number, '');
begin
  if new.status = old.status then return new; end if;
  if new.status = 'owner_approval_pending' then
    insert into notifications (user_id, type, title, message, link)
    select id, 'quotation', 'Quotation waiting for your approval', v_who, v_link
      from profiles where role = 'admin' and status = 'active';
  elsif new.status = 'approved' and new.assigned_sales_id is not null then
    insert into notifications (user_id, type, title, message, link)
    values (new.assigned_sales_id, 'quotation', 'Quotation approved — share it with the customer', v_who, v_link);
  elsif new.status in ('drafted','more_info_requested','rejected') and old.status = 'owner_approval_pending' and new.assigned_sales_id is not null then
    insert into notifications (user_id, type, title, message, link)
    values (new.assigned_sales_id, 'quotation', 'CEO returned a quotation', v_who || coalesce(' — ' || new.admin_remarks, ''), v_link);
  elsif new.status = 'sent_to_customer' and new.follow_up_manager_id is not null then
    insert into notifications (user_id, type, title, message, link)
    values (new.follow_up_manager_id, 'quotation', 'New quotation to follow up', v_who, v_link);
  elsif new.status = 'customer_accepted' then
    insert into notifications (user_id, type, title, message, link)
    select distinct u, 'quotation', 'Customer accepted a quotation', v_who, v_link
      from unnest(array[new.assigned_sales_id, new.follow_up_manager_id]) as u where u is not null;
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_notify on quotation_requests;
create trigger trg_quotation_notify after update on quotation_requests
  for each row execute function quotation_notify();

-- ─── 5. CRADLE-TO-GRAVE MILESTONES ──────────────────────────────

create or replace function project_stage_template()
returns table (sort_order int, stage_code text, stage_name text, phase text, day_offset int, is_subsidy boolean)
language sql immutable as $$
  values
  ( 1, 'order_confirmed',     'Order confirmed, advance received',                                  'Order & approvals',          0,    false),
  ( 2, 'site_survey',         'Detailed site survey & shadow analysis',                             'Order & approvals',          3,    false),
  ( 3, 'design',              'Engineering design & BOM frozen (layout, strings, structure)',       'Order & approvals',          6,    false),
  ( 4, 'pmsg_application',    'PM Surya Ghar application & vendor selection on portal',             'Order & approvals',          7,    true),
  ( 5, 'discom_application',  'DISCOM feasibility / metering application (Electricity Dept / TNPDCL)', 'Order & approvals',       10,   false),
  ( 6, 'material_procurement','Materials ordered (ALMM panels, inverter, structure, BOS)',          'Procurement & installation', 14,   false),
  ( 7, 'material_delivery',   'Materials delivered & checked at site',                              'Procurement & installation', 24,   false),
  ( 8, 'structure_work',      'Mounting structure erected',                                         'Procurement & installation', 27,   false),
  ( 9, 'panel_installation',  'Panels installed',                                                   'Procurement & installation', 29,   false),
  (10, 'inverter_electrical', 'Inverter, cabling, ACDB/DCDB, earthing & lightning arrester',       'Procurement & installation', 30,   false),
  (11, 'testing',             'Pre-commissioning tests (IR, polarity, Voc/Isc, earth resistance)',  'Procurement & installation', 32,   false),
  (12, 'discom_inspection',   'Work completion report & DISCOM inspection',                         'Grid connection',            36,   false),
  (13, 'net_meter_sync',      'Net / bidirectional meter installed & grid synchronised',            'Grid connection',            45,   false),
  (14, 'commissioning',       'Commissioning certificate issued',                                   'Grid connection',            48,   false),
  (15, 'subsidy_claim',       'Subsidy claim submitted (commissioning certificate, bank details)',  'Subsidy',                    50,   true),
  (16, 'central_subsidy',     'Central subsidy credited to customer',                               'Subsidy',                    80,   true),
  (17, 'state_subsidy',       'State subsidy claimed & credited (Puducherry form / TN via TEDA)',   'Subsidy',                    95,   true),
  (18, 'final_payment',       'Final payment received; invoice closed',                             'Handover',                   50,   false),
  (19, 'handover',            'Handover: warranty cards, manuals, monitoring app, customer training','Handover',                  50,   false),
  (20, 'warranty_registration','Panel & inverter warranties registered with manufacturers',         'Handover',                   55,   false),
  (21, 'first_service',       'First maintenance visit (cleaning, torque, IR check)',               'Service life',               230,  false),
  (22, 'maintenance_contract','Maintenance contract running (5-year CMC for PM Surya Ghar systems)','Service life',               null, false),
  (23, 'end_of_life',         'Decommissioning; panels sent to an authorised e-waste recycler',     'End of life',                null, false)
$$;

-- ─── 6. CONVERT: accepted + hot → numbered job card ─────────────

create or replace function convert_quotation_to_project(p_quotation uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q         quotation_requests%rowtype;
  v_job     text;
  v_project uuid;
  v_kw      numeric;
  v_total   numeric;
  v_subsidy boolean;
  v_start   date := (now() at time zone 'Asia/Kolkata')::date;
  v_type    text;
begin
  if not is_manager() then
    raise exception 'Only the CEO or admin manager can create a job card.';
  end if;

  select * into q from quotation_requests where id = p_quotation for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if q.project_id is not null then raise exception 'This quotation already has job card %.', q.job_number; end if;
  if q.status not in ('customer_accepted','advance_pending') then
    raise exception 'The customer must accept the quotation first.';
  end if;
  if coalesce(q.lead_temperature, '') <> 'hot' then
    raise exception 'Mark the quotation HOT before creating the job card.';
  end if;

  v_job     := next_doc_number('JC');
  v_kw      := coalesce(q.admin_capacity_kw, q.recommended_capacity_kw, q.required_capacity_kw);
  v_total   := coalesce(q.admin_total_cost, q.total_cost_before_subsidy, 0);
  v_subsidy := coalesce(q.central_subsidy, q.admin_subsidy, q.subsidy_applicable, 0) > 0;
  v_type    := case
                 when q.solar_type = 'hybrid' then 'hybrid'
                 when q.solar_type = 'solar_pump' then 'solar_pump'
                 when q.consumer_type = 'industrial' then 'industrial'
                 when q.consumer_type in ('commercial','institution') then 'commercial'
                 else 'residential' end;

  insert into projects (name, customer_name, site_address, project_type, capacity_kwp, start_date, status, notes,
                        created_by, job_number, quotation_id, customer_mobile, region, subsidy_job, order_value)
  values (q.customer_name || ' - ' || coalesce(v_kw::text, '?') || ' kW ' || coalesce(q.solar_type, 'ongrid'),
          q.customer_name, nullif(concat_ws(', ', q.address, q.city), ''), v_type, v_kw, v_start, 'planning',
          'Created from quotation ' || q.quotation_number, auth.uid(), v_job, q.id, q.mobile, q.region, v_subsidy, v_total)
  returning id into v_project;

  insert into project_stage_history (project_id, stage_code, stage_name, phase, sort_order, is_subsidy, status, planned_date)
  select v_project, t.stage_code, t.stage_name, t.phase, t.sort_order, t.is_subsidy,
         case when t.is_subsidy and not v_subsidy then 'skipped' else 'pending' end,
         case when t.day_offset is null or (t.is_subsidy and not v_subsidy) then null else v_start + t.day_offset end
    from project_stage_template() t;

  -- Payment schedule as quoted: 50% advance · 40% before material delivery · 10% on commissioning
  insert into project_payments (project_id, quotation_id, milestone_name, percentage, amount, status, created_by)
  values (v_project, q.id, 'Advance on order (50%)',              50, round(v_total * 0.50), 'pending', auth.uid()),
         (v_project, q.id, 'Before material delivery (40%)',      40, round(v_total * 0.40), 'pending', auth.uid()),
         (v_project, q.id, 'On commissioning & handover (10%)',   10, v_total - round(v_total * 0.50) - round(v_total * 0.40), 'pending', auth.uid());

  perform set_config('greenergy.converting', 'on', true);
  update quotation_requests
     set status = 'project_created', project_id = v_project, job_number = v_job,
         converted_at = now(), converted_by = auth.uid()
   where id = q.id;
  perform set_config('greenergy.converting', 'off', true);

  insert into quotation_status_history (quotation_id, from_status, to_status, changed_by, changed_by_name, remarks)
  values (q.id, q.status, 'project_created', auth.uid(), my_name(), 'Job card ' || v_job || ' created');

  insert into notifications (user_id, type, title, message, link)
  select id, 'project', 'New job card — appoint an administrative officer', v_job || ' · ' || q.customer_name, '/staff/projects/' || v_project
    from profiles where role = 'admin' and status = 'active';

  return jsonb_build_object('project_id', v_project, 'job_number', v_job);
end;$$;
revoke all on function convert_quotation_to_project(uuid) from public;
grant execute on function convert_quotation_to_project(uuid) to authenticated;

-- ─── 7. PROJECT RULES ───────────────────────────────────────────

create or replace function is_project_officer(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p_project and admin_officer_id = auth.uid()) and is_staff();
$$;

create or replace function can_view_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager()
      or exists (select 1 from projects p where p.id = p_project and p.admin_officer_id = auth.uid())
      or exists (select 1 from project_employees pe where pe.project_id = p_project and pe.employee_id = auth.uid())
      or exists (select 1 from projects p join quotation_requests q on q.id = p.quotation_id
                  where p.id = p_project and q.assigned_sales_id = auth.uid());
$$;

create or replace function project_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.job_number is distinct from old.job_number or new.quotation_id is distinct from old.quotation_id then
    raise exception 'The job card number and quotation link cannot be changed.';
  end if;
  if new.admin_officer_id is distinct from old.admin_officer_id and not is_admin() then
    raise exception 'Only the CEO can appoint the administrative officer.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_project_guard on projects;
create trigger trg_project_guard before update on projects
  for each row execute function project_guard();

drop policy if exists "View projects" on projects;
create policy "View projects" on projects for select using (can_view_project(id));
drop policy if exists "Manager update projects" on projects;
create policy "Manager update projects" on projects for update using (is_manager());
drop policy if exists "Officer update own projects" on projects;
create policy "Officer update own projects" on projects for update
  using (admin_officer_id = auth.uid() and is_staff())
  with check (admin_officer_id = auth.uid());

-- Milestones: everyone on the project can see them; the officer and managers update them
drop policy if exists "staff_stage_history" on project_stage_history;
drop policy if exists "View milestones" on project_stage_history;
create policy "View milestones" on project_stage_history for select using (can_view_project(project_id));
drop policy if exists "Track milestones" on project_stage_history;
create policy "Track milestones" on project_stage_history for update
  using (is_manager() or is_project_officer(project_id))
  with check (is_manager() or is_project_officer(project_id));
drop policy if exists "Manager add milestones" on project_stage_history;
create policy "Manager add milestones" on project_stage_history for insert with check (is_manager());
drop policy if exists "Manager remove milestones" on project_stage_history;
create policy "Manager remove milestones" on project_stage_history for delete using (is_manager());

create or replace function stage_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.actual_date  := coalesce(new.actual_date, (now() at time zone 'Asia/Kolkata')::date);
  end if;
  if new.status = 'in_progress' and old.status = 'pending' then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.stage_code is distinct from old.stage_code or new.project_id is distinct from old.project_id then
    raise exception 'Milestone identity cannot be changed.';
  end if;
  new.responsible_id  := coalesce(auth.uid(), new.responsible_id);
  new.updated_by_name := coalesce(my_name(), new.updated_by_name);
  return new;
end;$$;
drop trigger if exists trg_stage_touch on project_stage_history;
create trigger trg_stage_touch before update on project_stage_history
  for each row execute function stage_touch();

-- Payments: project team can see them; managers record them
drop policy if exists "staff_read_payments" on project_payments;
drop policy if exists "View payments" on project_payments;
create policy "View payments" on project_payments for select using (can_view_project(project_id));

-- ─── 8. QUOTATION ACCESS (RLS) ──────────────────────────────────

-- The public quote form now writes through the server only (service role)
drop policy if exists "public_insert_quotation" on quotation_requests;

drop policy if exists "staff_assigned_quotations" on quotation_requests;
create policy "staff_assigned_quotations" on quotation_requests for select using (
  is_staff() and (assigned_sales_id = auth.uid() or assigned_engineer_id = auth.uid() or follow_up_manager_id = auth.uid())
);
drop policy if exists "sales_insert_own" on quotation_requests;
create policy "sales_insert_own" on quotation_requests for insert with check (
  is_staff() and (assigned_sales_id = auth.uid() or is_manager())
);
drop policy if exists "sales_update_assigned" on quotation_requests;
create policy "sales_update_assigned" on quotation_requests for update
  using (is_staff() and assigned_sales_id = auth.uid())
  with check (assigned_sales_id = auth.uid());

drop policy if exists "sales_lineitems" on quotation_line_items;
create policy "sales_lineitems" on quotation_line_items for all
  using (exists (select 1 from quotation_requests q where q.id = quotation_id and q.assigned_sales_id = auth.uid()) and is_staff())
  with check (exists (select 1 from quotation_requests q where q.id = quotation_id and q.assigned_sales_id = auth.uid()) and is_staff());

create or replace function can_view_quotation(p_quotation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or exists (
    select 1 from quotation_requests q where q.id = p_quotation and is_staff()
       and (q.assigned_sales_id = auth.uid() or q.assigned_engineer_id = auth.uid() or q.follow_up_manager_id = auth.uid()));
$$;

-- History is append-only; comments cannot be edited by others
drop policy if exists "staff_status_history" on quotation_status_history;
drop policy if exists "View status history" on quotation_status_history;
create policy "View status history" on quotation_status_history for select using (can_view_quotation(quotation_id));
drop policy if exists "Add status history" on quotation_status_history;
create policy "Add status history" on quotation_status_history for insert
  with check (can_view_quotation(quotation_id) and changed_by = auth.uid());

drop policy if exists "staff_comments" on quotation_comments;
drop policy if exists "View comments" on quotation_comments;
create policy "View comments" on quotation_comments for select
  using (can_view_quotation(quotation_id) and (not is_internal or is_manager() or author_id = auth.uid()));
drop policy if exists "Add comments" on quotation_comments;
create policy "Add comments" on quotation_comments for insert
  with check (can_view_quotation(quotation_id) and author_id = auth.uid());
drop policy if exists "Remove comments" on quotation_comments;
create policy "Remove comments" on quotation_comments for delete using (author_id = auth.uid() or is_manager());

alter table quotation_follow_ups enable row level security;
drop policy if exists "View follow-ups" on quotation_follow_ups;
create policy "View follow-ups" on quotation_follow_ups for select using (can_view_quotation(quotation_id));
drop policy if exists "Add follow-ups" on quotation_follow_ups;
create policy "Add follow-ups" on quotation_follow_ups for insert
  with check (can_view_quotation(quotation_id) and created_by = auth.uid());

-- Documents were open to every logged-in user for edit/delete
drop policy if exists "staff_documents" on project_documents;
drop policy if exists "View documents" on project_documents;
create policy "View documents" on project_documents for select using (
  is_manager() or (project_id is not null and can_view_project(project_id)) or (quotation_id is not null and can_view_quotation(quotation_id)));
drop policy if exists "Add documents" on project_documents;
create policy "Add documents" on project_documents for insert with check (is_staff() and uploaded_by = auth.uid());
drop policy if exists "Manager remove documents" on project_documents;
create policy "Manager remove documents" on project_documents for delete using (is_manager());

-- Staff names for assignment lists (all active staff can see each other's name and role)
drop policy if exists "Staff view directory" on profiles;
create policy "Staff view directory" on profiles for select using (is_staff());
