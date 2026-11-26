import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { residentialSubsidy, subsidyEligible, buildPrice } from '@/lib/workflow'
import { loadPricing, toOpts, quotationColumns, saveCosting } from '@/lib/pricing-server'
import { workout, type Workout } from '@/lib/pricing-engine'
import { sendLeadEmail } from '@/lib/mailer'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const url = new URL(req.url)
  const status = url.searchParams.get('status')

  let q = supabase
    .from('quotation_requests')
    .select(`
      *,
      assigned_sales:assigned_sales_id ( id, full_name, email ),
      assigned_engineer:assigned_engineer_id ( id, full_name, email )
    `)
    .order('created_at', { ascending: false })

  // Employees only see quotations assigned to them (unless the CEO gave them quotation access)
  if (profile?.role === 'employee' && !profile?.quotation_access) {
    q = q.or(`assigned_sales_id.eq.${user.id},assigned_engineer_id.eq.${user.id},follow_up_manager_id.eq.${user.id}`)
  }

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

const QUOTATION_DOCS_BUCKET = 'quotation-documents'

// The public website (www.greenergypdy.com) posts its enquiry form here directly
const WEBSITE_ORIGINS = ['https://www.greenergypdy.com', 'https://greenergypdy.com', 'http://localhost:8000']

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return WEBSITE_ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {}
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) })
}

function fileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : 'bin'
}

