-- Growth v1 (27 Nov 2026): selling and cash, not more control.
--  1. Control room data: what is stuck today (the screens read the tables directly).
--  2. Why deals are lost: a reason code on every lost quotation (Pareto chart on Sales insights).
--  3. Speed to lead: when a lead was first contacted; an alert when nobody has called within the hour.
--  4. Auto-approval: quotations inside the CEO's own rules (size, margin, discount) are approved
--     without waiting for the CEO. The CEO switches it on in Business rules; it starts OFF.
--  6. Money: due dates follow the milestones, part payments, receipts, overdue alerts.
--  7. Referrals and neighbour group offers: a referral code for every customer, group links,
--     rewards due when a referred customer becomes a job.
--  9. Commissioning checklist with photos and the customer's signature; the "Commissioning"
--     milestone cannot be ticked until it is complete. A customer report link (no login).
-- Needs everything before it in UPGRADE_EXISTING_PROJECT.sql. Safe to run more than once.

-- ═══ Business rules (set by the CEO) ════════════════════════════════════════
create table if not exists business_settings (
  key        text primary key,
  data       jsonb not null default '{}',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table business_settings enable row level security;
drop policy if exists "staff_read_settings" on business_settings;
create policy "staff_read_settings" on business_settings for select using (is_staff());
drop policy if exists "ceo_write_settings" on business_settings;
create policy "ceo_write_settings" on business_settings for all using (is_admin()) with check (is_admin());

insert into business_settings (key, data) values
  ('auto_approval', '{"enabled": false, "max_kw": 10, "min_margin_pct": 15, "max_discount_pct": 3, "domestic_only": true}'),
  ('referral',      '{"reward_amount": 2000, "reward_note": "Paid to the referring customer after the new customer''s system is commissioned."}'),
  ('group_buy',     '{"tiers": [{"homes": 3, "discount_pct": 3}, {"homes": 5, "discount_pct": 5}]}'),
  ('alerts',        '{"first_call_minutes": 60, "day_start": 9, "day_end": 19}'),
  ('company',       '{"name": "Greenergy Solar Solutions", "address": "Lawspet, Puducherry", "state": "Puducherry", "phone": "+91 99432 56109", "email": "", "gstin": "", "website": "https://www.greenergypdy.com", "upi_id": "", "bank": ""}')
on conflict (key) do nothing;

create or replace function setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from business_settings where key = p_key), '{}'::jsonb);
$$;

-- ═══ Quotation: lost reason, first contact, lead details, referral / group ═══
alter table quotation_requests add column if not exists lost_reason_code      text;
alter table quotation_requests add column if not exists first_contact_at      timestamptz;
alter table quotation_requests add column if not exists first_call_alerted_at timestamptz;
alter table quotation_requests add column if not exists follow_up_alerted_on  date;
alter table quotation_requests add column if not exists monthly_bill_range    text;
alter table quotation_requests add column if not exists pincode               text;
alter table quotation_requests add column if not exists referred_by_project   uuid references projects(id) on delete set null;
alter table quotation_requests add column if not exists group_buy_id          uuid;
alter table quotation_requests add column if not exists auto_approved         boolean not null default false;
alter table quotation_requests drop constraint if exists qr_lost_reason_chk;
alter table quotation_requests add constraint qr_lost_reason_chk check (lost_reason_code in (
  'price_high', 'competitor', 'subsidy_doubt', 'finance', 'site_unsuitable', 'no_response', 'postponed', 'other'));

-- Existing leads that already moved on were contacted (no false "not called" alerts)
update quotation_requests set first_contact_at = coalesce(site_visit_at, sent_to_customer_at, updated_at, created_at)
 where first_contact_at is null and status <> 'new';

-- The allocation rules list exactly which columns each assignee may change: add the automatic ones
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

-- First contact: a lead typed in by staff (phone call, walk-in) is contacted already; a website lead
-- is contacted at the first logged call / WhatsApp / visit, or when a site visit is planned.
create or replace function quotation_first_contact()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or new.first_contact_at is not null then return new; end if;
  if tg_op = 'INSERT'
     or new.site_visit_at is not null or new.site_visit_done_at is not null
     or new.status not in ('new', 'sales_review', 'site_details_pending') then
    new.first_contact_at := now();
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_first_contact on quotation_requests;
create trigger trg_quotation_first_contact before insert or update on quotation_requests
  for each row execute function quotation_first_contact();

