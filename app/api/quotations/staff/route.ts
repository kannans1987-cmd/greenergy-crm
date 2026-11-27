import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'
import { buildPrice, isManager } from '@/lib/workflow'
import { loadPricing, toOpts, quotationColumns, saveCosting } from '@/lib/pricing-server'
import { workout, type Workout } from '@/lib/pricing-engine'


// Panels / inverter chosen by hand and how the price was typed (quotation_panels_v1.sql)
const PRICE_MODES_OK = ['per_kw', 'per_kw_incl', 'total_incl']
function choiceCols(b: Record<string, unknown>) {
  const int = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return v !== '' && v != null && Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const out: Record<string, unknown> = {}
  const d = int(b.dcr_panel_qty, 1, 5000), n = int(b.nondcr_panel_qty, 1, 5000), w = int(b.panel_wp_nondcr, 100, 1000), q = int(b.inverter_qty, 1, 50)
  if (d) out.dcr_panel_qty = d
  if (n) out.nondcr_panel_qty = n
  if (w) out.panel_wp_nondcr = w
  if (typeof b.inverter_choice === 'string' && b.inverter_choice.trim()) out.inverter_choice = b.inverter_choice.trim().slice(0, 80)
  if (q) out.inverter_qty = q
  if (PRICE_MODES_OK.includes(String(b.price_mode)) && b.price_mode !== 'per_kw' && Number(b.price_entry) > 0) {
    out.price_mode = b.price_mode; out.price_entry = Number(b.price_entry)
  }
  return out
}

