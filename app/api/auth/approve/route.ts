import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    // Verify the requesting user is an admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can approve registrations.' }, { status: 403 })
    }

    const body                                   = await req.json()
    const { registration_id, reject, reason }    = body
    if (!registration_id) return NextResponse.json({ error: 'registration_id is required' }, { status: 400 })

    const adminClient = createAdminClient()

    // Fetch the registration
    const { data: reg, error: regErr } = await adminClient
      .from('employee_registrations')
      .select('*')
      .eq('id', registration_id)
      .single()

    if (regErr || !reg) return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
    if (reg.status !== 'pending') return NextResponse.json({ error: 'This registration has already been reviewed.' }, { status: 409 })

    if (reject) {
      // Mark as rejected
      await adminClient.from('employee_registrations').update({
        status:           'rejected',
        rejection_reason: reason ?? null,
        reviewed_by:      user.id,
        reviewed_at:      new Date().toISOString(),
      }).eq('id', registration_id)

      // Audit log
      await adminClient.from('audit_log').insert({
        action_by:    user.id,
        action_type:  'registration_rejected',
        target_entity:'employee_registrations',
        target_id:    registration_id,
        description:  `Registration rejected for ${reg.email}. Reason: ${reason ?? 'Not specified'}`,
      })

      return NextResponse.json({ message: 'Registration rejected.' })
    }

    // APPROVE — invite user via Supabase Auth
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      reg.email,
      {
        data: {
          full_name:       reg.full_name,
          phone:           reg.phone,
          designation:     reg.designation,
          department:      reg.department,
          date_of_joining: reg.date_of_joining,
          role:            'employee',
        },
        redirectTo: `${siteUrl}/auth/callback?next=/staff/dashboard`,
      }
    )

    if (inviteErr) {
      // If user already exists in auth (edge case), still mark registration approved
      if (!inviteErr.message.includes('already been registered')) {
        console.error('[Approve API] Invite error:', inviteErr)
        return NextResponse.json({ error: `Invite failed: ${inviteErr.message}` }, { status: 500 })
      }
    }

    // Mark registration as approved
    await adminClient.from('employee_registrations').update({
      status:      'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', registration_id)

    // Audit log
    await adminClient.from('audit_log').insert({
      action_by:    user.id,
      action_type:  'registration_approved',
      target_entity:'employee_registrations',
      target_id:    registration_id,
      description:  `Registration approved for ${reg.email}. Invite email sent.`,
      metadata:     { invited_user_id: inviteData?.user?.id ?? null },
    })

    return NextResponse.json({ message: `Invite sent to ${reg.email}. They will receive an email to set their password.` })
  } catch (err: unknown) {
    console.error('[Approve API]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Approval failed. Please try again.' },
      { status: 500 }
    )
  }
}
