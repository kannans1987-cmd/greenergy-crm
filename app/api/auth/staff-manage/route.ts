import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// CEO (and Super Admin): change a staff member's role, activate / deactivate them, or delete them.
// A Super Admin cannot act on the CEO or another Super Admin, and cannot give CEO / Super Admin access
// (also enforced in the database, super_admin_v1.sql). Their actions reach the CEO through the audit log.
// Deactivating also blocks the login itself (not only the data), and Activate lifts that block.
// Delete removes the login completely when the person has no records; if quotations, tasks,
// attendance etc. carry their name, the login is blocked for good and the records are kept.

const ROLES = ['employee', 'task_manager', 'admin', 'super_admin'] as const
// Picked in the Role column; stored as role 'employee' + allocation_level (allocation_levels_v1.sql)
const LEVEL_ROLES: Record<string, { level: 'senior' | 'junior'; title: string }> = {
  sr_admin: { level: 'senior', title: 'Sr Admin Manager' },
  jr_admin: { level: 'junior', title: 'Jr Admin Manager' },
}
const BLOCK = '876000h' // ~100 years
type Admin = ReturnType<typeof createAdminClient>

async function block(admin: Admin, id: string, on: boolean) {
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: on ? BLOCK : 'none' })
  if (error && !/not found/i.test(error.message)) throw new Error(error.message)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: me } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only the CEO can do this.' }, { status: 403 })
  const meSuper = me.super_admin === true

  const { user_id, action, role, status, value } = await req.json().catch(() => ({}))
  if (typeof user_id !== 'string' || !user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  if (user_id === user.id) return NextResponse.json({ error: meSuper ? 'Only the CEO can change your account.' : 'You cannot change or delete your own CEO account here.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: target } = await admin.from('profiles').select('*').eq('id', user_id).single()
  if (!target) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })
  if (meSuper && target.role === 'admin') {
    return NextResponse.json({ error: `Only the CEO can change ${target.super_admin ? 'a Super Admin' : 'the CEO'}.` }, { status: 403 })
  }
  if (meSuper && action === 'role' && (role === 'admin' || role === 'super_admin')) {
    return NextResponse.json({ error: 'Only the CEO can give CEO or Super Admin access.' }, { status: 403 })
  }

  const audit = (action_type: string, description: string, metadata?: Record<string, unknown>) =>
    admin.from('audit_log').insert({ action_by: user.id, action_type, target_entity: 'profiles', target_id: user_id, description, metadata })

  try {
    if (action === 'role') {
      const lvl = LEVEL_ROLES[role as string]
      if (!lvl && !ROLES.includes(role)) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
      const before = target.role === 'employee' && target.allocation_level ? (target.allocation_level === 'senior' ? 'Sr Admin Manager' : 'Jr Admin Manager')
        : target.role === 'admin' && target.super_admin ? 'Super Admin' : target.role
      // A Sr / Jr title only belongs with that role: clear it when the role changes to something else
      const oldTitle = ['Sr Admin Manager', 'Jr Admin Manager'].includes(target.designation ?? '')
      // Super Admin is stored as role 'admin' + super_admin (super_admin_v1.sql)
      if (role === 'super_admin' && !('super_admin' in target)) return NextResponse.json({ error: 'The database needs the Super Admin update first (supabase/super_admin_v1.sql).' }, { status: 400 })
      const sa = 'super_admin' in target ? { super_admin: role === 'super_admin' } : {}
      const updates = lvl
        ? { role: 'employee', allocation_level: lvl.level, designation: lvl.title, ...sa }
        : { role: role === 'super_admin' ? 'admin' : role, ...sa, ...('allocation_level' in target ? { allocation_level: null } : {}), ...(oldTitle ? { designation: role === 'task_manager' ? 'Admin Manager' : null } : {}) }
      const { error } = await admin.from('profiles').update(updates).eq('id', user_id)
      if (error) throw new Error(/allocation_level/.test(error.message) ? 'The database needs the allocation update first (supabase/allocation_levels_v1.sql).' : error.message)
      await audit('staff_role_changed', `Role of ${target.full_name} changed from ${before} to ${lvl ? lvl.title : role === 'super_admin' ? 'Super Admin' : role}.`)
      return NextResponse.json({ ok: true, role: updates.role, allocation_level: lvl?.level ?? null, super_admin: role === 'super_admin' })
    }

    if (action === 'quotation_access') {
      const on = value === true
      const { error } = await admin.from('profiles').update({ quotation_access: on }).eq('id', user_id)
      if (error) throw new Error(/quotation_access/.test(error.message)
        ? 'The database needs the quotation-access update first (supabase/quotation_access_v1.sql).' : error.message)
      await audit('staff_quotation_access', `${target.full_name} ${on ? 'can now' : 'can no longer'} edit and delete all quotations.`)
      return NextResponse.json({ ok: true, quotation_access: on })
    }

    if (action === 'allocation_level') {
      const lv = value === 'senior' || value === 'junior' ? value : null
      if (lv && target.role !== 'employee') return NextResponse.json({ error: 'The CEO and admin managers already allocate work to anyone.' }, { status: 400 })
      const title = lv === 'senior' ? 'Sr Admin Manager' : lv === 'junior' ? 'Jr Admin Manager' : null
      // The level, and the designation people see, together
      const { error } = await admin.from('profiles').update({ allocation_level: lv, ...(title ? { designation: title } : {}) }).eq('id', user_id)
      if (error) throw new Error(/allocation_level/.test(error.message)
        ? 'The database needs the allocation update first (supabase/allocation_levels_v1.sql).' : error.message)
      await audit('staff_allocation_level', `${target.full_name} ${title ? 'is now ' + title + (lv === 'senior' ? ' (allocates work to anyone)' : ' (allocates work to anyone except a Sr Admin Manager)') : 'no longer allocates work'}.`)
      return NextResponse.json({ ok: true, allocation_level: lv })
    }

    if (action === 'quotation_view') {
      const on = value === true
      const { error } = await admin.from('profiles').update({ quotation_view: on }).eq('id', user_id)
      if (error) throw new Error(/quotation_view/.test(error.message)
        ? 'The database needs the quotation update first (supabase/quotation_view_v1.sql).' : error.message)
      await audit('staff_quotation_view', `${target.full_name} ${on ? 'can now see all quotations and log enquiries (changes need CEO approval)' : 'now sees only own quotations'}.`)
      return NextResponse.json({ ok: true, quotation_view: on })
    }

    if (action === 'status') {
      if (status !== 'active' && status !== 'inactive') return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
      const { error } = await admin.from('profiles').update({ status }).eq('id', user_id)
      if (error) throw new Error(error.message)
      await block(admin, user_id, status === 'inactive')
      await audit('staff_status_changed', `${target.full_name} is now ${status}.`)
      return NextResponse.json({ ok: true, status })
    }

    if (action === 'delete') {
      // Fails as a whole (nothing removed) if any record still points at this person
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (!error) {
        await admin.from('employee_registrations').delete().ilike('email', target.email)
        await audit('staff_deleted', `${target.full_name} (${target.email}) was deleted.`, { email: target.email, role: target.role })
        return NextResponse.json({ ok: true, deleted: true })
      }
      console.warn('[staff-manage] full delete not possible, blocking instead:', error.message)
      await admin.from('profiles').update({ status: 'inactive', price_access: null }).eq('id', user_id)
      await block(admin, user_id, true)
      await audit('staff_removed', `${target.full_name} (${target.email}) was removed: login blocked, records kept.`)
      return NextResponse.json({ ok: true, deleted: false })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
