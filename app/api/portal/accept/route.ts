import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Customer accepts their quotation from the portal link (no login).
// Only a quotation that is currently with the customer, and still valid, can be accepted.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const token = typeof b.token === 'string' ? b.token : ''
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : ''
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
  if (name.length < 2 || b.agree !== true) return NextResponse.json({ error: 'Enter your name and tick the box to accept.' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: q } = await supabase.from('quotation_requests')
    .select('id, status, valid_until, customer_name').eq('portal_token', token).maybeSingle()
  if (!q) return NextResponse.json({ error: 'This link is no longer valid. Please contact us for the latest quotation.' }, { status: 404 })
  if (q.status !== 'sent_to_customer') {
    return NextResponse.json({ error: q.status === 'customer_accepted' || q.status === 'project_created'
      ? 'This quotation has already been accepted.' : 'This quotation cannot be accepted online right now. Please contact us.' }, { status: 409 })
  }
  const today = new Date().toISOString().slice(0, 10)
  if (q.valid_until && q.valid_until < today) {
    return NextResponse.json({ error: 'This quotation has expired. Please contact us for an updated quotation.' }, { status: 409 })
  }

  const { data, error } = await supabase.from('quotation_requests')
    .update({ status: 'customer_accepted', accepted_via: 'portal', accepted_by_name: name, accepted_note: note || null,
              customer_response_at: new Date().toISOString() })
    .eq('id', q.id).eq('status', 'sent_to_customer')
    .select('customer_response_at').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Could not record your acceptance. Please try again.' }, { status: 500 })

  await supabase.from('quotation_status_history').insert({
    quotation_id: q.id, from_status: 'sent_to_customer', to_status: 'customer_accepted',
    changed_by: null, changed_by_name: 'Customer (online)', remarks: `Accepted online by ${name}${note ? ' — “' + note + '”' : ''}`,
  })
  return NextResponse.json({ ok: true, accepted_at: data.customer_response_at })
}
