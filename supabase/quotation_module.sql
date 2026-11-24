-- ═══════════════════════════════════════════════════════════════
-- GREENERGY — QUOTATION + PROJECT TRACKING MODULE
-- Run in Supabase SQL Editor AFTER schema.sql
-- ═══════════════════════════════════════════════════════════════

-- Extension (may already exist)
create extension if not exists "uuid-ossp";
create sequence if not exists quotation_number_seq start 1001;

-- TABLE: pricing_rules
-- Admin-configurable pricing engine per system type + consumer type
create table if not exists pricing_rules (
  id                        uuid default uuid_generate_v4() primary key,
  system_type               text not null check (system_type in ('ongrid','hybrid','offgrid','solar_pump')),
  consumer_type             text not null check (consumer_type in ('domestic','commercial','industrial','institution','agricultural')),
  dcr_price_per_kw          numeric not null default 60000,
  non_dcr_price_per_kw      numeric not null default 57500,
  panel_brand               text default 'Tier-1 MNRE Approved',
  inverter_brand            text default 'Tier-1',
  structure_cost_per_kw     numeric default 4500,
  dc_cable_cost_per_kw      numeric default 2500,
  ac_cable_cost_per_kw      numeric default 1500,
  earthing_cost             numeric default 2500,
  lightning_arrester_cost   numeric default 1500,
  civil_work_cost           numeric default 2000,
  net_meter_cost            numeric default 3000,
  eb_coordination_charges   numeric default 2000,
  transportation_cost       numeric default 1500,
  battery_cost_per_kwh      numeric default 25000,
  gst_percent               numeric default 12,
  subsidy_1kw               numeric default 30000,
  subsidy_2kw               numeric default 60000,
  subsidy_3kw               numeric default 78000,
  peak_sun_hours            numeric default 5.2,
  system_efficiency         numeric default 0.80,
  electricity_tariff        numeric default 4.5,
  validity_days             integer default 30,
  terms_conditions          text default 'Payment terms: 50% advance, 40% before commissioning, 10% after net-meter installation.\nWarranty: 25-year linear performance warranty on panels, 5-year on inverter, 1-year workmanship.\nThis quotation is valid for 30 days from date of issue.',
  disclaimer                text default 'Final quotation is subject to site inspection, technical feasibility, DISCOM/EB approval, stock availability, and management approval.',
  updated_by                uuid references profiles(id),
  updated_at                timestamptz default now()
);

