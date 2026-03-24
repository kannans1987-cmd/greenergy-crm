import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  let q = supabase.from('job_cards').select(
    'id,job_card_number,role_in_project,start_date,end_date,total_manhours,status,signoff_at,projects(name,project_number),employee:employee_id(full_name)'
  ).order('created_at', { ascending: false })

  if (profile?.role === 'employee') q = q.eq('employee_id', user.id)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, daily_notes, status, signoff } = body
  if (!id) return NextResponse.json({ error: 'Job card id required.' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (daily_notes !== undefined) updates.daily_notes = daily_notes
  if (status)                    updates.status       = status
  if (signoff) {
    updates.status     = 'completed'
    updates.signoff_by = user.id
    updates.signoff_at = new Date().toISOString()
    updates.end_date   = new Date().toISOString().split('T')[0]
  }

  const { data, error } = await supabase.from('job_cards').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