create or replace function follow_up_first_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update quotation_requests set first_contact_at = new.created_at
   where id = new.quotation_id and first_contact_at is null and status <> 'project_created';
  return new;
end;$$;
drop trigger if exists trg_follow_up_first_contact on quotation_follow_ups;
create trigger trg_follow_up_first_contact after insert on quotation_follow_ups
  for each row execute function follow_up_first_contact();

-- ═══ 4. Auto-approval check ═════════════════════════════════════════════════
-- Returns whether a quotation is inside the CEO's rules. Margin = (price before GST − cost) / price.
-- Only list-priced quotations without extra items qualify (extras have no cost in the price list).
create or replace function quotation_auto_approval(p_quotation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  q        quotation_requests%rowtype;
  r        jsonb := setting('auto_approval');
  c        quotation_costings%rowtype;
  why      text[] := '{}';
  cost     numeric;
  sold     numeric;
  margin   numeric;
  disc     numeric;
  cost_kw  numeric;
  priv     boolean := auth.uid() is null or is_manager();
begin
  if auth.uid() is not null and not can_view_quotation(p_quotation) then raise exception 'Quotation not found.'; end if;
  select * into q from quotation_requests where id = p_quotation;
  if not found then raise exception 'Quotation not found.'; end if;
  if not coalesce((r->>'enabled')::boolean, false) then
    return jsonb_build_object('eligible', false, 'enabled', false, 'reasons', jsonb_build_array('Auto-approval is switched off'));
  end if;
  select * into c from quotation_costings where quotation_id = q.id;
  sold := coalesce(q.admin_system_cost, 0);
  cost := (c.data->>'subtotal')::numeric;
  select sum(l.qty) / 1000 into cost_kw from jsonb_to_recordset(coalesce(c.data->'lines', '[]')) as l(id text, qty numeric) where l.id = 'panels';

  if not q.priced_from_list or c.quotation_id is null or cost is null then why := why || 'Not priced from the price list (use "Re-price")'::text; end if;
  if c.quotation_id is not null and cost_kw is not null and abs(cost_kw - coalesce(q.admin_capacity_kw, 0)) > 0.05 then
    why := why || 'Size changed after pricing (press "Re-price")'::text;
  end if;
  if exists (select 1 from quotation_line_items where quotation_id = q.id and coalesce(is_included, true)) then why := why || 'Has extra items'::text; end if;
  if coalesce(q.admin_capacity_kw, 0) <= 0 or q.admin_capacity_kw > coalesce((r->>'max_kw')::numeric, 0) then
    why := why || format('Size %s kW is above %s kW', coalesce(q.admin_capacity_kw::text, '?'), r->>'max_kw');
  end if;
  if coalesce((r->>'domestic_only')::boolean, true) and coalesce(q.consumer_type, 'domestic') <> 'domestic' then why := why || 'Not a home (domestic) system'::text; end if;
  if sold <= 0 then why := why || 'No price yet'::text; end if;
  disc := case when sold + coalesce(q.discount, 0) > 0 then round(coalesce(q.discount, 0) * 100 / (sold + coalesce(q.discount, 0)), 1) else 0 end;
  if disc > coalesce((r->>'max_discount_pct')::numeric, 0) then
    why := why || case when priv then format('Discount %s%% is above %s%%', disc, r->>'max_discount_pct') else 'Discount is above the limit' end;
  end if;
  if cost is not null and sold > 0 then
    margin := round((sold - cost) * 100 / sold, 1);
    if margin < coalesce((r->>'min_margin_pct')::numeric, 100) then
      why := why || case when priv then format('Margin %s%% is below %s%%', margin, r->>'min_margin_pct') else 'Margin is below the limit' end;
    end if;
  end if;
  return jsonb_build_object('eligible', cardinality(why) = 0, 'enabled', true, 'reasons', to_jsonb(why))
         || case when priv then jsonb_build_object('margin_pct', margin, 'discount_pct', disc) else '{}'::jsonb end;
end;$$;
revoke all on function quotation_auto_approval(uuid) from public, anon;
grant execute on function quotation_auto_approval(uuid) to authenticated;

-- ═══ 7. Referrals and neighbour groups ══════════════════════════════════════
alter table projects add column if not exists referral_code text;
alter table projects add column if not exists report_token  uuid default gen_random_uuid();
do $$ begin
  alter table projects add constraint projects_referral_code_key unique (referral_code);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table projects add constraint projects_report_token_key unique (report_token);
exception when duplicate_object or duplicate_table then null; end $$;
update projects set report_token = gen_random_uuid() where report_token is null;

-- Short code without look-alike letters, e.g. GK7M4Q
create or replace function new_short_code(p_prefix text) returns text language plpgsql volatile as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; s text := p_prefix; i int;
begin
  for i in 1..5 loop s := s || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
  return s;
end;$$;

create or replace function project_referral_code()
returns trigger language plpgsql set search_path = public as $$
declare tries int := 0;
begin
  if new.referral_code is null then
    loop
      new.referral_code := new_short_code('G');
      exit when not exists (select 1 from projects where referral_code = new.referral_code) or tries > 20;
      tries := tries + 1;
    end loop;
  end if;
  new.report_token := coalesce(new.report_token, gen_random_uuid());
  return new;
end;$$;
drop trigger if exists trg_project_referral_code on projects;
create trigger trg_project_referral_code before insert on projects
  for each row execute function project_referral_code();
do $$ declare p record; begin
  for p in select id from projects where referral_code is null loop
    update projects set referral_code = (select c from (select new_short_code('G') c) x where not exists (select 1 from projects where referral_code = x.c)) where id = p.id;
  end loop;
end $$;

create table if not exists group_buys (
  id         uuid default gen_random_uuid() primary key,
  code       text not null unique,
  name       text not null check (char_length(name) between 2 and 120),
  area       text,
  status     text not null default 'open' check (status in ('open', 'closed')),
  closes_on  date,
  notes      text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table group_buys enable row level security;
drop policy if exists "staff_read_groups" on group_buys;
create policy "staff_read_groups" on group_buys for select using (is_staff());
drop policy if exists "managers_write_groups" on group_buys;
create policy "managers_write_groups" on group_buys for all using (is_manager()) with check (is_manager());
create or replace function group_buy_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    loop
      new.code := new_short_code('N');
      exit when not exists (select 1 from group_buys where code = new.code);
    end loop;
  end if;
  new.code := upper(new.code);
  return new;
end;$$;
drop trigger if exists trg_group_buy_code on group_buys;
create trigger trg_group_buy_code before insert on group_buys for each row execute function group_buy_code();
do $$ begin
  alter table quotation_requests add constraint qr_group_buy_fk foreign key (group_buy_id) references group_buys(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists referral_rewards (
  id                  uuid default gen_random_uuid() primary key,
  quotation_id        uuid not null unique references quotation_requests(id) on delete cascade,
  referrer_project_id uuid references projects(id) on delete set null,
  amount              numeric not null default 0,
  status              text not null default 'due' check (status in ('due', 'paid', 'cancelled')),
  paid_at             timestamptz,
  paid_by             uuid references profiles(id) on delete set null,
  note                text,
  created_at          timestamptz not null default now()
);
alter table referral_rewards enable row level security;
drop policy if exists "managers_rewards" on referral_rewards;
create policy "managers_rewards" on referral_rewards for select using (is_manager());
-- Changes only through mark_referral_reward()

-- A referred lead that becomes a job: reward due, managers told
create or replace function quotation_referral_reward()
returns trigger language plpgsql security definer set search_path = public as $$
declare ref projects%rowtype; amt numeric := coalesce((setting('referral')->>'reward_amount')::numeric, 0);
begin
  if new.status = 'project_created' and old.status <> 'project_created' and new.referred_by_project is not null then
    select * into ref from projects where id = new.referred_by_project;
    insert into referral_rewards (quotation_id, referrer_project_id, amount) values (new.id, new.referred_by_project, amt)
      on conflict (quotation_id) do nothing;
    insert into notifications (user_id, type, title, message, link)
      select id, 'referral', 'Referral reward due',
             coalesce(ref.customer_name, 'A customer') || ' referred ' || new.customer_name || ' (now job ' || coalesce(new.job_number, '') || '). Reward ₹' || amt,
             '/staff/growth'
        from profiles where role in ('admin', 'task_manager') and status = 'active';
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_referral_reward on quotation_requests;
create trigger trg_quotation_referral_reward after update on quotation_requests
  for each row execute function quotation_referral_reward();

create or replace function mark_referral_reward(p_reward uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager can do this.'; end if;
  if p_status not in ('paid', 'cancelled', 'due') then raise exception 'Unknown status.'; end if;
  update referral_rewards set status = p_status, note = left(p_note, 300),
         paid_at = case when p_status = 'paid' then now() end, paid_by = case when p_status = 'paid' then auth.uid() end
   where id = p_reward;
  if not found then raise exception 'Reward not found.'; end if;
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'referral_reward_' || p_status, 'referral_rewards', p_reward, coalesce(p_note, ''));
end;$$;
revoke all on function mark_referral_reward(uuid, text, text) from public, anon;
grant execute on function mark_referral_reward(uuid, text, text) to authenticated;

-- ═══ 6. Payments: due dates follow milestones, part payments, receipts ══════
alter table project_payments add column if not exists amount_received numeric not null default 0;
alter table project_payments add column if not exists trigger_stage   text;
alter table project_payments add column if not exists alerted_at      timestamptz;

create or replace function payment_stage_of(p_name text) returns text language sql immutable as $$
  select case
    when p_name ~* '^advance'                     then 'order_confirmed'
    when p_name ~* 'material'                     then 'material_procurement'
    when p_name ~* 'commission|handover|balance'  then 'commissioning'
    else null end;
$$;
update project_payments set trigger_stage = payment_stage_of(milestone_name) where trigger_stage is null and status <> 'paid';
update project_payments set amount_received = amount where status = 'paid' and amount_received = 0;

create or replace function payment_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.trigger_stage := coalesce(new.trigger_stage, payment_stage_of(new.milestone_name));
  if new.due_date is null and new.trigger_stage is not null then
    select coalesce(actual_date, planned_date) into new.due_date from project_stage_history
     where project_id = new.project_id and stage_code = new.trigger_stage;
  end if;
  if new.status = 'paid' and coalesce(new.amount_received, 0) = 0 then new.amount_received := new.amount; end if;
  return new;
end;$$;
drop trigger if exists trg_payment_defaults on project_payments;
create trigger trg_payment_defaults before insert on project_payments for each row execute function payment_defaults();
update project_payments p set due_date = coalesce(s.actual_date, s.planned_date)
  from project_stage_history s
 where p.due_date is null and p.status <> 'paid' and s.project_id = p.project_id and s.stage_code = p.trigger_stage;

-- A milestone's date moves → the payment tied to it moves too
create or replace function stage_payment_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.actual_date, new.planned_date) is distinct from coalesce(old.actual_date, old.planned_date) then
    update project_payments set due_date = coalesce(new.actual_date, new.planned_date), alerted_at = null
     where project_id = new.project_id and trigger_stage = new.stage_code and status not in ('paid', 'waived');
  end if;
  return new;
end;$$;
drop trigger if exists trg_stage_payment_sync on project_stage_history;
create trigger trg_stage_payment_sync after update on project_stage_history
  for each row execute function stage_payment_sync();

create table if not exists payment_receipts (
  id          uuid default gen_random_uuid() primary key,
  payment_id  uuid not null references project_payments(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  mode        text check (mode in ('cash', 'upi', 'neft', 'cheque', 'subsidy', 'other')),
  reference   text,
  received_on date not null,
  recorded_by uuid references profiles(id) on delete set null,
  recorded_by_name text,
  created_at  timestamptz not null default now()
);
alter table payment_receipts enable row level security;
drop policy if exists "view_receipts" on payment_receipts;
create policy "view_receipts" on payment_receipts for select using (can_view_project(project_id));

create or replace function record_payment(p_payment uuid, p_amount numeric, p_mode text, p_ref text, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay project_payments%rowtype; got numeric; left_due numeric;
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager records payments.'; end if;
  select * into pay from project_payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if pay.status in ('paid', 'waived') then raise exception 'This payment is already closed.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received.'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose the date the money was received (not in the future).'; end if;
  left_due := pay.amount - coalesce(pay.amount_received, 0);
  if p_amount > left_due + 1 then raise exception 'That is more than the ₹% still due on this payment.', round(left_due); end if;
  got := coalesce(pay.amount_received, 0) + p_amount;
  insert into payment_receipts (payment_id, project_id, amount, mode, reference, received_on, recorded_by, recorded_by_name)
    values (pay.id, pay.project_id, p_amount, nullif(p_mode, ''), nullif(left(p_ref, 120), ''), p_date, auth.uid(), my_name());
  update project_payments set amount_received = got,
         status = case when got >= amount - 1 then 'paid' else 'partial' end,
         paid_date = case when got >= amount - 1 then p_date else paid_date end,
         payment_mode = case when p_mode in ('cash', 'upi', 'neft', 'cheque', 'other') then p_mode else coalesce(payment_mode, 'other') end,
         reference_number = nullif(concat_ws(' · ', nullif(reference_number, ''), nullif(left(p_ref, 120), '')), '')
   where id = pay.id;
  -- Everything paid → the "Final payment received" milestone is done
  if not exists (select 1 from project_payments where project_id = pay.project_id and status not in ('paid', 'waived')) then
    update project_stage_history set status = 'completed', actual_date = coalesce(actual_date, p_date)
     where project_id = pay.project_id and stage_code = 'final_payment' and status not in ('completed', 'skipped');
  end if;
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'payment_recorded', 'project_payments', pay.id, '₹' || round(p_amount) || ' received for "' || pay.milestone_name || '"');
  return jsonb_build_object('received', got, 'due', greatest(pay.amount - got, 0));
end;$$;
revoke all on function record_payment(uuid, numeric, text, text, date) from public, anon;
grant execute on function record_payment(uuid, numeric, text, text, date) to authenticated;

-- ═══ 9. Commissioning checklist ═════════════════════════════════════════════
create table if not exists commissioning_reports (
  project_id      uuid primary key references projects(id) on delete cascade,
  data            jsonb not null default '{}',
  photos          jsonb not null default '{}',
  signature_url   text,
  signed_name     text,
  signed_at       timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references profiles(id) on delete set null,
  override_reason text,
  updated_by      uuid references profiles(id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
alter table commissioning_reports enable row level security;

create or replace function can_work_on_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or is_project_officer(p_project)
      or exists (select 1 from project_employees where project_id = p_project and employee_id = auth.uid() and released_date is null and is_staff());
$$;
drop policy if exists "view_commissioning" on commissioning_reports;
create policy "view_commissioning" on commissioning_reports for select using (can_view_project(project_id));
drop policy if exists "add_commissioning" on commissioning_reports;
create policy "add_commissioning" on commissioning_reports for insert with check (can_work_on_project(project_id));
drop policy if exists "edit_commissioning" on commissioning_reports;
create policy "edit_commissioning" on commissioning_reports for update using (can_work_on_project(project_id)) with check (can_work_on_project(project_id));

-- What is still missing (the same list the page shows)
create or replace function commissioning_missing(p_project uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare r commissioning_reports%rowtype; miss text[] := '{}'; k text;
  photo_keys text[] := array['array', 'structure', 'inverter', 'acdb_dcdb', 'earthing', 'meter'];
  photo_names text[] := array['Photo: panel array', 'Photo: mounting structure', 'Photo: inverter (switched on)', 'Photo: ACDB / DCDB',
                              'Photo: earthing & lightning arrester', 'Photo: net meter with reading'];
  data_keys text[] := array['inverter_serial', 'panel_serials', 'string_voc', 'insulation_mohm', 'earth_ohm', 'meter_reading',
                            'check_monitoring', 'check_training', 'check_warranty'];
  data_names text[] := array['Inverter serial number', 'Panel serial numbers', 'String voltage (Voc)', 'Insulation resistance',
                             'Earth resistance', 'Meter reading at commissioning', 'Monitoring app set up', 'Customer shown how to use and clean',
                             'Warranty cards handed over'];
  i int;
begin
  select * into r from commissioning_reports where project_id = p_project;
  if not found then return array['Checklist not started']; end if;
  if r.override_reason is not null then return '{}'; end if;
  for i in 1..array_length(photo_keys, 1) loop
    if jsonb_array_length(coalesce(r.photos->photo_keys[i], '[]')) = 0 then miss := miss || photo_names[i]; end if;
  end loop;
  for i in 1..array_length(data_keys, 1) loop
    k := data_keys[i];
    if k like 'check_%' then
      if not coalesce((r.data->>k)::boolean, false) then miss := miss || data_names[i]; end if;
    elsif coalesce(trim(r.data->>k), '') = '' then miss := miss || data_names[i];
    end if;
  end loop;
  if coalesce(trim(r.signed_name), '') = '' or r.signature_url is null then miss := miss || 'Customer signature'::text; end if;
  return miss;
end;$$;

create or replace function commissioning_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.completed_at is not null and not is_manager() and auth.uid() is not null then
    raise exception 'The commissioning report is complete. Ask the admin manager or CEO to change it.';
  end if;
  if auth.uid() is not null and not is_admin() then
    new.override_reason := case when tg_op = 'UPDATE' then old.override_reason end;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_by_name := coalesce(my_name(), new.updated_by_name);
  new.updated_at := now();
  if new.signature_url is not null and new.signed_at is null then new.signed_at := now(); end if;
  return new;
end;$$;
drop trigger if exists trg_commissioning_touch on commissioning_reports;
create trigger trg_commissioning_touch before insert or update on commissioning_reports
  for each row execute function commissioning_touch();

-- Complete the report (everything present), or the CEO completes it with a written reason
create or replace function complete_commissioning(p_project uuid, p_override_reason text default null)
returns text[] language plpgsql security definer set search_path = public as $$
declare miss text[];
begin
  if not can_work_on_project(p_project) then raise exception 'You are not on this project.'; end if;
  if nullif(trim(p_override_reason), '') is not null then
    if not is_admin() then raise exception 'Only the CEO can complete the report with items missing.'; end if;
    insert into commissioning_reports (project_id) values (p_project) on conflict (project_id) do nothing;
    update commissioning_reports set override_reason = left(trim(p_override_reason), 300) where project_id = p_project;
  end if;
  miss := commissioning_missing(p_project);
  if cardinality(miss) > 0 then return miss; end if;
  update commissioning_reports set completed_at = coalesce(completed_at, now()), completed_by = coalesce(completed_by, auth.uid())
   where project_id = p_project;
  update project_stage_history set status = 'completed'
   where project_id = p_project and stage_code = 'testing' and status not in ('completed', 'skipped');
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'commissioning_completed', 'projects', p_project,
            'Commissioning checklist completed' || coalesce(' (CEO override: ' || nullif(trim(p_override_reason), '') || ')', ''));
  return '{}';
end;$$;
revoke all on function complete_commissioning(uuid, text) from public, anon;
grant execute on function complete_commissioning(uuid, text) to authenticated;

-- Poka-yoke: "Commissioning certificate issued" cannot be ticked before the checklist is complete
-- (projects taken over as "ongoing" are exempt: their earlier work was not recorded here)
create or replace function stage_commissioning_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare miss text[];
begin
  if new.stage_code = 'commissioning' and new.status = 'completed' and old.status <> 'completed'
     and not exists (select 1 from projects where id = new.project_id and onboarded_at is not null)
     and not exists (select 1 from commissioning_reports where project_id = new.project_id and completed_at is not null) then
    miss := commissioning_missing(new.project_id);
    raise exception 'Complete the commissioning checklist first (missing: %).', array_to_string(miss[1:4], ', ') || case when cardinality(miss) > 4 then ' …' else '' end;
  end if;
  return new;
end;$$;
drop trigger if exists trg_stage_commissioning_gate on project_stage_history;
create trigger trg_stage_commissioning_gate before update on project_stage_history
  for each row execute function stage_commissioning_gate();

-- ═══ 3 & 6. Alerts (every 15 minutes with pg_cron; also whenever a manager opens the Control room) ═══
create table if not exists alert_runs (id int primary key default 1 check (id = 1), last_run timestamptz);
alter table alert_runs enable row level security;   -- no policies: only the function below

create or replace function notify_managers(p_type text, p_title text, p_message text, p_link text, p_also uuid[] default '{}')
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, message, link)
  select distinct u, p_type, p_title, p_message, p_link
    from (select id as u from profiles where role in ('admin', 'task_manager') and status = 'active'
          union select unnest(p_also)) x
   where u is not null;
$$;
revoke all on function notify_managers(text, text, text, text, uuid[]) from public, anon, authenticated;

create or replace function run_scheduled_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a        jsonb := setting('alerts');
  mins     int := coalesce((a->>'first_call_minutes')::int, 60);
  local_t  timestamp := now() at time zone 'Asia/Kolkata';
  today    date := (now() at time zone 'Asia/Kolkata')::date;
  in_hours boolean := extract(hour from local_t) >= coalesce((a->>'day_start')::int, 9) and extract(hour from local_t) < coalesce((a->>'day_end')::int, 19);
  q        record;
  n_lead   int := 0; n_fu int := 0; n_pay int := 0; n_svc jsonb := '{}';
  last     timestamptz;
begin
  if auth.uid() is not null and not is_staff() then raise exception 'Please sign in again.'; end if;
  if not pg_try_advisory_xact_lock(hashtext('greenergy-alerts')) then return '{"skipped": true}'; end if;
  select last_run into last from alert_runs where id = 1;
  if auth.uid() is not null and last > now() - interval '5 minutes' then return '{"skipped": true}'; end if;
  insert into alert_runs (id, last_run) values (1, now()) on conflict (id) do update set last_run = now();

  -- Leads nobody has called (working hours only, last 14 days)
  if in_hours then
    for q in select * from quotation_requests
              where first_contact_at is null and first_call_alerted_at is null
                and status in ('new', 'sales_review', 'site_details_pending')
                and created_at < now() - make_interval(mins => mins) and created_at > now() - interval '14 days' loop
      perform notify_managers('lead', 'Call this lead now — not contacted for ' ||
                case when now() - q.created_at > interval '2 hours' then round(extract(epoch from now() - q.created_at) / 3600) || ' hours' else mins || '+ minutes' end,
                q.customer_name || ' · ' || q.mobile || coalesce(' · ' || q.city, '') || ' · ' || coalesce(q.quotation_number, ''),
                '/staff/quotations/' || q.id, array[q.assigned_engineer_id, q.assigned_sales_id, q.follow_up_manager_id]);
      update quotation_requests set first_call_alerted_at = now() where id = q.id;
      n_lead := n_lead + 1;
    end loop;
  end if;

  -- Follow-ups due today or overdue: once a day, to the follow-up person (or the preparer)
  if extract(hour from local_t) >= 8 then
    for q in select * from quotation_requests
              where next_follow_up_date <= today and follow_up_alerted_on is distinct from today
                and status not in ('project_created', 'cancelled', 'rejected') loop
      insert into notifications (user_id, type, title, message, link)
        select u, 'quotation', case when q.next_follow_up_date < today then 'Follow-up overdue' else 'Follow-up due today' end,
               q.customer_name || ' · ' || q.mobile || coalesce(' · ' || upper(q.lead_temperature), ''), '/staff/quotations/' || q.id
          from (select coalesce(q.follow_up_manager_id, q.assigned_sales_id) u) x where u is not null;
      update quotation_requests set follow_up_alerted_on = today where id = q.id;
      n_fu := n_fu + 1;
    end loop;
  end if;

  -- Customer payments past their due date: managers, then again weekly
  for q in select pp.*, p.customer_name, p.job_number from project_payments pp join projects p on p.id = pp.project_id
            where pp.status in ('pending', 'partial', 'overdue') and pp.due_date < today
              and (pp.alerted_at is null or pp.alerted_at < now() - interval '7 days') loop
    perform notify_managers('payment', 'Payment overdue', coalesce(q.job_number, '') || ' · ' || coalesce(q.customer_name, '') || ' · ₹' ||
              round(q.amount - coalesce(q.amount_received, 0)) || ' (' || q.milestone_name || ') due ' || to_char(q.due_date, 'DD Mon'),
              '/staff/projects/' || q.project_id);
    update project_payments set alerted_at = now() where id = q.id;
    n_pay := n_pay + 1;
  end loop;

  if to_regproc('run_service_alerts') is not null then execute 'select run_service_alerts()' into n_svc; end if;
  return jsonb_build_object('leads', n_lead, 'follow_ups', n_fu, 'payments', n_pay, 'service', n_svc);
end;$$;
revoke all on function run_scheduled_alerts() from public, anon;
grant execute on function run_scheduled_alerts() to authenticated;

-- Every 15 minutes in the background, if pg_cron is available (Supabase: Database → Extensions).
-- Without it, alerts still run each time a manager opens the Control room or the dashboard.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here; alerts run when the Control room or dashboard is opened.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('greenergy-alerts', '*/15 * * * *', 'select public.run_scheduled_alerts()');
  end if;
exception when others then
  raise notice 'Could not schedule the alerts job: %', sqlerrm;
end $$;
