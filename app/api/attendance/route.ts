import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  const employee_id = url.searchParams.get('employee_id')

  let q = supabase.from('attendance')
    .select('*,projects(name,site_address),office_locations(name),employee:employee_id(full_name)')
    .order('date', { ascending: false })

  if (profile?.role === 'employee') {
    q = q.eq('employee_id', user.id)
  } else if (employee_id) {
    q = q.eq('employee_id', employee_id)
  }
  if (date) q = q.eq('date', date)

  const { data, error } = await q.limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Clock-in / clock-out are only done from the Attendance page on the person's approved phone
// (database functions attendance_clock_in / attendance_clock_out check the phone and the GPS).
const gone = () => NextResponse.json({ error: 'Clock in and out from the Attendance page on your approved mobile phone.' }, { status: 410 })
export async function POST() { return gone() }
export async function PATCH() { return gone() }