// Staff create a quotation (draft). Employees are always the assigned sales person;
// the CEO / admin manager may assign it to someone else.
export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const b = await req.json()

  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const num = (v: unknown) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? n : null }

  const customer_name = str(b.customer_name, 120)
  const mobile = str(b.mobile, 20)
  let kw = num(b.capacity_kw)
  let pricePerKw = num(b.price_per_kw)

  // Price from the supplier price list (server-side), unless the form chose a manual ₹/kW
  let listed: { w: Workout; cols: Record<string, unknown>; cv: number; mv: number } | null = null
  if (b.use_price_list !== false && kw && kw > 0) {
    const p = await loadPricing().catch(() => null)
    if (p) {
      try {
        const w = workout(p.model, p.catalogue, toOpts({ ...b, kw }))
        listed = { w, cols: quotationColumns(w, p.catalogue.quoteMonth), cv: p.catalogueVersion, mv: p.modelVersion }
        kw = Number(listed.cols.admin_capacity_kw)
        if (!(num(b.price_per_kw_override) && num(b.price_per_kw_override)! > 0)) pricePerKw = Number(listed.cols.price_per_kw)
        else pricePerKw = num(b.price_per_kw_override)
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not price this system.' }, { status: 400 })
      }
    }
  }
  if (!customer_name || !mobile || !/^[0-9+\-\s]{8,16}$/.test(mobile)) return NextResponse.json({ error: 'Enter the customer name and a valid mobile number.' }, { status: 400 })
  if (!kw || kw <= 0 || ((!pricePerKw || pricePerKw <= 0) && !(Number(b.price_entry) > 0 && ['per_kw_incl', 'total_incl'].includes(String(b.price_mode))))) {
    return NextResponse.json({ error: 'Enter the system size and the price.' }, { status: 400 })
  }

  const region = b.region === 'tamilnadu' ? 'tamilnadu' : 'puducherry'
  const consumer_type = str(b.consumer_type) ?? 'domestic'
  const solar_type = str(b.solar_type) ?? 'ongrid'
  const panel_type = listed ? String(listed.cols.panel_type)
    : consumer_type !== 'domestic' ? 'NonDCR' : b.panel_type === 'NonDCR' ? 'NonDCR' : b.panel_type === 'Mixed' ? 'Mixed' : 'DCR'
  // Mixed DCR + Non-DCR: the DCR part decides the subsidy
  const dcr_kw = panel_type === 'Mixed' ? (listed ? Number(listed.cols.dcr_kw) : num(b.dcr_kw)) : null
  if (panel_type === 'Mixed' && !(dcr_kw && dcr_kw > 0 && dcr_kw < kw)) {
    return NextResponse.json({ error: 'For mixed panels, enter the DCR part in kW (less than the total size).' }, { status: 400 })
  }
  const inverter_phase = ['1', '3'].includes(String(b.inverter_phase)) ? String(b.inverter_phase) : null
  const chosen = choiceCols(b)
  const lineItems: { description: string; quantity: number; unit_price: number; category?: string }[] =
    (Array.isArray(b.line_items) ? b.line_items : [])
      .map((x: { description?: unknown; quantity?: unknown; unit_price?: unknown; category?: unknown }) => ({
        description: str(x.description, 200) ?? '', quantity: num(x.quantity) ?? 1, unit_price: num(x.unit_price) ?? 0,
        category: str(x.category, 60) ?? 'Extra',
      }))
      .filter((x: { description: string; unit_price: number }) => x.description && x.unit_price)
  const extras = lineItems.reduce((n, x) => n + x.quantity * x.unit_price, 0)
  const discount = Math.max(0, num(b.discount) ?? 0)
  // A price typed including GST is kept exactly: the total is that figure
  const p = buildPrice({ kw, pricePerKw: pricePerKw ?? 0, extras, discount, region, consumerType: consumer_type, solarType: solar_type, panelType: panel_type, dcrKw: dcr_kw,
    entryMode: chosen.price_mode as string | undefined, entryValue: chosen.price_entry as number | undefined })
  pricePerKw = p.pricePerKw
  if (p.total <= 0) return NextResponse.json({ error: 'The total must be more than zero.' }, { status: 400 })

  const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 15)
  const assigned = isManager(me.role) && str(b.assigned_sales_id) ? str(b.assigned_sales_id) : me.id

  const { data, error } = await supabase.from('quotation_requests').insert({
    customer_name, mobile,
    email: str(b.email, 120), address: str(b.address, 300), city: str(b.city, 80),
    eb_consumer_number: str(b.eb_consumer_number, 40), sanctioned_load_kw: num(b.sanctioned_load_kw),
    avg_monthly_units: num(b.avg_monthly_units), avg_monthly_bill: num(b.avg_monthly_bill),
    roof_type: str(b.roof_type), available_roof_area_sqft: num(b.available_roof_area_sqft), current_phase: str(b.current_phase),
    consumer_type, solar_type, region, panel_type,
    // new columns (quotation_panels_v1.sql) only when used, so other quotations save before that update
    ...(dcr_kw ? { dcr_kw, panel_brand_nondcr: str(b.panel_brand_nondcr, 60) } : {}),
    ...(inverter_phase ? { inverter_phase } : {}),
    ...chosen,
    loan_required: !!b.loan_required, subsidy_required: p.subsidy > 0, site_visit_required: b.site_visit_required !== false,
    source: str(b.source) ?? 'walk_in', priority: str(b.priority) ?? 'normal', notes: str(b.notes, 2000),
    required_capacity_kw: kw, recommended_capacity_kw: kw,
    price_per_kw: pricePerKw, discount,
    admin_capacity_kw: kw, admin_system_cost: p.system, admin_gst_amount: p.gst, admin_total_cost: p.total,
    admin_subsidy: p.subsidy, admin_net_cost: p.net, central_subsidy: p.central, state_subsidy: p.state,
    state_subsidy_name: p.stateName || null,
    system_cost: p.system, gst_amount: p.gst, total_cost_before_subsidy: p.total, subsidy_applicable: p.subsidy, net_cost_after_subsidy: p.net,
    valid_until: validUntil.toISOString().slice(0, 10),
    ...(listed ? { ...listed.cols, admin_capacity_kw: kw, recommended_capacity_kw: kw, price_per_kw: pricePerKw } : {}),
    status: 'drafted',
    assigned_sales_id: assigned,
    follow_up_manager_id: str(b.follow_up_manager_id),
  }).select('id, quotation_number').single()
  if (error || !data) return dbError(error)
  if (listed) await saveCosting(data.id, listed.w, listed.cv, listed.mv)

  if (lineItems.length) {
    const { error: liErr } = await supabase.from('quotation_line_items').insert(
      lineItems.map((x, i) => ({ quotation_id: data.id, sort_order: i + 1, category: x.category, description: x.description,
                                 quantity: x.quantity, unit: 'nos', unit_price: x.unit_price, is_included: true })))
    if (liErr) return dbError(liErr)
  }
  await supabase.from('quotation_status_history').insert({
    quotation_id: data.id, from_status: null, to_status: 'drafted', changed_by: me.id, changed_by_name: me.full_name,
    remarks: `Quotation prepared by ${me.full_name}`,
  })
  return NextResponse.json(data, { status: 201 })
}
