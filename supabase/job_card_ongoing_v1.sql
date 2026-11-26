-- Job cards for ongoing projects v1 (26 Nov 2026)
-- Projects that started before the CRM (or were added without a quotation) can get a numbered
-- job card (GSS/JC/<FY>/<n>, same series as converted quotations), with:
--   * the cradle-to-grave milestones, those already finished marked done and the current one in progress;
--   * the payment schedule as an opening balance: amount already received (paid) + balance due;
--   * an optional old / paper job card reference.
-- Either for an existing project record, or a new ongoing project entered in one step.
-- CEO and admin manager only. Safe to run more than once.

alter table projects add column if not exists legacy_ref text;   -- old / paper job card number, if any
alter table projects add column if not exists onboarded_at timestamptz;  -- when an ongoing project got its CRM job card

-- The job number may only be set by the CRM's own functions
create or replace function project_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('greenergy.converting', true), '') = 'on' then return new; end if;
  if new.job_number is distinct from old.job_number or new.quotation_id is distinct from old.quotation_id then
    raise exception 'The job card number and quotation link cannot be changed.';
  end if;
  if new.admin_officer_id is distinct from old.admin_officer_id and not is_admin() then
    raise exception 'Only the CEO can appoint the administrative officer.';
  end if;
  return new;
end;$$;

