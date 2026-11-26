import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'
import { STATUS_LABELS } from '@/lib/workflow'

// Stage changes for a quotation. Who may do what is enforced by the database
// (supabase/workflow_v2.sql); the checks here only give clearer messages.
type Action =
  | 'mark_under_review' | 'submit' | 'send_for_approval' | 'approve' | 'send_back' | 'reject' | 'request_more_info'
  | 'share' | 'mark_sent' | 'accept' | 'temperature' | 'lose' | 'revise' | 'reopen'
  | 'schedule_visit' | 'visit_done'

const PRE_VISIT = ['new', 'sales_review', 'site_details_pending', 'site_visit_scheduled']
const num = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const pick = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined)

const NEEDS_REASON: Action[] = ['send_back', 'reject', 'request_more_info', 'lose', 'accept']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const { id } = await params
  const body = await req.json()
  const action = body.action as Action
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim().slice(0, 1000) : ''

  if (NEEDS_REASON.includes(action) && !remarks) {
    return NextResponse.json({ error: 'Please add a short reason or note.' }, { status: 400 })
  }

  const { data: current } = await supabase
    .from('quotation_requests').select('status, lead_temperature').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: 'Quotation not found, or you do not have access to it.' }, { status: 404 })

  if (['approve', 'send_back', 'reject'].includes(action) && me.role !== 'admin') {
    return NextResponse.json({ error: 'Only the CEO can approve, reject or send back a quotation.' }, { status: 403 })
  }

  let updates: Record<string, unknown> = {}
  let note = remarks || null
  switch (action) {
    case 'mark_under_review': updates = { status: 'sales_review' }; break
    case 'submit':
    case 'send_for_approval': updates = { status: 'owner_approval_pending' }; break
    case 'approve':           updates = { status: 'approved', admin_remarks: remarks || null }; note = remarks || 'Approved by CEO'; break
    case 'send_back':         updates = { status: 'drafted', admin_remarks: remarks }; note = 'Sent back by CEO: ' + remarks; break
    case 'reject':            updates = { status: 'rejected', rejection_reason: remarks }; break
    case 'request_more_info': updates = { status: 'more_info_requested', more_info_request: remarks }; break
    case 'share':
    case 'mark_sent':
      if (current.status === 'sent_to_customer') { note = 'Customer link shared again'; break }
      updates = { status: 'sent_to_customer' }; note = 'Shared with customer and admin manager'; break
    case 'accept':
      updates = { status: 'customer_accepted', accepted_via: 'staff', accepted_note: remarks,
                  ...(body.mark_hot ? { lead_temperature: 'hot' } : {}) }
      note = 'Customer accepted: ' + remarks + (body.mark_hot ? ' · marked HOT' : '')
      break
    case 'temperature': {
      const t = body.value === 'hot' ? 'hot' : body.value === 'cold' ? 'cold' : null
      if (!t) return NextResponse.json({ error: 'value must be hot or cold.' }, { status: 400 })
      updates = { lead_temperature: t }
      note = `Marked ${t.toUpperCase()}${remarks ? ': ' + remarks : ''}`
      break
    }
    case 'schedule_visit': {
      const at = typeof body.site_visit_at === 'string' && !Number.isNaN(Date.parse(body.site_visit_at)) ? new Date(body.site_visit_at).toISOString() : null
      if (!at) return NextResponse.json({ error: 'Choose the date and time of the visit.' }, { status: 400 })
      if (!PRE_VISIT.includes(current.status)) return NextResponse.json({ error: 'The site visit is already done.' }, { status: 400 })
      updates = { site_visit_at: at, status: 'site_visit_scheduled' }
      note = 'Site visit planned for ' + new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        + (remarks ? ' — ' + remarks : '')
      break
    }
    case 'visit_done': {
      if (!remarks) return NextResponse.json({ error: 'Write what you saw and what the customer wants.' }, { status: 400 })
      if (!PRE_VISIT.includes(current.status)) return NextResponse.json({ error: 'The site visit is already recorded.' }, { status: 400 })
      const d = (body.details ?? {}) as Record<string, unknown>
      const site: Record<string, unknown> = {
        roof_type: pick(d.roof_type, ['rcc', 'sheet', 'ground_mount', 'other'] as const),
        current_phase: pick(d.current_phase, ['single', 'three'] as const),
        available_roof_area_sqft: num(d.available_roof_area_sqft), sanctioned_load_kw: num(d.sanctioned_load_kw),
        avg_monthly_units: num(d.avg_monthly_units), avg_monthly_bill: num(d.avg_monthly_bill),
        eb_consumer_number: typeof d.eb_consumer_number === 'string' && d.eb_consumer_number.trim() ? d.eb_consumer_number.trim().slice(0, 40) : undefined,
      }
      for (const k of Object.keys(site)) if (site[k] === undefined) delete site[k]
      const lat = num(body.lat), lng = num(body.lng)
      updates = { ...site, status: 'site_visit_done', site_visit_done_at: new Date().toISOString(), site_visit_notes: remarks,
                  ...(lat != null && lng != null ? { site_visit_lat: lat, site_visit_lng: lng } : {}) }
      note = 'Site visit done: ' + remarks + (lat == null ? ' (no GPS)' : '')
      break
    }
    case 'lose':              updates = { status: 'cancelled', lost_reason: remarks }; note = 'Lost: ' + remarks; break
    case 'revise':            updates = { status: 'drafted' }; note = 'Revision started — needs CEO approval again'; break
    case 'reopen':            updates = { status: 'drafted' }; note = 'Reopened'; break
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  let row = null
  if (Object.keys(updates).length) {
    const { data, error } = await supabase.from('quotation_requests').update(updates).eq('id', id).select().maybeSingle()
    if (error) return dbError(error)
    if (!data) return NextResponse.json({ error: 'You do not have access to change this quotation.' }, { status: 403 })
    row = data
  }

  const toStatus = (updates.status as string) ?? current.status
  await supabase.from('quotation_status_history').insert({
    quotation_id: id, from_status: current.status, to_status: toStatus,
    changed_by: me.id, changed_by_name: me.full_name,
    remarks: note ?? `Moved to ${STATUS_LABELS[toStatus] ?? toStatus}`,
  })

  return NextResponse.json(row ?? { ok: true })
}
