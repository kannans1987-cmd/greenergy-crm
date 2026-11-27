-- Leave policy and two-level approval (27 Nov 2026)
-- Fixes: the Leave page wrote columns the table does not have (leave_type, start_date …), so applications failed.
--
-- POLICY (numbers live in business_settings 'leave', editable by the CEO):
--  * Days are counted without the weekly off (Sunday by default).
--  * Casual leave applied at least 5 days before it starts: 1 day paid; if the approver accepts the reason
--    as genuine, up to 2 days paid. From the 3rd day onwards: loss of pay (LOP).
--  * Casual leave applied with less than 5 days' notice ("abrupt"): every day is LOP.
--  * Absence without intimation (recorded by the Sr Admin Manager / CEO): every day is LOP.
--  * Sick leave: paid only with a medical certificate attached; without one, LOP. It can be applied up to
--    7 days after it started (people fall ill without notice).
--  * More than 10 days without a proper explanation:
--      - a leave application over 10 days can only be approved once the CEO accepts the explanation
--        (a medical certificate for sick leave counts);
--      - absences without intimation adding up to more than 10 days (back to back) are flagged for the
--        termination process: the CEO and Sr Admin Manager are told, and the CEO either accepts an
--        explanation or records that a show-cause notice was issued. The CRM never terminates anyone by
--        itself: due process (notice, reply, decision) stays with you.
-- APPROVAL: 1st level Sr Admin Manager (or admin manager) → 2nd level CEO. Nobody decides their own leave.
--   A Sr Admin Manager's own leave, or when no Sr Admin Manager is active, goes straight to the CEO.
-- Needs allocation_levels_v1.sql and growth_v1.sql. Safe to run more than once.

insert into business_settings (key, data) values ('leave',
  '{"notice_days": 5, "casual_paid_days": 1, "casual_paid_days_genuine": 2, "termination_days": 10, "sick_backdate_days": 7, "week_off": [0]}')
on conflict (key) do nothing;

-- ═══ Table ═══
alter table leaves drop constraint if exists leaves_type_check;
alter table leaves add constraint leaves_type_check check (type in ('casual', 'sick', 'earned', 'absence'));
alter table leaves drop constraint if exists leaves_status_check;
alter table leaves add constraint leaves_status_check check (status in ('pending', 'sr_approved', 'approved', 'rejected', 'cancelled'));
alter table leaves add column if not exists days            integer;
alter table leaves add column if not exists notice_days     integer;
alter table leaves add column if not exists paid_days       numeric not null default 0;
alter table leaves add column if not exists lop_days        numeric not null default 0;
alter table leaves add column if not exists abrupt          boolean not null default false;
alter table leaves add column if not exists genuine         boolean not null default false;
alter table leaves add column if not exists certificate_path text;
alter table leaves add column if not exists sr_by           uuid references profiles(id);
alter table leaves add column if not exists sr_at           timestamptz;
alter table leaves add column if not exists sr_note         text;
alter table leaves add column if not exists ceo_note        text;
alter table leaves add column if not exists recorded_by     uuid references profiles(id);
alter table leaves add column if not exists termination_review boolean not null default false;
alter table leaves add column if not exists explanation_accepted boolean not null default false;
alter table leaves add column if not exists show_cause_at   timestamptz;
alter table leaves add column if not exists updated_at      timestamptz default now();
create index if not exists leaves_employee_dates on leaves (employee_id, from_date);

-- ═══ Who reviews ═══
-- 1st level: Sr Admin Manager or admin manager. 2nd level: CEO.
create or replace function leave_first_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active'
                 and (role = 'task_manager' or (role = 'employee' and allocation_level = 'senior')));
$$;
create or replace function leave_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or leave_first_reviewer();
$$;
-- Does this leave skip the 1st level? (the applicant is a 1st-level reviewer, or there is none)
create or replace function leave_goes_to_ceo(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_employee and (role = 'task_manager' or allocation_level = 'senior'))
      or not exists (select 1 from profiles where status = 'active' and id <> p_employee
                     and (role = 'task_manager' or (role = 'employee' and allocation_level = 'senior')));
