import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  let q = supabase.from('projects').select('*').order('created_at', { ascending: false })

  if (profile?.role === 'employee') {
    const { data: myProjects } = await supabase
      .from('project_employees').select('project_id').eq('employee_id', user.id)
    const ids = (myProjects ?? []).map((r: { project_id: string }) => r.project_id)
    if (ids.length === 0) return NextResponse.json([])
    q = q.in('id', ids)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Only admins can create projects.' }, { status: 403 })

  const body = await req.json()
  const { name, customer_name, site_address, project_type, capacity_kwp, start_date, expected_completion, notes, assignees } = body
  if (!name) return NextResponse.json({ error: 'Project name is required.' }, { status: 400 })

  const { data: proj, error } = await supabase.from('projects').insert({
    name, customer_name: customer_name || null,
    site_address: site_address || null, project_type: project_type || null,
    capacity_kwp: capacity_kwp || null, start_date: start_date || null,
    expected_completion: expected_completion || null,
    notes: notes || null, status: 'planning', created_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (assignees?.length > 0) {
    await supabase.from('project_employees').insert(
      assignees.map((eid: string) => ({
        project_id: (proj as { id: string }).id, employee_id: eid,
        assigned_date: start_date || new Date().toISOString().split('T')[0],
      }))
    )
  }

  return NextResponse.json(proj, { status: 201 })
}
