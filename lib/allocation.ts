// Work allocation levels (supabase/allocation_levels_v1.sql). The database enforces the same rules.
//   senior — "Sr Admin Manager": allocates work to anyone in the organisation
//   junior — "Jr Admin Manager": allocates work to anyone except a Sr Admin Manager
export type AllocationLevel = 'senior' | 'junior' | null | undefined
export const LEVEL_TITLE: Record<'senior' | 'junior', string> = { senior: 'Sr Admin Manager', junior: 'Jr Admin Manager' }

interface Person { id: string; role?: string | null; allocation_level?: AllocationLevel; status?: string | null }

const isMgr = (role?: string | null) => role === 'admin' || role === 'task_manager'

export const canAllocate = (role?: string | null, level?: AllocationLevel) => isMgr(role) || level === 'senior' || level === 'junior'

// The people this person may give work to
export function allocatable<T extends Person>(people: T[], role?: string | null, level?: AllocationLevel): T[] {
  if (!canAllocate(role, level)) return []
  return people.filter(p => (p.status ?? 'active') === 'active'
    && (isMgr(role) || level === 'senior' || !(p.allocation_level === 'senior' && p.role === 'employee')))
}

// "Sr Admin Manager", "Admin manager", "Staff" … for lists
export function personTitle(p: { role?: string | null; allocation_level?: AllocationLevel }, roleLabels: Record<string, string>) {
  if (p.role === 'employee' && (p.allocation_level === 'senior' || p.allocation_level === 'junior')) return LEVEL_TITLE[p.allocation_level]
  return roleLabels[p.role ?? ''] ?? p.role ?? ''
}

export const ALLOCATION_RULE = {
  senior: 'Can allocate work to anyone in the organisation.',
  junior: 'Can allocate work to anyone except a Sr Admin Manager.',
}
