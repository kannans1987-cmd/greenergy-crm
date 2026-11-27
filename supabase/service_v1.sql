-- Service v1 (27 Nov 2026): earn from the systems already installed.
--  * Maintenance contracts (AMC): numbered GSS/AMC/2026-27/0001, yearly fee, visits per year.
--    Creating one schedules its visits as service tickets; renewal is reminded 30 days before expiry.
--  * Service tickets: GSS/SR/2026-27/0001 for breakdowns, cleaning, inspections and AMC visits,
--    with a due date (by priority), the technician, the resolution and an optional charge.
--  * Service invoices: GSS/SI/2026-27/0001 (one series, gap-free), for a chargeable ticket or an AMC fee.
--  * O&M clock-ins can name the ticket: the hours spent on each job are known (billable vs not).
-- Needs growth_v1.sql (alerts) and attendance_multi_v1.sql first. Safe to run more than once.

create table if not exists service_contracts (
  id                 uuid default gen_random_uuid() primary key,
  contract_number    text unique,
  project_id         uuid references projects(id) on delete set null,
  customer_name      text not null check (char_length(customer_name) between 1 and 120),
  customer_mobile    text,
  site_address       text,
  region             text not null default 'puducherry' check (region in ('puducherry', 'tamilnadu')),
  capacity_kw        numeric,
  plan               text not null default 'Standard',
  visits_per_year    integer not null default 2 check (visits_per_year between 1 and 12),
  includes_cleaning  boolean not null default true,
  start_date         date not null,
  end_date           date not null,
  fee                numeric not null default 0 check (fee >= 0),     -- per contract, before GST
  gst_pct            numeric not null default 18 check (gst_pct between 0 and 28),
  status             text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  invoice_number     text unique,
  invoiced_at        timestamptz,
  paid_at            date,
  payment_mode       text,
  payment_ref        text,
  renewal_alerted_at timestamptz,
  renewed_to         uuid references service_contracts(id) on delete set null,
  notes              text,
  created_by         uuid references profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  check (end_date > start_date)
);

