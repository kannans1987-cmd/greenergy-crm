import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { passwordLink, emailLink } from '@/lib/auth-links'

// CEO only: correct a staff member's login email and/or give them a fresh "set your password" link.
// The link is emailed (when Gmail is set up) and also returned, so it can be sent on WhatsApp.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only the CEO can do this.' }, { status: 403 })

  const { user_id, new_email } = await req.json().catch(() => ({}))
  if (typeof user_id !== 'string' || !user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id,email,full_name').eq('id', user_id).single()
  if (!profile) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })

  let email: string = profile.email
  if (typeof new_email === 'string' && new_email.trim() && new_email.trim().toLowerCase() !== email.toLowerCase()) {
    const next = new_email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(user_id, { email: next, email_confirm: true })
    if (error) return NextResponse.json({ error: `Could not change the email: ${error.message}` }, { status: 400 })
    await admin.from('profiles').update({ email: next }).eq('id', user_id)
    await admin.from('employee_registrations').update({ email: next }).ilike('email', email)
    await admin.from('audit_log').insert({
      action_by: user.id, action_type: 'staff_email_changed', target_entity: 'profiles', target_id: user_id,
      description: `Login email of ${profile.full_name} changed from ${email} to ${next}.`,
    })
    email = next
  }

  try {
    const link = await passwordLink(email)
    const emailed = await emailLink(email, profile.full_name ?? '', 'recovery', link)
    await admin.from('audit_log').insert({
      action_by: user.id, action_type: 'staff_login_link', target_entity: 'profiles', target_id: user_id,
      description: `Login link created for ${email}${emailed ? ' and emailed' : ''}.`,
    })
    return NextResponse.json({ email, link, emailed })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the link.' }, { status: 500 })
  }
}
