-- ═══════════════════════════════════════════════════════════════
-- attendance_view_v1.sql
-- Sr / Jr Admin Manager can SEE everyone's clock-in and clock-out (read only).
-- Needs allocation_levels_v1.sql (my_allocation_level).
--
-- Nothing here lets them change attendance:
--   · staff have no insert / update / delete policy on attendance (attendance_devices_v1.sql);
--     clock-in / out is only through attendance_clock_in / attendance_clock_out, for oneself
--   · "Admin override" (correcting a time) stays CEO only
--   · attendance type (office / field) stays CEO only (profile_attendance_mode_guard)
--   · attendance phones stay CEO only (decide_attendance_device)
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

create or replace function can_view_team_attendance()
returns boolean language sql stable security definer set search_path = public as $$
  select is_manager() or my_allocation_level() is not null;
$$;
revoke all on function can_view_team_attendance() from public, anon;
grant execute on function can_view_team_attendance() to authenticated;

-- Read only: a SELECT policy, added next to "View own attendance" (own rows or managers)
drop policy if exists "Allocators view attendance" on attendance;
create policy "Allocators view attendance" on attendance for select using (my_allocation_level() is not null);

-- Who is on leave on a day, for the Team attendance table (so leave is not shown as "not clocked in").
-- Only the person, the leave type and its status: never the reason or the medical certificate.
create or replace function team_leave_on(p_date date)
returns table (employee_id uuid, type text, status text)
language sql stable security definer set search_path = public as $fn$
  select l.employee_id, l.type, l.status
    from leaves l
   where can_view_team_attendance()
     and p_date between l.from_date and l.to_date
     and l.status in ('pending', 'sr_approved', 'approved');
$fn$;
revoke all on function team_leave_on(date) from public, anon;
grant execute on function team_leave_on(date) to authenticated;
