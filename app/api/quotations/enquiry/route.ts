import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'
import { isManager } from '@/lib/workflow'

// Phone / walk-in enquiries logged by the CEO or admin manager (or staff the CEO gave
// "Quotations: edit & delete"). The database numbers them (GSS-QT-<year>-<n>) like website enquiries.

const SOURCES = ['phone', 'walk_in', 'referral', 'social_media', 'other'] as const
const SOURCE_LABEL: Record<string, string> = { phone: 'Phone call', walk_in: 'Walk-in', referral: 'Referral', social_media: 'WhatsApp / social media', other: 'Other' }
const digits = (m: string) => m.replace(/\D/g, '').slice(-10)

// Same mobile already in the CRM? (shown as a warning before saving)
export async function GET(req: NextRequest) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const m = digits(new URL(req.url).searchParams.get('mobile') ?? '')
  if (m.length < 10) return NextResponse.json({ matches: [] })
  const { data } = await auth.supabase.from('quotation_requests')
    .select('id, quotation_number, customer_name, status, created_at, job_number')
    .ilike('mobile', `%${m.slice(-8)}%`).order('created_at', { ascending: false }).limit(5)
  return NextResponse.json({ matches: (data ?? []).filter(r => r) })
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  if (!isManager(me.role) && !me.quotation_access) {
    return NextResponse.json({ error: 'Only the CEO or admin manager can log enquiries here.' }, { status: 403 })
  }
  const b = await req.json().catch(() => ({}))
  const str = (k: string, max = 200) => (typeof b[k] === 'string' && b[k].trim() ? b[k].trim().slice(0, max) : null)
  const num = (k: string) => (b[k] === '' || b[k] == null || !Number.isFinite(Number(b[k])) || Number(b[k]) < 0 ? null : Number(b[k]))
  const id = (k: string) => (typeof b[k] === 'string' && /^[0-9a-f-]{36}$/i.test(b[k]) ? b[k] : null)

  const customer_name = str('customer_name', 120)
  const mobile = str('mobile', 20)
  if (!customer_name) return NextResponse.json({ error: 'Enter the customer’s name.' }, { status: 400 })
  if (!mobile || !/^[0-9+\-\s]{10,16}$/.test(mobile) || digits(mobile).length < 10) {
    return NextResponse.json({ error: 'Enter a valid 10-digit mobile number.' }, { status: 400 })
  }
  const source = SOURCES.includes(b.source) ? b.source : 'phone'
  const visitAt = typeof b.site_visit_at === 'string' && !Number.isNaN(Date.parse(b.site_visit_at)) ? new Date(b.site_visit_at).toISOString() : null
  const engineer = id('assigned_engineer_id')
  const temp = b.lead_temperature === 'hot' || b.lead_temperature === 'cold' ? b.lead_temperature : null
  const next = typeof b.next_follow_up_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.next_follow_up_date) ? b.next_follow_up_date : null
  const kw = num('required_capacity_kw')

  const { data: row, error } = await supabase.from('quotation_requests').insert({
    customer_name, mobile,
    email: str('email', 120), city: str('city', 80), address: str('address', 300),
    region: b.region === 'tamilnadu' ? 'tamilnadu' : 'puducherry',
    consumer_type: ['domestic', 'commercial', 'industrial', 'institution', 'agricultural'].includes(b.consumer_type) ? b.consumer_type : 'domestic',
    solar_type: ['ongrid', 'hybrid', 'offgrid', 'solar_pump', 'not_sure'].includes(b.solar_type) ? b.solar_type : 'ongrid',
    required_capacity_kw: kw, recommended_capacity_kw: kw,
    avg_monthly_bill: num('avg_monthly_bill'),
    notes: str('notes', 2000),
    source, priority: b.priority === 'high' || b.priority === 'urgent' ? b.priority : 'normal',
    site_visit_required: b.site_visit_required !== false,
    assigned_engineer_id: engineer, assigned_sales_id: id('assigned_sales_id'), follow_up_manager_id: id('follow_up_manager_id'),
    ...(visitAt ? { site_visit_at: visitAt } : {}),
    status: visitAt && engineer ? 'site_visit_scheduled' : 'new',
  }).select('id, quotation_number, status').single()
  if (error) return dbError(error)

  // Hot / cold and the call-back date (new rows always start without hot / cold)
  let warning = ''
  if (temp || next) {
    const { error: e2 } = await supabase.from('quotation_requests')
      .update({ ...(temp ? { lead_temperature: temp, lead_temperature_note: str('lead_note', 300) } : {}), ...(next ? { next_follow_up_date: next } : {}) })
      .eq('id', row.id)
    if (e2) warning = 'Saved, but hot / cold could not be set: ' + e2.message
  }

  await supabase.from('quotation_status_history').insert({
    quotation_id: row.id, from_status: null, to_status: row.status, changed_by: me.id, changed_by_name: me.full_name,
    remarks: `${SOURCE_LABEL[source]} enquiry logged by ${me.full_name}${temp ? ` · marked ${temp.toUpperCase()}` : ''}`,
  })

  return NextResponse.json({ id: row.id, quotation_number: row.quotation_number, warning }, { status: 201 })
}
