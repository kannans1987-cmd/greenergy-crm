import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'

// Log a call / visit / WhatsApp with the customer. The database keeps the
// quotation's next follow-up date, count and hot/cold in step.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase } = auth
  const { id } = await params
  const b = await req.json()

  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : ''
  if (!notes) return NextResponse.json({ error: 'Write what happened.' }, { status: 400 })
  const contact_type = ['call', 'whatsapp', 'visit', 'email', 'note'].includes(b.contact_type) ? b.contact_type : 'call'
  const temperature = b.temperature === 'hot' || b.temperature === 'cold' ? b.temperature : null
  const next = typeof b.next_follow_up_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.next_follow_up_date) ? b.next_follow_up_date : null

  const { data, error } = await supabase.from('quotation_follow_ups')
    .insert({ quotation_id: id, contact_type, notes, temperature, next_follow_up_date: next })
    .select().single()
  if (error) return dbError(error)
  return NextResponse.json(data, { status: 201 })
}