create table if not exists service_tickets (
  id               uuid default gen_random_uuid() primary key,
  ticket_number    text unique,
  contract_id      uuid references service_contracts(id) on delete set null,
  project_id       uuid references projects(id) on delete set null,
  customer_name    text not null check (char_length(customer_name) between 1 and 120),
  customer_mobile  text,
  site_address     text,
  region           text not null default 'puducherry' check (region in ('puducherry', 'tamilnadu')),
  kind             text not null default 'breakdown' check (kind in ('amc_visit', 'breakdown', 'cleaning', 'inspection', 'installation_fix', 'other')),
  priority         text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  description      text not null check (char_length(description) between 1 and 2000),
  status           text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled')),
  assigned_to      uuid references profiles(id) on delete set null,
  scheduled_for    date,
  due_date         date,
  resolved_at      timestamptz,
  resolution_notes text,
  chargeable       boolean not null default false,
  charge_amount    numeric not null default 0 check (charge_amount >= 0),   -- before GST
  gst_pct          numeric not null default 18 check (gst_pct between 0 and 28),
  invoice_number   text unique,
  invoiced_at      timestamptz,
  paid_at          date,
  payment_mode     text,
  payment_ref      text,
  alerted_on       date,
  created_by       uuid references profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists service_tickets_open on service_tickets (status, due_date);
create index if not exists service_tickets_assignee on service_tickets (assigned_to, status);

alter table service_contracts enable row level security;
alter table service_tickets   enable row level security;
drop policy if exists "managers_contracts" on service_contracts;
create policy "managers_contracts" on service_contracts for select using (is_manager());
drop policy if exists "managers_add_contracts" on service_contracts;
create policy "managers_add_contracts" on service_contracts for insert with check (is_manager());
drop policy if exists "managers_edit_contracts" on service_contracts;
create policy "managers_edit_contracts" on service_contracts for update using (is_manager()) with check (is_manager());
drop policy if exists "ceo_delete_contracts" on service_contracts;
create policy "ceo_delete_contracts" on service_contracts for delete using (is_admin());

drop policy if exists "view_tickets" on service_tickets;
create policy "view_tickets" on service_tickets for select using (is_manager() or (assigned_to = auth.uid() and is_staff()));
drop policy if exists "add_tickets" on service_tickets;
create policy "add_tickets" on service_tickets for insert with check (is_staff());
drop policy if exists "edit_tickets" on service_tickets;
create policy "edit_tickets" on service_tickets for update using (is_manager() or (assigned_to = auth.uid() and is_staff()))
  with check (is_manager() or assigned_to = auth.uid());
drop policy if exists "ceo_delete_tickets" on service_tickets;
create policy "ceo_delete_tickets" on service_tickets for delete using (is_admin());

-- Numbers, defaults and who may change what
create or replace function service_contract_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.contract_number := next_doc_number('AMC');
    new.invoice_number := null; new.invoiced_at := null; new.renewed_to := null;
  elsif new.contract_number is distinct from old.contract_number
     or (new.invoice_number is distinct from old.invoice_number and coalesce(current_setting('greenergy.invoicing', true), '') <> 'on') then
    raise exception 'Contract and invoice numbers are issued by the CRM and cannot be changed.';
  elsif old.invoice_number is not null and auth.uid() is not null
     and (new.fee, new.gst_pct, new.customer_name, new.region) is distinct from (old.fee, old.gst_pct, old.customer_name, old.region) then
    raise exception 'This contract is invoiced: fee, GST, customer and state are fixed.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_service_contract_guard on service_contracts;
create trigger trg_service_contract_guard before insert or update on service_contracts
  for each row execute function service_contract_guard();

create or replace function service_ticket_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare mgr boolean := auth.uid() is null or is_manager(); today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if tg_op = 'INSERT' then
    new.ticket_number := next_doc_number('SR');
    new.invoice_number := null; new.invoiced_at := null; new.paid_at := null;
    if not mgr then new.assigned_to := null; new.status := 'open'; new.chargeable := false; new.charge_amount := 0; end if;
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
  if not mgr then
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
drop trigger if exists trg_service_ticket_guard on service_tickets;
create trigger trg_service_ticket_guard before insert or update on service_tickets
  for each row execute function service_ticket_guard();

create or replace function service_ticket_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into notifications (user_id, type, title, message, link) values (new.assigned_to, 'service', 'Service job given to you',
      new.ticket_number || ' · ' || new.customer_name || coalesce(' · ' || new.customer_mobile, '') || ' · due ' || to_char(new.due_date, 'DD Mon'),
      '/staff/service/' || new.id);
  end if;
  if tg_op = 'INSERT' and new.kind = 'breakdown' and new.assigned_to is null then
    perform notify_managers('service', 'New breakdown — assign a technician', new.ticket_number || ' · ' || new.customer_name, '/staff/service/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'resolved' and old.status <> 'resolved' then
    perform notify_managers('service', 'Service job resolved' || case when new.chargeable and new.invoice_number is null then ' — send the invoice' else '' end,
      new.ticket_number || ' · ' || new.customer_name, '/staff/service/' || new.id);
  end if;
  return new;
end;$$;
drop trigger if exists trg_service_ticket_notify on service_tickets;
create trigger trg_service_ticket_notify after insert or update on service_tickets
  for each row execute function service_ticket_notify();

-- A new contract books its visits, spread across the year
create or replace function service_contract_visits()
returns trigger language plpgsql security definer set search_path = public as $$
declare i int; d date; days int := new.end_date - new.start_date;
begin
  for i in 0 .. new.visits_per_year - 1 loop
    d := new.start_date + round((i + 0.5) * days / new.visits_per_year)::int;
    insert into service_tickets (contract_id, project_id, customer_name, customer_mobile, site_address, region, kind, priority,
                                 description, scheduled_for, due_date)
    values (new.id, new.project_id, new.customer_name, new.customer_mobile, new.site_address, new.region, 'amc_visit', 'normal',
            'AMC visit ' || (i + 1) || ' of ' || new.visits_per_year || ' (' || new.contract_number || '): '
              || case when new.includes_cleaning then 'panel cleaning, ' else '' end
              || 'visual inspection, torque check, IR / earth test, inverter log check.',
            d, d + 7);
  end loop;
  return new;
end;$$;
drop trigger if exists trg_service_contract_visits on service_contracts;
create trigger trg_service_contract_visits after insert on service_contracts
  for each row execute function service_contract_visits();

-- Renew: same terms for the next period
create or replace function renew_amc_contract(p_contract uuid, p_fee numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c service_contracts%rowtype; new_id uuid;
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager can renew a contract.'; end if;
  select * into c from service_contracts where id = p_contract for update;
  if not found then raise exception 'Contract not found.'; end if;
  if c.renewed_to is not null then raise exception 'Already renewed.'; end if;
  insert into service_contracts (project_id, customer_name, customer_mobile, site_address, region, capacity_kw, plan,
                                 visits_per_year, includes_cleaning, start_date, end_date, fee, gst_pct, notes)
  values (c.project_id, c.customer_name, c.customer_mobile, c.site_address, c.region, c.capacity_kw, c.plan,
          c.visits_per_year, c.includes_cleaning, c.end_date + 1, c.end_date + 1 + (c.end_date - c.start_date),
          coalesce(p_fee, c.fee), c.gst_pct, 'Renewal of ' || c.contract_number)
  returning id into new_id;
  update service_contracts set renewed_to = new_id where id = c.id;
  return new_id;
end;$$;

-- Invoice numbers: one gap-free series for service work and AMC fees
create or replace function issue_service_invoice(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t service_tickets%rowtype; c service_contracts%rowtype; num text;
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager issues invoices.'; end if;
  perform set_config('greenergy.invoicing', 'on', true);
  if p_kind = 'ticket' then
    select * into t from service_tickets where id = p_id for update;
    if not found then raise exception 'Ticket not found.'; end if;
    if t.invoice_number is not null then return t.invoice_number; end if;
    if not t.chargeable or t.charge_amount <= 0 then raise exception 'Mark the job chargeable and enter the amount first.'; end if;
    if t.status not in ('resolved', 'closed') then raise exception 'Invoice after the job is resolved.'; end if;
    num := next_doc_number('SI');
    update service_tickets set invoice_number = num, invoiced_at = now() where id = p_id;
  elsif p_kind = 'amc' then
    select * into c from service_contracts where id = p_id for update;
    if not found then raise exception 'Contract not found.'; end if;
    if c.invoice_number is not null then return c.invoice_number; end if;
    if c.fee <= 0 then raise exception 'Enter the contract fee first.'; end if;
    num := next_doc_number('SI');
    update service_contracts set invoice_number = num, invoiced_at = now() where id = p_id;
  else
    raise exception 'Unknown invoice type.';
  end if;
  perform set_config('greenergy.invoicing', 'off', true);
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'service_invoice_issued', case when p_kind = 'ticket' then 'service_tickets' else 'service_contracts' end, p_id, num);
  return num;
end;$$;

create or replace function record_service_payment(p_kind text, p_id uuid, p_mode text, p_ref text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager records payments.'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose the date the money was received.'; end if;
  if p_kind = 'ticket' then
    update service_tickets set paid_at = p_date, payment_mode = left(p_mode, 20), payment_ref = left(p_ref, 120),
           status = case when status = 'resolved' then 'closed' else status end
     where id = p_id and invoice_number is not null;
  elsif p_kind = 'amc' then
    update service_contracts set paid_at = p_date, payment_mode = left(p_mode, 20), payment_ref = left(p_ref, 120)
     where id = p_id and invoice_number is not null;
  else raise exception 'Unknown type.';
  end if;
  if not found then raise exception 'Issue the invoice first.'; end if;
  insert into audit_log (action_by, action_type, target_entity, target_id, description)
    values (auth.uid(), 'service_payment_recorded', p_kind, p_id, coalesce(p_mode, '') || ' ' || coalesce(p_ref, ''));
end;$$;

revoke all on function renew_amc_contract(uuid, numeric), issue_service_invoice(text, uuid),
  record_service_payment(text, uuid, text, text, date) from public, anon;
grant execute on function renew_amc_contract(uuid, numeric), issue_service_invoice(text, uuid),
  record_service_payment(text, uuid, text, text, date) to authenticated;

-- Service alerts (called by run_scheduled_alerts)
create or replace function run_service_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; today date := (now() at time zone 'Asia/Kolkata')::date; n_visit int := 0; n_late int := 0; n_renew int := 0;
begin
  update service_contracts set status = 'expired' where status = 'active' and end_date < today;
  for t in select * from service_tickets where kind = 'amc_visit' and status = 'open' and assigned_to is null
            and scheduled_for <= today + 7 and alerted_on is null loop
    perform notify_managers('service', 'AMC visit to assign', t.ticket_number || ' · ' || t.customer_name || ' · ' || to_char(t.scheduled_for, 'DD Mon'),
                            '/staff/service/' || t.id);
    update service_tickets set alerted_on = today where id = t.id;
    n_visit := n_visit + 1;
  end loop;
  for t in select * from service_tickets where status in ('open', 'assigned', 'in_progress') and due_date < today
            and alerted_on is distinct from today loop
    perform notify_managers('service', 'Service job overdue', t.ticket_number || ' · ' || t.customer_name || ' · due ' || to_char(t.due_date, 'DD Mon'),
                            '/staff/service/' || t.id, array[t.assigned_to]);
    update service_tickets set alerted_on = today where id = t.id;
    n_late := n_late + 1;
  end loop;
  for t in select * from service_contracts where status = 'active' and renewed_to is null and renewal_alerted_at is null
            and end_date <= today + 30 loop
    perform notify_managers('service', 'AMC ends soon — offer the renewal', t.contract_number || ' · ' || t.customer_name || ' · ends ' || to_char(t.end_date, 'DD Mon YYYY'),
                            '/staff/service?tab=amc');
    update service_contracts set renewal_alerted_at = now() where id = t.id;
    n_renew := n_renew + 1;
  end loop;
  return jsonb_build_object('amc_visits', n_visit, 'overdue', n_late, 'renewals', n_renew);
end;$$;
revoke all on function run_service_alerts() from public, anon, authenticated;

-- ═══ Attendance: an O&M session can name the service job ═══
alter table attendance add column if not exists service_ticket_id uuid references service_tickets(id) on delete set null;

create or replace function attendance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ceo     boolean := auth.uid() is null or is_admin();
  office  office_locations%rowtype;
  dist    double precision;
  slack   double precision;
  others  numeric;
begin
  if tg_op = 'INSERT' then
    if not ceo then
      new.date           := (now() at time zone 'Asia/Kolkata')::date;
      new.clock_in_time  := now();
      new.clock_out_time := null; new.clock_out_lat := null; new.clock_out_lng := null;
      new.total_hours    := null; new.overtime_hours := 0;
      new.attendance_status := 'present';
      new.is_location_mismatch := false;
    end if;
    new.session_no := coalesce((select max(session_no) from attendance
                                where employee_id = new.employee_id and date = new.date), 0) + 1;

    if new.work_type = 'office' then
      new.project_id := null; new.service_ticket_id := null;
      if new.clock_in_lat is null or new.clock_in_lng is null then
        raise exception 'Your location is needed to clock in at the office.';
      end if;
      select * into office from office_locations where active
        order by geo_distance_m(lat, lng, new.clock_in_lat::float8, new.clock_in_lng::float8) limit 1;
      if not found then
        raise exception 'The office location has not been set yet. Ask the CEO to set it in Attendance → Office location.';
      end if;
      dist := geo_distance_m(office.lat, office.lng, new.clock_in_lat::float8, new.clock_in_lng::float8);
      new.office_location_id  := office.id;
      new.clock_in_distance_m := round(dist::numeric);
      slack := least(coalesce(new.clock_in_accuracy_m::float8, 0), 100);
      if dist > office.radius_m + slack and not ceo then
        raise exception 'You are about % m from %. Office clock-in works within % m. Go to the office (or near a window / outside for a better GPS signal) and try again.',
          round(dist::numeric), office.name, office.radius_m;
      end if;
    elsif new.project_id is null and new.service_ticket_id is null and not ceo then
      raise exception 'Choose the project / site or the service job you are working on.';
    end if;
    return new;
  end if;

  if not ceo then
    if old.clock_out_time is not null then
      raise exception 'This session is already clocked out.';
    end if;
    new.employee_id := old.employee_id; new.date := old.date; new.session_no := old.session_no; new.work_type := old.work_type;
    new.project_id := old.project_id; new.service_ticket_id := old.service_ticket_id; new.office_location_id := old.office_location_id;
    new.clock_in_time := old.clock_in_time; new.clock_in_lat := old.clock_in_lat; new.clock_in_lng := old.clock_in_lng;
    new.clock_in_address := old.clock_in_address; new.clock_in_accuracy_m := old.clock_in_accuracy_m;
    new.clock_in_distance_m := old.clock_in_distance_m; new.attendance_status := old.attendance_status;
    if new.clock_out_time is not null then new.clock_out_time := now(); end if;
  end if;

  if new.clock_out_time is not null and new.work_type = 'office' and new.clock_out_lat is not null and new.clock_out_lng is not null then
    select * into office from office_locations where id = new.office_location_id;
    if found then
      dist := geo_distance_m(office.lat, office.lng, new.clock_out_lat::float8, new.clock_out_lng::float8);
      new.clock_out_distance_m := round(dist::numeric);
      new.is_location_mismatch := dist > office.radius_m + least(coalesce(new.clock_out_accuracy_m::float8, 0), 100);
    end if;
  end if;

  if new.clock_out_time is not null and new.clock_in_time is not null then
    new.total_hours := round((extract(epoch from new.clock_out_time - new.clock_in_time) / 3600)::numeric, 2);
    select coalesce(sum(total_hours), 0) into others from attendance
      where employee_id = new.employee_id and date = new.date and id <> new.id and total_hours is not null;
    new.overtime_hours := greatest(0, others + new.total_hours - 8) - greatest(0, others - 8);
  else
    new.total_hours := null; new.overtime_hours := 0;
  end if;
  return new;
end;$$;

-- Clock-in now takes an optional service job (p_ticket). The old 8-argument version is replaced.
drop function if exists attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text);
create or replace function attendance_clock_in(
  p_device uuid, p_secret text, p_work_type text, p_project uuid,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_address text, p_ticket uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare dev uuid; new_id uuid; mode text; open_rec attendance%rowtype; tk service_tickets%rowtype;
        today date := (now() at time zone 'Asia/Kolkata')::date; proj uuid := p_project;
begin
  if auth.uid() is null or not is_staff() then raise exception 'Please sign in again.'; end if;
  if is_admin() then raise exception 'The CEO does not clock in or out.'; end if;
  dev := _check_attendance_device(p_device, p_secret);
  perform pg_advisory_xact_lock(hashtext('attendance:' || auth.uid()::text));

  select coalesce(attendance_mode, 'office') into mode from profiles where id = auth.uid();
  select * into open_rec from attendance
    where employee_id = auth.uid() and clock_out_time is null and clock_in_time > now() - interval '18 hours'
    order by clock_in_time desc limit 1;
  if found then
    raise exception 'You are still clocked in since % (session %). Clock out first.',
      to_char(open_rec.clock_in_time at time zone 'Asia/Kolkata', 'HH12:MI AM'), open_rec.session_no;
  end if;
  if mode = 'office' and exists (select 1 from attendance where employee_id = auth.uid() and date = today) then
    raise exception 'You have already clocked in today. (Office attendance is once a day; ask the CEO if you need several sessions for site work.)';
  end if;
  if (select count(*) from attendance where employee_id = auth.uid() and date = today) >= 12 then
    raise exception 'That is 12 sessions today already. Ask the CEO to correct your attendance.';
  end if;
  if p_ticket is not null then
    select * into tk from service_tickets where id = p_ticket;
    if not found or (tk.assigned_to is distinct from auth.uid() and not is_manager()) then
      raise exception 'That service job is not given to you.';
    end if;
    if tk.status in ('resolved', 'closed', 'cancelled') then raise exception 'That service job is already finished.'; end if;
    proj := coalesce(tk.project_id, p_project);
  elsif p_work_type = 'site' and p_project is not null and not is_manager() and not exists (
    select 1 from project_employees where project_id = p_project and employee_id = auth.uid() and released_date is null) then
    raise exception 'You are not assigned to that project.';
  end if;
  insert into attendance (employee_id, work_type, project_id, service_ticket_id, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_address, device_id)
    values (auth.uid(), case when p_work_type = 'office' and p_ticket is null then 'office' else 'site' end, proj, p_ticket,
            p_lat, p_lng, p_accuracy, left(p_address, 500), dev)
    returning id into new_id;
  if p_ticket is not null and tk.status in ('open', 'assigned') then
    update service_tickets set status = 'in_progress' where id = p_ticket;
  end if;
  return new_id;
end;$$;
revoke all on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text, uuid) from public, anon;
grant execute on function attendance_clock_in(uuid, text, text, uuid, double precision, double precision, double precision, text, uuid) to authenticated;
