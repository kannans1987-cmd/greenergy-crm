import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { full_name, email, phone, designation, department, date_of_joining } = body

    if (!full_name || !email || !phone || !designation || !department) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Check for duplicate pending or approved registration
    const { data: existing } = await supabase
      .from('employee_registrations')
      .select('id,status')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (existing) {
      if (existing.status === 'pending') {
        return NextResponse.json({ error: 'A registration request with this email is already pending admin review.' }, { status: 409 })
      }
      if (existing.status === 'approved') {
        return NextResponse.json({ error: 'This email is already registered. Please sign in or use Forgot Password.' }, { status: 409 })
      }
      // If rejected, allow re-registration — update the existing record
      const { error } = await supabase.from('employee_registrations').update({
        full_name, phone, designation, department,
        date_of_joining: date_of_joining || null,
        status: 'pending', rejection_reason: null,
        reviewed_by: null, reviewed_at: null,
      }).eq('id', existing.id)
      if (error) throw error
      return NextResponse.json({ message: 'Registration request re-submitted.' })
    }

    // Insert new registration
    const { error } = await supabase.from('employee_registrations').insert({
      full_name:        full_name.trim(),
      email:            email.toLowerCase().trim(),
      phone:            phone.trim(),
      designation:      designation.trim(),
      department:       department.trim(),
      date_of_joining:  date_of_joining || null,
      status:           'pending',
    })

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This email is already registered.' }, { status: 409 })
      }
      throw error
    }

    // TODO: Send notification email to admin (kannan.s1987@gmail.com) via SMTP/Resend

    return NextResponse.json({ message: 'Registration submitted. You will receive an email once approved.' })
  } catch (err: unknown) {
    console.error('[Register API]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
