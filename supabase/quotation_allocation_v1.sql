-- Quotation work allocation v1 (26 Nov 2026)
-- The CEO / admin manager gives each enquiry to up to three people (any staff, or the same person):
--   1. Site visit & customer meeting  → assigned_engineer_id
--   2. Prepares the quotation         → assigned_sales_id
--   3. Follows up with the customer   → follow_up_manager_id
-- and the CEO approves (unchanged). Each person can do their own part, and only that:
--   * the site-visit person records the visit (date, notes, roof / bill details, GPS at the site);
--   * the follow-up person shares the approved quotation, logs calls, marks hot / cold, accepted or lost;
--   * prices stay with the preparer (and the CEO / admin manager).
-- Everyone gets an in-app notification when work is given to them.
-- Safe to run more than once.

alter table quotation_requests add column if not exists site_visit_at      timestamptz;   -- planned date & time
alter table quotation_requests add column if not exists site_visit_done_at timestamptz;
alter table quotation_requests add column if not exists site_visit_notes   text;
alter table quotation_requests add column if not exists site_visit_lat     double precision;
alter table quotation_requests add column if not exists site_visit_lng     double precision;

-- Any of the three people may update the quotation (what they may change is checked below)
drop policy if exists "sales_update_assigned" on quotation_requests;
create policy "sales_update_assigned" on quotation_requests for update
  using (is_staff() and auth.uid() in (assigned_sales_id, assigned_engineer_id, follow_up_manager_id))
  with check (auth.uid() in (assigned_sales_id, assigned_engineer_id, follow_up_manager_id) or is_manager() or can_manage_quotations());

create or replace function quotation_role_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  uid     uuid := auth.uid();
  visitor boolean;
  fu      boolean;
  allowed text[] := array['updated_at', 'next_follow_up_date', 'follow_up_count', 'lead_temperature'];
  move    text := old.status || '>' || new.status;
begin
  -- Server, CEO, admin manager, delegated staff and the preparer: the main rules (quotation_guard) apply
  if uid is null or is_manager() or can_manage_quotations() or old.assigned_sales_id = uid
     or coalesce(current_setting('greenergy.converting', true), '') = 'on' then
    return new;
  end if;
  visitor := old.assigned_engineer_id = uid;
  fu      := old.follow_up_manager_id = uid;
  if visitor then
    allowed := allowed || array['status', 'site_visit_at', 'site_visit_done_at', 'site_visit_notes', 'site_visit_lat', 'site_visit_lng',
      'address', 'city', 'eb_consumer_number', 'sanctioned_load_kw', 'avg_monthly_units', 'avg_monthly_bill', 'roof_type',
      'available_roof_area_sqft', 'current_phase', 'notes', 'roof_photo_url', 'eb_bill_url'];
  end if;
  if fu then
    allowed := allowed || array['status', 'sent_to_customer_at', 'accepted_by_name', 'accepted_via', 'accepted_note',
      'customer_response_at', 'lost_reason'];
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception '%', case
      when visitor and fu then 'You can update the site visit and the follow-up of this quotation. Prices are changed by the person preparing it.'
      when visitor then 'You can update the site visit of this quotation. The quotation itself is prepared by someone else.'
      else 'You can follow up this quotation. Changes to it are made by the person preparing it.' end;
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
drop trigger if exists trg_quotation_role_guard on quotation_requests;
create trigger trg_quotation_role_guard before update on quotation_requests
  for each row execute function quotation_role_guard();

-- Tell people when work is given to them, and pass the baton along the way
create or replace function quotation_assign_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_link text := '/staff/quotations/' || new.id;
  v_who  text := coalesce(new.customer_name, 'customer') || ' · ' || coalesce(new.quotation_number, '')
                 || coalesce(' · ' || new.city, '') || coalesce(' · ' || new.mobile, '');
  v_by   text := coalesce(my_name(), 'The CEO');
  me     uuid := auth.uid();
  o      quotation_requests%rowtype;
begin
  if tg_op = 'UPDATE' then o := old; end if;
  if new.assigned_engineer_id is not null and new.assigned_engineer_id is distinct from o.assigned_engineer_id and new.assigned_engineer_id is distinct from me then
    insert into notifications (user_id, type, title, message, link) values (new.assigned_engineer_id, 'quotation',
      'Site visit given to you', v_who || coalesce(' · visit ' || to_char(new.site_visit_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), '') || ' · by ' || v_by, v_link);
  end if;
  if new.assigned_sales_id is not null and new.assigned_sales_id is distinct from o.assigned_sales_id and new.assigned_sales_id is distinct from me then
    insert into notifications (user_id, type, title, message, link) values (new.assigned_sales_id, 'quotation',
      'Quotation to prepare', v_who || ' · by ' || v_by, v_link);
  end if;
  if new.follow_up_manager_id is not null and new.follow_up_manager_id is distinct from o.follow_up_manager_id and new.follow_up_manager_id is distinct from me then
    insert into notifications (user_id, type, title, message, link) values (new.follow_up_manager_id, 'quotation',
      'Customer follow-up given to you', v_who || ' · by ' || v_by, v_link);
  end if;
  if tg_op = 'UPDATE' then
    -- Visit date changed
    if new.site_visit_at is distinct from old.site_visit_at and new.site_visit_at is not null
       and new.assigned_engineer_id is not null and new.assigned_engineer_id is not distinct from old.assigned_engineer_id
       and new.assigned_engineer_id is distinct from me then
      insert into notifications (user_id, type, title, message, link) values (new.assigned_engineer_id, 'quotation',
        'Site visit date set', v_who || ' · ' || to_char(new.site_visit_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), v_link);
    end if;
    -- Visit done → the preparer can start
    if new.site_visit_done_at is not null and old.site_visit_done_at is null
       and new.assigned_sales_id is not null and new.assigned_sales_id is distinct from me then
      insert into notifications (user_id, type, title, message, link) values (new.assigned_sales_id, 'quotation',
        'Site visit done — prepare the quotation', v_who, v_link);
    end if;
    -- Approved → the follow-up person can share it
    if new.status = 'approved' and old.status <> 'approved' and new.follow_up_manager_id is not null
       and new.follow_up_manager_id is distinct from new.assigned_sales_id then
      insert into notifications (user_id, type, title, message, link) values (new.follow_up_manager_id, 'quotation',
        'Quotation approved — ready to share with the customer', v_who, v_link);
    end if;
  end if;
  return new;
end;$$;
drop trigger if exists trg_quotation_assign_notify on quotation_requests;
create trigger trg_quotation_assign_notify after insert or update on quotation_requests
  for each row execute function quotation_assign_notify();
