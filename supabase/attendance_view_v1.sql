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