// Uploads a customer-submitted file (bill/roof photo) via the service-role
// client — the public form has no authenticated user, so RLS can't scope
// this by auth.uid(); the admin client bypasses RLS entirely instead.
async function uploadQuotationFile(
  admin: ReturnType<typeof createAdminClient>,
  quotationId: string,
  prefix: string,
  file: File
): Promise<string | null> {
  if (!file || file.size === 0) return null
  const path = `${quotationId}/${prefix}_${Date.now()}.${fileExt(file.name)}`
  const { error: uploadError } = await admin.storage
    .from(QUOTATION_DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (uploadError) return null
  const { data } = admin.storage.from(QUOTATION_DOCS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// PUBLIC endpoint — no auth required (customer enquiry form).
// Writes through the service role: the database no longer accepts anonymous inserts,
// and only the enquiry fields below can be set (never status, approval or prices).
export async function POST(req: NextRequest) {
  const headers = cors(req)
  const supabase = createAdminClient()
  const formData = await req.formData()

  const str = (k: string): string | null => {
    const v = formData.get(k)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }
  const num = (k: string): number | null => {
    const v = formData.get(k)
    if (typeof v !== 'string' || v.trim() === '') return null
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  const bool = (k: string): boolean => {
    const v = formData.get(k)
    return v === 'yes' || v === 'true'
  }

  const customer_name = str('customer_name')
  const mobile = str('mobile')

  if (!customer_name || !mobile) {
    return NextResponse.json({ error: 'customer_name and mobile are required.' }, { status: 400, headers })
  }
  if (customer_name.length > 120 || !/^[0-9+\-\s]{8,16}$/.test(mobile)) {
    return NextResponse.json({ error: 'Please enter a valid name and mobile number.' }, { status: 400, headers })
  }

  // Price and subsidy are worked out here from the current price list, not trusted from the browser
  const region = str('region') === 'tamilnadu' ? 'tamilnadu' : 'puducherry'
  const wantsSubsidy = bool('subsidy_required')
  let kw = num('recommended_capacity_kw') ?? num('required_capacity_kw') ?? 0
  let listed: { w: Workout; cv: number; mv: number; month?: string } | null = null
  const solarType = str('solar_type')
  if (kw > 0 && kw <= 1000 && (!solarType || ['ongrid', 'hybrid', 'not_sure'].includes(solarType))) {
    const p = await loadPricing().catch(() => null)
    if (p) {
      try {
        const w = workout(p.model, p.catalogue, toOpts({ kw, consumer_type: str('consumer_type'), solar_type: solarType === 'hybrid' ? 'hybrid' : 'ongrid',
          panel_type: wantsSubsidy ? 'DCR' : 'NonDCR', roof_type: str('roof_type') }))
        listed = { w, cv: p.catalogueVersion, mv: p.modelVersion, month: p.catalogue.quoteMonth }
        kw = w.kwp
      } catch { /* fall back to the form's estimate */ }
    }
  }
  const aid = wantsSubsidy && subsidyEligible(str('consumer_type'), solarType, 'DCR')
    ? residentialSubsidy(region, kw) : { central: 0, state: 0, total: 0, stateName: '' }
  const listPrice = listed ? buildPrice({ kw, pricePerKw: Math.round(listed.w.preGst / listed.w.kwp), region, consumerType: str('consumer_type'),
    solarType: solarType ?? 'ongrid', panelType: wantsSubsidy ? 'DCR' : 'NonDCR' }) : null
  const totalBefore = listPrice ? listPrice.total : num('total_cost_before_subsidy')

  const { data: quotation, error } = await supabase
    .from('quotation_requests')
    .insert({
      customer_name,
      mobile,
      email:                     str('email'),
      address:                   str('address'),
      city:                      str('city'),
      consumer_type:             str('consumer_type'),
      solar_type:                str('solar_type'),
      eb_consumer_number:        str('eb_consumer_number'),
      sanctioned_load_kw:        num('sanctioned_load_kw'),
      avg_monthly_bill:          num('avg_monthly_bill'),
      avg_monthly_units:         num('avg_monthly_units'),
      required_capacity_kw:      num('required_capacity_kw'),
      roof_type:                 str('roof_type'),
      available_roof_area_sqft:  num('available_roof_area_sqft'),
      current_phase:             str('current_phase'),
      loan_required:             bool('loan_required'),
      subsidy_required:          bool('subsidy_required'),
      site_visit_required:       bool('site_visit_required'),
      notes:                     str('notes'),
      source:                    str('source') || 'website',
      recommended_capacity_kw:   listed ? kw : num('recommended_capacity_kw'),
      estimated_daily_gen_kwh:   num('estimated_daily_gen_kwh'),
      estimated_monthly_gen_kwh: num('estimated_monthly_gen_kwh'),
      estimated_yearly_gen_kwh:  num('estimated_yearly_gen_kwh'),
      estimated_monthly_savings: num('estimated_monthly_savings'),
      estimated_yearly_savings:  num('estimated_yearly_savings'),
      estimated_payback_years:   num('estimated_payback_years'),
      estimated_25yr_savings:    num('estimated_25yr_savings'),
      region,
      subsidy_applicable:        aid.total,
      central_subsidy:           aid.central,
      state_subsidy:             aid.state,
      state_subsidy_name:        aid.stateName || null,
      system_cost:               listPrice ? listPrice.system : num('system_cost'),
      gst_amount:                listPrice ? listPrice.gst : num('gst_amount'),
      total_cost_before_subsidy: totalBefore,
      ...(listed ? (({ admin_capacity_kw: _a, price_per_kw: _p, priced_from_list: _f, ...spec }) => spec)(quotationColumns(listed.w, listed.month)) : {}),
      net_cost_after_subsidy:    totalBefore != null ? totalBefore - aid.total : null,
      status:                    'new',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })

  const quotationId = (quotation as { id: string }).id
  if (listed) await saveCosting(quotationId, listed.w, listed.cv, listed.mv)

  // Upload customer-attached files (electricity bill, roof photo) and
  // patch their public URLs back onto the row.
  const billFile = formData.get('bill_file')
  const roofFile = formData.get('roof_file')
  const fileUpdates: Record<string, string> = {}

  if (billFile instanceof File && billFile.size > 0) {
    const admin = createAdminClient()
    const url = await uploadQuotationFile(admin, quotationId, 'bill', billFile)
    if (url) fileUpdates.eb_bill_url = url
  }
  if (roofFile instanceof File && roofFile.size > 0) {
    const admin = createAdminClient()
    const url = await uploadQuotationFile(admin, quotationId, 'roof', roofFile)
    if (url) fileUpdates.roof_photo_url = url
  }

  if (Object.keys(fileUpdates).length > 0) {
    await supabase.from('quotation_requests').update(fileUpdates).eq('id', quotationId)
    Object.assign(quotation as Record<string, unknown>, fileUpdates)
  }

  // Insert line items if provided (JSON-encoded string field in the form data)
  const lineItemsRaw = formData.get('line_items')
  if (typeof lineItemsRaw === 'string' && lineItemsRaw.trim() !== '') {
    try {
      const line_items = JSON.parse(lineItemsRaw)
      if (Array.isArray(line_items) && line_items.length > 0) {
        const lineItemRows = line_items.map((item: {
          sort_order?: number
          category?: string
          description: string
          quantity?: number
          unit?: string
          unit_price?: number
          is_optional?: boolean
          is_included?: boolean
          note?: string
        }, idx: number) => ({
          quotation_id: quotationId,
          sort_order:   item.sort_order ?? idx + 1,
          category:     item.category || null,
          description:  item.description,
          quantity:     item.quantity ?? 1,
          unit:         item.unit || null,
          unit_price:   item.unit_price ?? 0,
          is_optional:  item.is_optional ?? false,
          is_included:  item.is_included ?? true,
          note:         item.note || null,
        }))
        await supabase.from('quotation_line_items').insert(lineItemRows)
      }
    } catch {
      // Malformed line_items JSON — ignore, not a required field
    }
  }

  // Website enquiries: tell the CEO and the admin managers straight away (CRM notification + email)
  let emailed = false
  if ((str('source') || 'website') === 'website') {
    const { data: staff } = await supabase.from('profiles').select('id').in('role', ['admin', 'task_manager']).eq('status', 'active')
    if (staff?.length) {
      await supabase.from('notifications').insert(staff.map((p: { id: string }) => ({
        user_id: p.id, type: 'quotation', title: 'New website enquiry',
        message: `${customer_name} · ${mobile}${str('city') ? ' · ' + str('city') : ''}`,
        link: `/staff/quotations/${quotationId}`,
      })))
    }
    try {
      emailed = await sendLeadEmail({ quotationId, quotationNumber: (quotation as { quotation_number?: string }).quotation_number,
        name: customer_name, mobile, city: str('city'), notes: str('notes') })
    } catch (err) {
      console.error('[quotations] enquiry email failed:', err)
    }
  }

  // Insert initial status history entry
  await supabase.from('quotation_status_history').insert({
    quotation_id:     quotationId,
    from_status:      null,
    to_status:        'new',
    changed_by:       null,
    changed_by_name:  'Customer',
    remarks:          'Quotation request submitted.',
  })

  // emailed tells the website whether it still needs to send its own backup email
  return NextResponse.json({ ...(quotation as Record<string, unknown>), emailed }, { status: 201, headers })
}