-- p_project: an existing project without a job card, or null to create the project from p_details.
-- p_details (all optional except customer_name for a new project):
--   customer_name, customer_mobile, site_address, capacity_kwp, project_type, region, subsidy_job,
--   order_value, received, start_date (order date), target_commissioning, current_stage (stage_code),
--   admin_officer_id, legacy_ref, notes
create or replace function create_job_card_for_ongoing(p_project uuid, p_details jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d        jsonb := coalesce(p_details, '{}'::jsonb);
  pr       projects%rowtype;
  v_job    text;
  v_start  date;
  v_sub    boolean;
  v_value  numeric;
  v_recv   numeric := greatest(coalesce(nullif(d->>'received', '')::numeric, 0), 0);
  v_cur    int;
  v_type   text;
  v_officer uuid := nullif(d->>'admin_officer_id', '')::uuid;
begin
  if not is_manager() then raise exception 'Only the CEO or admin manager can create a job card.'; end if;
  if v_officer is not null and not is_admin() then v_officer := null; end if;   -- only the CEO appoints officers
  v_type := case when d->>'project_type' in ('residential','commercial','industrial','street_light','solar_pump','hybrid') then d->>'project_type' end;

  if p_project is null then
    if coalesce(trim(d->>'customer_name'), '') = '' then raise exception 'Enter the customer name.'; end if;
    insert into projects (name, customer_name, customer_mobile, site_address, project_type, capacity_kwp, region,
                          subsidy_job, order_value, start_date, target_commissioning, status, notes, created_by)
    values (trim(d->>'customer_name') || coalesce(' - ' || nullif(d->>'capacity_kwp', '') || ' kW', ''),
            trim(d->>'customer_name'), nullif(trim(d->>'customer_mobile'), ''), nullif(trim(d->>'site_address'), ''),
            coalesce(v_type, 'residential'), nullif(d->>'capacity_kwp', '')::numeric,
            case when d->>'region' in ('puducherry','tamilnadu') then d->>'region' end,
            coalesce((d->>'subsidy_job')::boolean, false), nullif(d->>'order_value', '')::numeric,
            coalesce(nullif(d->>'start_date', '')::date, (now() at time zone 'Asia/Kolkata')::date),
            nullif(d->>'target_commissioning', '')::date, 'in_progress', nullif(trim(d->>'notes'), ''), auth.uid())
    returning * into pr;
  else
    select * into pr from projects where id = p_project for update;
    if not found then raise exception 'Project not found.'; end if;
    if pr.job_number is not null then raise exception 'This project already has job card %.', pr.job_number; end if;
    -- Fill in what the old record lacks
    update projects set
      customer_mobile      = coalesce(nullif(trim(d->>'customer_mobile'), ''), customer_mobile),
      site_address         = coalesce(nullif(trim(d->>'site_address'), ''), site_address),
      capacity_kwp         = coalesce(nullif(d->>'capacity_kwp', '')::numeric, capacity_kwp),
      project_type         = coalesce(v_type, project_type),
      region               = coalesce(case when d->>'region' in ('puducherry','tamilnadu') then d->>'region' end, region),
      subsidy_job          = coalesce((d->>'subsidy_job')::boolean, subsidy_job),
      order_value          = coalesce(nullif(d->>'order_value', '')::numeric, order_value),
      start_date           = coalesce(nullif(d->>'start_date', '')::date, start_date),
      target_commissioning = coalesce(nullif(d->>'target_commissioning', '')::date, target_commissioning)
    where id = pr.id returning * into pr;
  end if;

  v_start := coalesce(pr.start_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sub   := pr.subsidy_job;
  v_value := coalesce(pr.order_value, 0);
  if v_recv > v_value and v_value > 0 then raise exception 'Amount received (%) is more than the order value (%).', v_recv, v_value; end if;

  v_job := next_doc_number('JC');
  perform set_config('greenergy.converting', 'on', true);
  update projects set job_number = v_job, onboarded_at = now(),
         legacy_ref = coalesce(nullif(trim(d->>'legacy_ref'), ''), legacy_ref),
         admin_officer_id = coalesce(v_officer, admin_officer_id),
         status = case when status = 'planning' and coalesce(d->>'current_stage', 'order_confirmed') <> 'order_confirmed' then 'in_progress' else status end
   where id = pr.id;
  perform set_config('greenergy.converting', 'off', true);

  -- Milestones: everything before the current stage is done, the current one is in progress
  if not exists (select 1 from project_stage_history where project_id = pr.id) then
    select t.sort_order into v_cur from project_stage_template() t where t.stage_code = coalesce(nullif(d->>'current_stage', ''), 'order_confirmed');
    v_cur := coalesce(v_cur, 1);
    insert into project_stage_history (project_id, stage_code, stage_name, phase, sort_order, is_subsidy, status, planned_date, notes)
    select pr.id, t.stage_code, t.stage_name, t.phase, t.sort_order, t.is_subsidy,
           case when t.is_subsidy and not v_sub then 'skipped'
                when t.sort_order < v_cur then 'completed'
                when t.sort_order = v_cur then 'in_progress'
                else 'pending' end,
           case when t.day_offset is null or (t.is_subsidy and not v_sub) then null else v_start + t.day_offset end,
           case when t.sort_order < v_cur and not (t.is_subsidy and not v_sub) then 'Done before the CRM job card' end
      from project_stage_template() t;
  end if;

  -- Payments as an opening balance
  if v_value > 0 and not exists (select 1 from project_payments where project_id = pr.id) then
    if v_recv > 0 then
      insert into project_payments (project_id, milestone_name, amount, status, paid_date, notes, created_by)
      values (pr.id, 'Received before the CRM job card', v_recv, 'paid', (now() at time zone 'Asia/Kolkata')::date, 'Opening balance', auth.uid());
    end if;
    if v_value - v_recv > 0 then
      insert into project_payments (project_id, milestone_name, amount, status, notes, created_by)
      values (pr.id, 'Balance due', v_value - v_recv, 'pending', 'Opening balance', auth.uid());
    end if;
  end if;

  insert into audit_log (action_by, action_type, target_entity, target_id, description)
  values (auth.uid(), 'job_card_ongoing', 'projects', pr.id,
          'Job card ' || v_job || ' created for ongoing project ' || coalesce(pr.customer_name, pr.name) || coalesce(' (old ref ' || nullif(trim(d->>'legacy_ref'), '') || ')', ''));
  if v_officer is not null and v_officer <> auth.uid() then
    insert into notifications (user_id, type, title, message, link)
    values (v_officer, 'project', 'You are the administrative officer for a job card', v_job || ' · ' || coalesce(pr.customer_name, pr.name), '/staff/projects/' || pr.id);
  end if;

  return jsonb_build_object('project_id', pr.id, 'job_number', v_job);
end;$$;
revoke all on function create_job_card_for_ongoing(uuid, jsonb) from public, anon;
grant execute on function create_job_card_for_ongoing(uuid, jsonb) to authenticated;
