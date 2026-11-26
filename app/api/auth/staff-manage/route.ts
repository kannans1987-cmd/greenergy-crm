import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// CEO only: change a staff member's role, activate / deactivate them, or delete them.
// Deactivating also blocks the login itself (not only the data), and Activate lifts that block.
// Delete removes the login completely when the person has no records; if quotations, tasks,
// attendance etc. carry their name, the login is blocked for good and the records are kept.

const ROLES = ['employee', 'task_manager', 'admin'] as const
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
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only the CEO can do this.' }, { status: 403 })

  const { user_id, action, role, status, value } = await req.json().catch(() => ({}))
  if (typeof user_id !== 'string' || !user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  if (user_id === user.id) return NextResponse.json({ error: 'You cannot change or delete your own CEO account here.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: target } = await admin.from('profiles').select('id,email,full_name,role,status').eq('id', user_id).single()
  if (!target) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })

  const audit = (action_type: string, description: string, metadata?: Record<string, unknown>) =>
    admin.from('audit_log').insert({ action_by: user.id, action_type, target_entity: 'profiles', target_id: user_id, description, metadata })

  try {
    if (action === 'role') {
      if (!ROLES.includes(role)) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
      const { error } = await admin.from('profiles').update({ role }).eq('id', user_id)
      if (error) throw new Error(error.message)
      await audit('staff_role_changed', `Role of ${target.full_name} changed from ${target.role} to ${role}.`)
      return NextResponse.json({ ok: true, role })
    }

    if (action === 'quotation_access') {
      const on = value === true
      const { error } = await admin.from('profiles').update({ quotation_access: on }).eq('id', user_id)
      if (error) throw new Error(/quotation_access/.test(error.message)
        ? 'The database needs the quotation-access update first (supabase/quotation_access_v1.sql).' : error.message)
      await audit('staff_quotation_access', `${target.full_name} ${on ? 'can now' : 'can no longer'} edit and delete all quotations.`)
      return NextResponse.json({ ok: true, quotation_access: on })
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
