import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'employee'

  const url    = new URL(req.url)
  const status = url.searchParams.get('status')

  let q = supabase.from('tasks').select(
    'id,title,description,priority,status,due_date,due_time,completion_notes,completed_at,created_at,projects(name),assignee:assigned_to(full_name),assigner:assigned_by(full_name)'
  ).order('created_at', { ascending: false })

  if (role === 'employee') q = q.eq('assigned_to', user.id)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'employee') return NextResponse.json({ error: 'Employees cannot create tasks.' }, { status: 403 })

  const body = await req.json()
  const { title, description, assigned_to, project_id, priority, due_date, due_time } = body

  if (!title) return NextResponse.json({ error: 'Task title is required.' }, { status: 400 })

  const { data, error } = await supabase.from('tasks').insert({
    title, description: description || null,
    assigned_to: assigned_to || null, project_id: project_id || null,
    priority: priority ?? 'medium', due_date: due_date || null,
    due_time: due_time || null, assigned_by: user.id, status: 'pending',
  }).select('id,title,priority,status,due_date,projects(name),assignee:assigned_to(full_name)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, status, completion_notes } = body
  if (!id) return NextResponse.json({ error: 'Task id required.' }, { status: 400 })

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (completion_notes)  updates.completion_notes = completion_notes
  if (status === 'completed') updates.completed_at = new Date().toISOString()

  const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
