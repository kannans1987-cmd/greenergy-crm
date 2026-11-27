-- ═══════════════════════════════════════════════════════════════
-- project_manager_v1.sql
-- Project Manager: a third work-allocation level (profiles.allocation_level = 'project'), set by the CEO
-- in User Management → Role → Project Manager.
--   · Gives work (tasks, quotation people / site visit, service jobs) to:
--       - Solar Technicians and Helpers (designation contains "technician" or "helper"),
--       - Jr Admin Managers,
--       - themselves.
--   · Cannot give work to a Sr Admin Manager, nor to anyone else (sales staff, admin managers, CEO).
--   · Like the Sr / Jr Admin Manager: sees all quotations (no supplier cost / margin), sees team
--     attendance (view only); does not approve leave.
-- Needs allocation_levels_v1.sql and attendance_view_v1.sql. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

alter table profiles drop constraint if exists profiles_allocation_level_check;
alter table profiles add constraint profiles_allocation_level_check
  check (allocation_level is null or allocation_level in ('senior', 'junior', 'project'));

-- Site crew, by designation: "Solar Technician", "Technician", "Helper", "Site Helper" …
create or replace function is_field_crew(p_designation text)
returns boolean language sql immutable as $$
  select coalesce(p_designation, '') ~* '(technician|helper)';
$$;

-- May this person give work to p_target?
--   CEO / admin manager / Sr: anyone active · Jr: anyone active except a Sr
--   Project Manager: technicians, helpers, Jr Admin Managers and themselves (never a Sr)
-- Empty = taking the work away, always allowed to allocators.
create or replace function can_allocate_to(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not can_allocate() then false
    when p_target is null then true
    when not exists (select 1 from profiles where id = p_target and status = 'active') then false
    when is_manager() then true
    when my_allocation_level() = 'senior' then true
    when my_allocation_level() = 'project' then
      p_target = auth.uid()
      or exists (select 1 from profiles where id = p_target and role = 'employee'
                   and coalesce(allocation_level, '') <> 'senior'
                   and (allocation_level = 'junior' or is_field_crew(designation)))
    else not exists (select 1 from profiles where id = p_target and allocation_level = 'senior' and role = 'employee')
  end;
$$;

create or replace function allocation_refusal()
returns text language sql stable security definer set search_path = public as $$
  select case my_allocation_level()
    when 'junior' then 'A Jr Admin Manager can allocate work to anyone except a Sr Admin Manager. Ask the Sr Admin Manager or the CEO.'
    when 'project' then 'A Project Manager can allocate work only to Solar Technicians, Helpers and Jr Admin Managers. Ask the Sr Admin Manager or the CEO.'
    else 'You can only allocate work to active staff.' end;
$$;
