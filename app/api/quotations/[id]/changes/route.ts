import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'

// Change requests for a quotation (quotation_view_v1.sql)
//  request  : staff with "view all" ask for new customer / site details and / or describe another change
//  decide   : the CEO approves (values are applied) or rejects with a note
//  withdraw : the requester takes back a request the CEO has not decided yet
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const { id } = await params
  const b = await req.json().catch(() => ({}))
  const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

  if (b.action === 'request') {
    const changes = b.changes && typeof b.changes === 'object' && !Array.isArray(b.changes) ? b.changes : {}
    const { data, error } = await supabase.rpc('request_quotation_change', {
      p_quotation: id, p_changes: changes, p_note: typeof b.note === 'string' ? b.note : null, p_reason: typeof b.reason === 'string' ? b.reason : '',
    })
    if (error) return dbError(error)
    return NextResponse.json({ id: data })
  }
  if (b.action === 'decide') {
    if (me.role !== 'admin') return NextResponse.json({ error: 'Only the CEO approves change requests.' }, { status: 403 })
    const rid = uuid(b.request_id)
    if (!rid) return NextResponse.json({ error: 'Which request?' }, { status: 400 })
    const { data, error } = await supabase.rpc('decide_quotation_change', { p_id: rid, p_approve: b.approve === true, p_note: typeof b.note === 'string' ? b.note : '' })
    if (error) return dbError(error)
    return NextResponse.json(data)
  }
  if (b.action === 'withdraw') {
    const rid = uuid(b.request_id)
    if (!rid) return NextResponse.json({ error: 'Which request?' }, { status: 400 })
    const { error } = await supabase.rpc('withdraw_quotation_change', { p_id: rid })
    if (error) return dbError(error)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
