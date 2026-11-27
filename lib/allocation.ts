// Work allocation levels (supabase/allocation_levels_v1.sql, project_manager_v1.sql). The database enforces the same rules.
//   senior  — "Sr Admin Manager": allocates work to anyone in the organisation
//   junior  — "Jr Admin Manager": allocates work to anyone except a Sr Admin Manager
//   project — "Project Manager": allocates work to Solar Technicians, Helpers and Jr Admin Managers (never a Sr)
export type AllocationLevel = 'senior' | 'junior' | 'project' | null | undefined
export const LEVEL_TITLE: Record<'senior' | 'junior' | 'project', string> = {
  senior: 'Sr Admin Manager', junior: 'Jr Admin Manager', project: 'Project Manager',
}
export const LEVELS = ['senior', 'junior', 'project'] as const
export const isLevel = (v: unknown): v is 'senior' | 'junior' | 'project' => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

interface Person { id: string; role?: string | null; allocation_level?: AllocationLevel; status?: string | null; designation?: string | null }

const isMgr = (role?: string | null) => role === 'admin' || role === 'task_manager'
// Site crew, by designation (same rule as is_field_crew in the database)
export const isFieldCrew = (designation?: string | null) => /technician|helper/i.test(designation ?? '')

export const canAllocate = (role?: string | null, level?: AllocationLevel) => isMgr(role) || isLevel(level)

// The people this person may give work to. `selfId` lets a Project Manager keep work for themselves.
export function allocatable<T extends Person>(people: T[], role?: string | null, level?: AllocationLevel, selfId?: string | null): T[] {
  if (!canAllocate(role, level)) return []
  return people.filter(p => {
    if ((p.status ?? 'active') !== 'active') return false
    if (isMgr(role) || level === 'senior') return true
    const pSenior = p.role === 'employee' && p.allocation_level === 'senior'
    if (level === 'project') {
      return p.id === selfId || (p.role === 'employee' && !pSenior && (p.allocation_level === 'junior' || isFieldCrew(p.designation)))
    }
    return !pSenior
  })
}

// "Sr Admin Manager", "Project Manager", "Admin manager", "Staff" … for lists
export function personTitle(p: { role?: string | null; allocation_level?: AllocationLevel; designation?: string | null }, roleLabels: Record<string, string>) {
  if (p.role === 'employee' && isLevel(p.allocation_level)) return LEVEL_TITLE[p.allocation_level]
  if (p.role === 'employee' && p.designation) return p.designation
  return roleLabels[p.role ?? ''] ?? p.role ?? ''
}

export const ALLOCATION_RULE = {
  senior: 'Can allocate work to anyone in the organisation.',
  junior: 'Can allocate work to anyone except a Sr Admin Manager.',
  project: 'Can allocate work to Solar Technicians, Helpers and Jr Admin Managers (not a Sr Admin Manager).',
}