$$;

-- Weekly off days (0 = Sunday … 6 = Saturday); an empty list means no weekly off
create or replace function leave_week_off()
returns int[] language sql stable set search_path = public as $$
  select case when setting('leave') ? 'week_off'
    then coalesce((select array_agg(x::int) from jsonb_array_elements_text(setting('leave')->'week_off') x), '{}'::int[])
    else array[0] end;
$$;

-- Working days of a leave (weekly off excluded)
create or replace function leave_working_days(p_from date, p_to date)
returns integer language sql stable set search_path = public as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d
   where extract(dow from d)::int <> all (leave_week_off());
$$;

-- ═══ The policy ═══
create or replace function leave_apply_policy(l leaves)
returns leaves language plpgsql stable security definer set search_path = public as $$
declare s jsonb := setting('leave');
        applied date := coalesce((l.created_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date);
        run int;
begin
  l.days := leave_working_days(l.from_date, l.to_date);
  l.notice_days := l.from_date - applied;
  l.abrupt := l.type in ('casual', 'earned') and l.notice_days < coalesce((s->>'notice_days')::int, 5);
  l.paid_days := case
    when l.type = 'absence' then 0
    when l.type = 'sick' then case when l.certificate_path is not null then l.days else 0 end
    when l.abrupt then 0
    else least(l.days, case when l.genuine then coalesce((s->>'casual_paid_days_genuine')::int, 2)
                            else coalesce((s->>'casual_paid_days')::int, 1) end)
  end;
  l.lop_days := greatest(0, l.days - l.paid_days);

  -- Long leave without a proper explanation → termination review. A medical certificate or the CEO
  -- accepting the explanation counts as proper. Back-to-back absences count together.
  if l.type = 'absence' then
    select coalesce(sum(leave_working_days(a.from_date, a.to_date)), 0) into run from leaves a
     where a.employee_id = l.employee_id and a.type = 'absence' and a.id is distinct from l.id and a.status = 'approved'
       and a.from_date <= l.to_date + 7 and a.to_date >= l.from_date - 7;
    run := run + l.days;
  else
    run := l.days;
  end if;
  l.termination_review := l.type = 'absence' and l.status = 'approved'
    and run > coalesce((s->>'termination_days')::int, 10)
    and not l.explanation_accepted;
  return l;
end;$$;

create or replace function leave_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        s jsonb := setting('leave');
        today date := (now() at time zone 'Asia/Kolkata')::date;
        ceo boolean := is_admin();
        first boolean := leave_first_reviewer();
        diff text[];
        p leaves;
begin
  if tg_op = 'INSERT' then
    if uid is not null then
      if new.type = 'absence' then
        if not (ceo or first) then raise exception 'Only the Sr Admin Manager or the CEO records an absence.'; end if;
        if new.employee_id = uid then raise exception 'You cannot record your own absence.'; end if;
        if new.to_date >= today then raise exception 'An absence is recorded after the day has passed.'; end if;
        new.status := 'approved'; new.approved_by := uid; new.approved_at := now(); new.recorded_by := uid;
      else
        new.employee_id := uid;
        new.status := 'pending'; new.approved_by := null; new.approved_at := null;
        if new.type not in ('casual', 'sick') then raise exception 'Apply for casual or sick leave.'; end if;
        if new.type = 'casual' and new.from_date < today then
          raise exception 'Casual leave cannot start in the past. If you were away, tell the Sr Admin Manager (it is recorded as an absence).';
        end if;
        if new.type = 'sick' and new.from_date < today - coalesce((s->>'sick_backdate_days')::int, 7) then
          raise exception 'Sick leave can be applied up to % days after it started.', coalesce((s->>'sick_backdate_days')::int, 7);
        end if;
      end if;
      new.genuine := false; new.explanation_accepted := false; new.show_cause_at := null;
      new.sr_by := null; new.sr_at := null; new.sr_note := null; new.ceo_note := null;
    end if;
    new.created_at := coalesce(new.created_at, now());
    if new.from_date is null or new.to_date is null or new.to_date < new.from_date then raise exception 'Choose the first and last day of the leave.'; end if;
    if new.to_date > new.from_date + 90 then raise exception 'One application can cover at most 90 days.'; end if;
    if coalesce(length(btrim(new.reason)), 0) < 5 then raise exception 'Write the reason for the leave.'; end if;
    if exists (select 1 from leaves o where o.employee_id = new.employee_id and o.status not in ('rejected', 'cancelled')
               and o.from_date <= new.to_date and o.to_date >= new.from_date) then
      raise exception 'There is already a leave or absence on these dates.';
    end if;
    p := leave_apply_policy(new);
    if p.days = 0 then raise exception 'These dates are all weekly offs.'; end if;
    return p;
  end if;

  -- ── UPDATE ──
  if uid is null then return leave_apply_policy(new); end if;
  new.employee_id := old.employee_id; new.type := old.type; new.created_at := old.created_at; new.recorded_by := old.recorded_by;
  diff := array(select k from jsonb_object_keys(to_jsonb(new)) k where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k);
  diff := array_remove(array_remove(diff, 'updated_at'), 'certificate_path');

  if old.employee_id = uid then
    -- The applicant: attach the medical certificate, or withdraw before the final decision
    if new.certificate_path is distinct from old.certificate_path then
      if old.type <> 'sick' then raise exception 'A certificate is only for sick leave.'; end if;
      if new.certificate_path is not null and split_part(new.certificate_path, '/', 1) <> uid::text then raise exception 'Upload the certificate from your own account.'; end if;
      if old.status in ('rejected', 'cancelled') then raise exception 'This leave is closed.'; end if;
      if old.status = 'approved' and old.approved_at < now() - interval '7 days' then raise exception 'Certificates are accepted up to 7 days after approval.'; end if;
    end if;
    if diff <> '{}' and not (diff <@ array['status'] and new.status = 'cancelled' and old.status in ('pending', 'sr_approved')) then
      raise exception 'You can attach a certificate or withdraw the leave. It is decided by the Sr Admin Manager and the CEO.';
    end if;
  elsif ceo then
    if new.status is distinct from old.status then
      if new.status = 'approved' and old.status = 'pending' and not leave_goes_to_ceo(old.employee_id) then
        raise exception 'The Sr Admin Manager approves first; then it comes to you.';
      end if;
      if not ((old.status in ('pending', 'sr_approved') and new.status in ('approved', 'rejected'))
              or (old.status = 'approved' and new.status = 'cancelled')) then
        raise exception 'A leave cannot move from % to %.', old.status, new.status;
      end if;
      if new.status = 'rejected' and coalesce(length(btrim(new.ceo_note)), 0) < 3 then raise exception 'Say why the leave is rejected.'; end if;
      if new.status = 'approved' then
        -- More than 10 days needs a proper explanation (a medical certificate counts)
        if leave_working_days(new.from_date, new.to_date) > coalesce((s->>'termination_days')::int, 10)
           and not new.explanation_accepted and not (new.type = 'sick' and new.certificate_path is not null) then
          raise exception 'This leave is longer than % days. Accept the explanation (with a note) before approving, or reject it.', coalesce((s->>'termination_days')::int, 10);
        end if;
        new.approved_by := uid; new.approved_at := now();
      end if;
    end if;
    if new.explanation_accepted and not old.explanation_accepted and coalesce(length(btrim(new.ceo_note)), 0) < 3 then
      raise exception 'Note the explanation you accepted.';
    end if;
    if new.show_cause_at is distinct from old.show_cause_at and new.show_cause_at is not null then new.show_cause_at := now(); end if;
  elsif first then
    -- 1st level: recommend (→ CEO) or reject, and judge whether the reason is genuine
    if not (diff <@ array['status', 'sr_note', 'genuine', 'sr_by', 'sr_at']) then
      raise exception 'You approve at the first level; the CEO gives the final approval.';
    end if;
    if old.status <> 'pending' then raise exception 'This leave is no longer waiting for the first-level approval.'; end if;
    if new.status not in ('sr_approved', 'rejected') then raise exception 'Approve it for the CEO, or reject it.'; end if;
    if new.status = 'rejected' and coalesce(length(btrim(new.sr_note)), 0) < 3 then raise exception 'Say why the leave is rejected.'; end if;
    new.sr_by := uid; new.sr_at := now();
  else
    raise exception 'Leave is decided by the Sr Admin Manager and the CEO.';
  end if;
  new.updated_at := now();
  return leave_apply_policy(new);
end;$$;
drop trigger if exists trg_leave_guard on leaves;
create trigger trg_leave_guard before insert or update on leaves for each row execute function leave_guard();

-- ═══ Notifications ═══
create or replace function leave_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text := (select full_name from profiles where id = new.employee_id);
        what text := initcap(new.type) || ' leave ' || to_char(new.from_date, 'DD Mon') ||
                     case when new.to_date <> new.from_date then ' – ' || to_char(new.to_date, 'DD Mon') else '' end ||
                     ' (' || new.days || ' day' || case when new.days = 1 then '' else 's' end || ': ' || new.paid_days || ' paid, ' || new.lop_days || ' LOP)';
begin
  if tg_op = 'INSERT' and new.type = 'absence' then
    insert into notifications (user_id, type, title, message, link)
      values (new.employee_id, 'leave', 'Recorded as absent without intimation',
              to_char(new.from_date, 'DD Mon') || case when new.to_date <> new.from_date then ' – ' || to_char(new.to_date, 'DD Mon') else '' end
                || ': ' || new.lop_days || ' day(s) loss of pay. Talk to the Sr Admin Manager if this is wrong.', '/staff/leave');
  elsif tg_op = 'INSERT' then
    insert into notifications (user_id, type, title, message, link)
      select p.id, 'leave', case when leave_goes_to_ceo(new.employee_id) then 'Leave for your approval' else 'Leave to approve (1st level)' end,
             coalesce(who, 'Staff') || ': ' || what, '/staff/leave'
        from profiles p where p.status = 'active' and p.id <> new.employee_id
         and (case when leave_goes_to_ceo(new.employee_id) then p.role = 'admin'
                   else p.role = 'task_manager' or (p.role = 'employee' and p.allocation_level = 'senior') end);
  elsif new.status is distinct from old.status then
    if new.status = 'sr_approved' then
      insert into notifications (user_id, type, title, message, link)
        select id, 'leave', 'Leave for your final approval', coalesce(who, 'Staff') || ': ' || what ||
               coalesce(' · Sr Admin Manager: ' || new.sr_note, ''), '/staff/leave'
          from profiles where role = 'admin' and status = 'active';
    elsif new.status in ('approved', 'rejected') then
      insert into notifications (user_id, type, title, message, link)
        values (new.employee_id, 'leave', 'Leave ' || new.status, what || coalesce(' · ' || nullif(coalesce(new.ceo_note, new.sr_note), ''), ''), '/staff/leave');
    end if;
  end if;
  if new.termination_review and (tg_op = 'INSERT' or not old.termination_review) then
    insert into notifications (user_id, type, title, message, link)
      select id, 'leave', 'Termination review: long leave without explanation',
             coalesce(who, 'Staff') || ': ' || what || '. Ask for a written explanation; if none is acceptable, issue a show-cause notice.', '/staff/leave'
        from profiles where status = 'active' and (role = 'admin' or (role = 'employee' and allocation_level = 'senior'));
    insert into audit_log (action_by, action_type, target_entity, target_id, description)
      values (auth.uid(), 'leave_termination_review', 'leaves', new.id, coalesce(who, 'Staff') || ': ' || what);
  end if;
  return new;
end;$$;
drop trigger if exists trg_leave_notify on leaves;
create trigger trg_leave_notify after insert or update on leaves for each row execute function leave_notify();

-- ═══ Access ═══
drop policy if exists "Own leaves" on leaves;
drop policy if exists "Apply leave" on leaves;
drop policy if exists "Manager approve" on leaves;
drop policy if exists "leaves_read" on leaves;
create policy "leaves_read" on leaves for select using (employee_id = auth.uid() or leave_reviewer() or is_manager());
drop policy if exists "leaves_apply" on leaves;
create policy "leaves_apply" on leaves for insert with check (is_staff() and (employee_id = auth.uid() or leave_reviewer()));
drop policy if exists "leaves_update" on leaves;
create policy "leaves_update" on leaves for update using (employee_id = auth.uid() or leave_reviewer());

-- Medical certificates: private (health records). Staff upload into their own folder; the applicant and the
-- reviewers can open them (through short-lived links).
insert into storage.buckets (id, name, public) values ('leave-documents', 'leave-documents', false) on conflict do nothing;
drop policy if exists "leave docs upload" on storage.objects;
create policy "leave docs upload" on storage.objects for insert
  with check (bucket_id = 'leave-documents' and auth.role() = 'authenticated' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists "leave docs read" on storage.objects;
create policy "leave docs read" on storage.objects for select
  using (bucket_id = 'leave-documents' and (split_part(name, '/', 1) = auth.uid()::text or leave_reviewer()));

-- ═══ Reports for reviewers ═══
-- Paid / LOP days per person in a month (a leave's paid days are its first working days; LOP the rest)
create or replace function leave_month_summary(p_month date)
returns table (employee_id uuid, full_name text, casual_paid int, sick_paid int, lop int, absences int, pending int)
language sql stable security definer set search_path = public as $$
  with d as (
    select l.employee_id, l.type, l.status, l.paid_days, g::date as day,
           row_number() over (partition by l.id order by g) as n
      from leaves l, generate_series(l.from_date, l.to_date, interval '1 day') g
     where l.status not in ('rejected', 'cancelled')
       and extract(dow from g)::int <> all (leave_week_off())
  )
  select p.id, p.full_name,
         count(*) filter (where d.status = 'approved' and d.type in ('casual', 'earned') and d.n <= d.paid_days)::int,
         count(*) filter (where d.status = 'approved' and d.type = 'sick' and d.n <= d.paid_days)::int,
         count(*) filter (where d.status = 'approved' and d.n > d.paid_days)::int,
         count(*) filter (where d.type = 'absence')::int,
         count(*) filter (where d.status in ('pending', 'sr_approved'))::int
    from d join profiles p on p.id = d.employee_id
   where leave_reviewer() and date_trunc('month', d.day) = date_trunc('month', p_month)
   group by p.id, p.full_name order by p.full_name;
$$;
revoke all on function leave_month_summary(date) from public, anon;
grant execute on function leave_month_summary(date) to authenticated;

-- Working days with no clock-in and no leave (last N days): possible absences without intimation
create or replace function unexplained_absences(p_days int default 14)
returns table (employee_id uuid, full_name text, day date)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, g::date
    from profiles p,
         generate_series((now() at time zone 'Asia/Kolkata')::date - least(greatest(p_days, 1), 60),
                         (now() at time zone 'Asia/Kolkata')::date - 1, interval '1 day') g
   where leave_reviewer()
     and p.status = 'active' and p.role <> 'admin'
     and g::date >= (p.created_at at time zone 'Asia/Kolkata')::date
     and extract(dow from g)::int <> all (leave_week_off())
     and not exists (select 1 from attendance a where a.employee_id = p.id and a.date = g::date)
     and not exists (select 1 from leaves l where l.employee_id = p.id and l.status not in ('rejected', 'cancelled')
                     and g::date between l.from_date and l.to_date)
   order by p.full_name, g;
$$;
revoke all on function unexplained_absences(int) from public, anon;
grant execute on function unexplained_absences(int) to authenticated;