-- TABLE: quotation_requests
create table if not exists quotation_requests (
  id                        uuid default uuid_generate_v4() primary key,
  quotation_number          text unique,

  -- Customer details
  customer_name             text not null,
  mobile                    text not null,
  email                     text,
  address                   text,
  city                      text,

  -- Technical requirements
  consumer_type             text check (consumer_type in ('domestic','commercial','industrial','institution','agricultural')),
  solar_type                text check (solar_type in ('ongrid','hybrid','offgrid','solar_pump','not_sure')),
  eb_consumer_number        text,
  sanctioned_load_kw        numeric,
  avg_monthly_bill          numeric,
  avg_monthly_units         numeric,
  required_capacity_kw      numeric,
  roof_type                 text check (roof_type in ('rcc','sheet','ground_mount','other')),
  available_roof_area_sqft  numeric,
  current_phase             text check (current_phase in ('single','three')),
  loan_required             boolean default false,
  subsidy_required          boolean default false,
  site_visit_required       boolean default true,
  notes                     text,

  -- Calculated estimates (auto-filled on submission)
  recommended_capacity_kw   numeric,
  estimated_daily_gen_kwh   numeric,
  estimated_monthly_gen_kwh numeric,
  estimated_yearly_gen_kwh  numeric,
  estimated_monthly_savings numeric,
  estimated_yearly_savings  numeric,
  estimated_payback_years   numeric,
  estimated_25yr_savings    numeric,
  subsidy_applicable        numeric,
  system_cost               numeric,
  gst_amount                numeric,
  total_cost_before_subsidy numeric,
  net_cost_after_subsidy    numeric,

  -- Workflow status
  status                    text not null default 'new' check (status in (
    'new','sales_review','site_details_pending','site_visit_scheduled',
    'site_visit_done','technical_review','drafted','owner_approval_pending',
    'approved','sent_to_customer','customer_accepted','advance_pending',
    'project_created','rejected','cancelled','more_info_requested'
  )),
  priority                  text default 'normal' check (priority in ('low','normal','high','urgent')),

  -- Documents (URLs from Supabase Storage)
  eb_bill_url               text,
  roof_photo_url            text,

  -- Staff assignment
  assigned_sales_id         uuid references profiles(id),
  assigned_engineer_id      uuid references profiles(id),

  -- Admin review
  reviewed_by               uuid references profiles(id),
  reviewed_at               timestamptz,
  rejection_reason          text,
  more_info_request         text,
  admin_remarks             text,

  -- Edited values (admin can override customer-calculated values)
  admin_capacity_kw         numeric,
  admin_system_cost         numeric,
  admin_gst_amount          numeric,
  admin_total_cost          numeric,
  admin_subsidy             numeric,
  admin_net_cost            numeric,

  -- Lifecycle timestamps
  approved_at               timestamptz,
  sent_to_customer_at       timestamptz,
  customer_response_at      timestamptz,

  -- Customer portal token (for sharing link)
  portal_token              uuid default uuid_generate_v4() unique,

  -- Source tracking
  source                    text default 'website' check (source in ('website','walk_in','referral','phone','social_media','other')),

  -- Linked project after conversion
  project_id                uuid references projects(id),
  converted_at              timestamptz,
  converted_by              uuid references profiles(id),

  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- TABLE: quotation_line_items
create table if not exists quotation_line_items (
  id              uuid default uuid_generate_v4() primary key,
  quotation_id    uuid references quotation_requests(id) on delete cascade not null,
  sort_order      integer default 0,
  category        text default 'Equipment',
  description     text not null,
  quantity        numeric default 1,
  unit            text default 'nos',
  unit_price      numeric default 0,
  is_optional     boolean default false,
  is_included     boolean default true,
  note            text,
  created_at      timestamptz default now()
);

-- TABLE: quotation_status_history
create table if not exists quotation_status_history (
  id              uuid default uuid_generate_v4() primary key,
  quotation_id    uuid references quotation_requests(id) on delete cascade not null,
  from_status     text,
  to_status       text not null,
  changed_by      uuid references profiles(id),
  changed_by_name text,
  remarks         text,
  created_at      timestamptz default now()
);

-- TABLE: quotation_comments
create table if not exists quotation_comments (
  id              uuid default uuid_generate_v4() primary key,
  quotation_id    uuid references quotation_requests(id) on delete cascade not null,
  author_id       uuid references profiles(id),
  author_name     text not null,
  content         text not null,
  is_internal     boolean default true,
  created_at      timestamptz default now()
);

-- TABLE: project_documents
create table if not exists project_documents (
  id              uuid default uuid_generate_v4() primary key,
  project_id      uuid references projects(id) on delete cascade,
  quotation_id    uuid references quotation_requests(id) on delete set null,
  doc_type        text check (doc_type in (
    'eb_bill','aadhaar','pan','property_doc','bank_doc','site_photo',
    'roof_measurement','sld','layout_2d','quotation_pdf','work_order',
    'invoice','payment_receipt','commissioning_letter','net_meter_doc',
    'warranty_doc','other'
  )),
  file_name       text not null,
  file_url        text not null,
  file_size_kb    integer,
  uploaded_by     uuid references profiles(id),
  uploaded_by_name text,
  notes           text,
  created_at      timestamptz default now()
);

-- TABLE: project_payments
create table if not exists project_payments (
  id               uuid default uuid_generate_v4() primary key,
  project_id       uuid references projects(id) on delete cascade not null,
  quotation_id     uuid references quotation_requests(id),
  milestone_name   text not null,
  percentage       numeric,
  amount           numeric not null,
  due_date         date,
  paid_date        date,
  payment_mode     text check (payment_mode in ('cash','upi','neft','cheque','other')),
  reference_number text,
  status           text default 'pending' check (status in ('pending','partial','paid','overdue','waived')),
  receipt_url      text,
  notes            text,
  created_by       uuid references profiles(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- TABLE: project_stage_history
create table if not exists project_stage_history (
  id               uuid default uuid_generate_v4() primary key,
  project_id       uuid references projects(id) on delete cascade not null,
  stage_code       text not null,
  stage_name       text not null,
  status           text default 'pending' check (status in ('pending','in_progress','completed','skipped','blocked')),
  started_at       timestamptz,
  completed_at     timestamptz,
  responsible_id   uuid references profiles(id),
  responsible_name text,
  notes            text,
  photos           text[],
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ─── AUTO-NUMBER TRIGGER ─────────────────────────────────────────
create or replace function set_quotation_number()
returns trigger language plpgsql as $$
begin
  if new.quotation_number is null then
    new.quotation_number := 'GSS-QT-' || extract(year from now())::text || '-' ||
                            lpad(nextval('quotation_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_quotation_number on quotation_requests;
create trigger trg_set_quotation_number
  before insert on quotation_requests
  for each row execute function set_quotation_number();

-- ─── UPDATED_AT TRIGGERS ─────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_quotation_updated') then
    create trigger trg_quotation_updated before update on quotation_requests
      for each row execute function touch_updated_at();
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_payment_updated') then
    create trigger trg_payment_updated before update on project_payments
      for each row execute function touch_updated_at();
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_stage_updated') then
    create trigger trg_stage_updated before update on project_stage_history
      for each row execute function touch_updated_at();
  end if;
end $$;

-- ─── SEED: Default pricing rules ────────────────────────────────
insert into pricing_rules (system_type, consumer_type, dcr_price_per_kw, non_dcr_price_per_kw, electricity_tariff)
values
  ('ongrid',     'domestic',      60000, 57500, 4.50),
  ('ongrid',     'commercial',    59000, 56500, 7.50),
  ('ongrid',     'industrial',    57000, 54500, 8.00),
  ('ongrid',     'institution',   58000, 55500, 6.00),
  ('hybrid',     'domestic',      75000, 72000, 4.50),
  ('hybrid',     'commercial',    73000, 70000, 7.50),
  ('hybrid',     'industrial',    71000, 68000, 8.00),
  ('offgrid',    'domestic',      85000, 82000, 4.50),
  ('solar_pump', 'agricultural',  52000, 50000, 3.50)
on conflict do nothing;

-- ─── RLS POLICIES ────────────────────────────────────────────────
alter table quotation_requests      enable row level security;
alter table quotation_line_items    enable row level security;
alter table quotation_status_history enable row level security;
alter table quotation_comments      enable row level security;
alter table project_documents       enable row level security;
alter table project_payments        enable row level security;
alter table project_stage_history   enable row level security;
alter table pricing_rules           enable row level security;

-- Quotation requests
drop policy if exists "admin_full_quotations"    on quotation_requests;
drop policy if exists "staff_assigned_quotations" on quotation_requests;
drop policy if exists "public_insert_quotation"  on quotation_requests;

create policy "admin_full_quotations" on quotation_requests
  for all using (is_admin() or is_manager());

create policy "staff_assigned_quotations" on quotation_requests
  for select using (
    assigned_sales_id = auth.uid() or assigned_engineer_id = auth.uid()
  );

create policy "public_insert_quotation" on quotation_requests
  for insert with check (true);

-- Line items
drop policy if exists "admin_lineitems" on quotation_line_items;
create policy "admin_lineitems" on quotation_line_items
  for all using (is_admin() or is_manager());

drop policy if exists "staff_read_lineitems" on quotation_line_items;
create policy "staff_read_lineitems" on quotation_line_items
  for select using (auth.role() = 'authenticated');

-- Status history
drop policy if exists "staff_status_history" on quotation_status_history;
create policy "staff_status_history" on quotation_status_history
  for all using (auth.role() = 'authenticated');

-- Comments
drop policy if exists "staff_comments" on quotation_comments;
create policy "staff_comments" on quotation_comments
  for all using (auth.role() = 'authenticated');

-- Documents
drop policy if exists "staff_documents" on project_documents;
create policy "staff_documents" on project_documents
  for all using (auth.role() = 'authenticated');

-- Payments
drop policy if exists "admin_payments" on project_payments;
drop policy if exists "staff_read_payments" on project_payments;
create policy "admin_payments" on project_payments
  for all using (is_admin() or is_manager());
create policy "staff_read_payments" on project_payments
  for select using (auth.role() = 'authenticated');

-- Stage history
drop policy if exists "staff_stage_history" on project_stage_history;
create policy "staff_stage_history" on project_stage_history
  for all using (auth.role() = 'authenticated');

-- Pricing rules
drop policy if exists "admin_pricing_write" on pricing_rules;
drop policy if exists "staff_read_pricing" on pricing_rules;
create policy "admin_pricing_write" on pricing_rules
  for all using (is_admin());
create policy "staff_read_pricing" on pricing_rules
  for select using (auth.role() = 'authenticated');

-- Public read for customer quote form (anon can read pricing rules)
drop policy if exists "anon_read_pricing" on pricing_rules;
create policy "anon_read_pricing" on pricing_rules
  for select using (true);
