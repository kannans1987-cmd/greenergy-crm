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
    .select('*,projects(name,site_address),employee:employee_id(full_name)')
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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { project_id, clock_in_lat, clock_in_lng, clock_in_address } = body

  if (!clock_in_lat || !clock_in_lng) {
    return NextResponse.json({ error: 'GPS coordinates are required for clock-in.' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]

  // Check if already clocked in today
  const { data: existing } = await supabase.from('attendance')
    .select('id,clock_out_time').eq('employee_id', user.id).eq('date', today).maybeSingle()

  if (existing && !existing.clock_out_time) {
    return NextResponse.json({ error: 'You are already clocked in. Please clock out first.' }, { status: 409 })
  }

  const { data, error } = await supabase.from('attendance').insert({
    employee_id:      user.id,
    project_id:       project_id || null,
    date:             today,
    clock_in_time:    new Date().toISOString(),
    clock_in_lat,
    clock_in_lng,
    clock_in_address: clock_in_address || null,
    attendance_status:'present',
  }).select('*,projects(name)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, clock_out_lat, clock_out_lng, remarks } = body

  if (!id) return NextResponse.json({ error: 'Attendance id required.' }, { status: 400 })

  // Fetch the record to calculate hours
  const { data: record } = await supabase.from('attendance').select('clock_in_time').eq('id', id).eq('employee_id', user.id).single()
  if (!record) return NextResponse.json({ error: 'Record not found.' }, { status: 404 })

  const now       = new Date()
  const clockIn   = new Date(record.clock_in_time)
  const totalMins = Math.round((now.getTime() - clockIn.getTime()) / 60000)
  const totalHrs  = Math.round((totalMins / 60) * 100) / 100
  const overtime  = Math.max(0, Math.round(((totalMins - 480) / 60) * 100) / 100)

  const { data, error } = await supabase.from('attendance').update({
    clock_out_time: now.toISOString(),
    clock_out_lat:  clock_out_lat  ?? null,
    clock_out_lng:  clock_out_lng  ?? null,
    total_hours:    totalHrs,
    overtime_hours: overtime,
    remarks:        remarks ?? null,
  }).eq('id', id).select('*,projects(name)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
