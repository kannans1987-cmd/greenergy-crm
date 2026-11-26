import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError, canManageQuotations } from '@/lib/staff'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPrice, isManager } from '@/lib/workflow'
import { loadPricing, toOpts, quotationColumns, saveCosting } from '@/lib/pricing-server'
import { workout, type Workout } from '@/lib/pricing-engine'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const { id } = await params

  const { data: quotation, error } = await supabase
    .from('quotation_requests')
    .select(`
      *,
      assigned_sales:assigned_sales_id ( id, full_name, email, phone ),
      assigned_engineer:assigned_engineer_id ( id, full_name, email ),
      follow_up_manager:follow_up_manager_id ( id, full_name, phone )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!quotation) return NextResponse.json({ error: 'Quotation not found, or you do not have access to it.' }, { status: 404 })

  const [{ data: line_items }, { data: status_history }, { data: comments }, { data: follow_ups }] = await Promise.all([
    supabase.from('quotation_line_items').select('*').eq('quotation_id', id).order('sort_order', { ascending: true }),
    supabase.from('quotation_status_history').select('*').eq('quotation_id', id).order('created_at', { ascending: true }),
    supabase.from('quotation_comments').select('*').eq('quotation_id', id).order('created_at', { ascending: true }),
    supabase.from('quotation_follow_ups').select('*').eq('quotation_id', id).order('created_at', { ascending: false }),
  ])

  // Internal bill of materials, cost and margin: CEO and admin manager only (also enforced by RLS)
  const costing = isManager(me.role)
    ? (await supabase.from('quotation_costings').select('data, catalogue_version, updated_at').eq('quotation_id', id).maybeSingle()).data
    : null

  return NextResponse.json({
    ...quotation,
    costing,
    line_items:     line_items ?? [],
    status_history: status_history ?? [],
    comments:       comments ?? [],
    follow_ups:     follow_ups ?? [],
    me,
  })
}

// Edit a quotation. The database decides what is allowed at each stage
// (prices lock after CEO approval; only managers reassign).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const { id } = await params
  const body = await req.json()

  const FIELDS = [
    'customer_name', 'mobile', 'email', 'address', 'city', 'eb_consumer_number', 'sanctioned_load_kw',
    'avg_monthly_units', 'avg_monthly_bill', 'roof_type', 'available_roof_area_sqft', 'current_phase',
    'consumer_type', 'solar_type', 'region', 'panel_type', 'loan_required', 'site_visit_required', 'notes',
    'admin_remarks', 'priority', 'valid_until', 'source',
    'admin_capacity_kw', 'price_per_kw', 'discount',
    'panel_brand', 'panel_wp', 'inverter_brand', 'battery_qty',
  ]
  const MANAGER_FIELDS = ['assigned_sales_id', 'assigned_engineer_id', 'follow_up_manager_id']

  const updates: Record<string, unknown> = {}
  for (const f of FIELDS) if (f in body) updates[f] = body[f] === '' ? null : body[f]
  for (const f of MANAGER_FIELDS) if (f in body) {
    if (!isManager(me.role)) return NextResponse.json({ error: 'Only the CEO or admin manager can reassign a quotation.' }, { status: 403 })
    updates[f] = body[f] || null
  }
  if (!Object.keys(updates).length && !('line_items' in body) && !body.reprice) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  // Re-price from the supplier price list with the (possibly changed) size and components
  let listed: { w: Workout; cv: number; mv: number } | null = null
  if (body.reprice) {
    const p = await loadPricing().catch(() => null)
    if (!p) return NextResponse.json({ error: 'The price list has not been loaded yet.' }, { status: 503 })
    const { data: cur } = await supabase.from('quotation_requests')
      .select('admin_capacity_kw, consumer_type, solar_type, panel_type, roof_type, panel_brand, panel_wp, inverter_brand, battery_qty').eq('id', id).maybeSingle()
    if (!cur) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 })
    const spec = { ...cur, ...updates } as Record<string, unknown>
    try {
      const w = workout(p.model, p.catalogue, toOpts({ ...(spec as object), kw: Number(body.capacity_kw ?? spec.admin_capacity_kw) } as Parameters<typeof toOpts>[0]))
      const cols = quotationColumns(w, p.catalogue.quoteMonth)
      Object.assign(updates, cols)
      const override = Number(body.price_per_kw_override)
      if (override > 0) updates.price_per_kw = override
      listed = { w, cv: p.catalogueVersion, mv: p.modelVersion }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not price this system.' }, { status: 400 })
    }
  }

  // Recalculate the money from size, ₹/kW, extras and discount whenever any of them changes
  const pricingTouched = !!listed || ['admin_capacity_kw', 'price_per_kw', 'discount', 'region', 'consumer_type', 'solar_type', 'panel_type', 'line_items']
    .some(f => f in body)
  if (pricingTouched) {
    const { data: cur } = await supabase.from('quotation_requests')
      .select('admin_capacity_kw, price_per_kw, discount, region, consumer_type, solar_type, panel_type').eq('id', id).maybeSingle()
    if (!cur) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 })
    const v = { ...cur, ...updates } as Record<string, unknown>
    let extras = 0
    if (Array.isArray(body.line_items)) {
      extras = body.line_items.reduce((n: number, x: { quantity?: number; unit_price?: number }) => n + (Number(x.quantity) || 1) * (Number(x.unit_price) || 0), 0)
    } else {
      const { data: items } = await supabase.from('quotation_line_items').select('quantity, unit_price, is_included').eq('quotation_id', id)
      extras = (items ?? []).filter(x => x.is_included !== false).reduce((n, x) => n + Number(x.quantity) * Number(x.unit_price), 0)
    }
    const kw = Number(v.admin_capacity_kw), ppk = Number(v.price_per_kw)
    if (kw > 0 && ppk > 0) {
      const p = buildPrice({ kw, pricePerKw: ppk, extras, discount: Number(v.discount) || 0, region: v.region as string,
        consumerType: v.consumer_type as string, solarType: v.solar_type as string, panelType: v.panel_type as string })
      Object.assign(updates, {
        admin_system_cost: p.system, admin_gst_amount: p.gst, admin_total_cost: p.total, admin_subsidy: p.subsidy,
        admin_net_cost: p.net, central_subsidy: p.central, state_subsidy: p.state, state_subsidy_name: p.stateName || null,
        subsidy_required: p.subsidy > 0,
      })
    }
  }

  // Line items first: if the quotation is locked the database refuses before anything changes
  if (Array.isArray(body.line_items)) {
    const { error: delErr } = await supabase.from('quotation_line_items').delete().eq('quotation_id', id)
    if (delErr) return dbError(delErr)
    const rows = body.line_items
      .filter((x: { description?: string; unit_price?: number }) => String(x.description ?? '').trim() && Number(x.unit_price))
      .map((x: { description: string; quantity?: number; unit_price: number; category?: string }, i: number) => ({
        quotation_id: id, sort_order: i + 1, category: x.category || 'Extra', description: String(x.description).slice(0, 200),
        quantity: Number(x.quantity) || 1, unit: 'nos', unit_price: Number(x.unit_price), is_included: true,
      }))
    if (rows.length) {
      const { error: insErr } = await supabase.from('quotation_line_items').insert(rows)
      if (insErr) return dbError(insErr)
    }
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase.from('quotation_requests').update(updates).eq('id', id)
    if (error) return dbError(error)
    if (listed) await saveCosting(id, listed.w, listed.cv, listed.mv)
  }

  const { data } = await supabase.from('quotation_requests').select('*').eq('id', id).maybeSingle()
  return NextResponse.json(data)
}

// Delete a wrong or duplicate quotation: the CEO, or staff the CEO gave "Quotations: edit & delete".
// Never once a job card exists (the database refuses as well). A snapshot is kept in the audit log.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  const { id } = await params
  if (!canManageQuotations(me)) {
    return NextResponse.json({ error: 'Only the CEO, or staff the CEO allowed, can delete quotations.' }, { status: 403 })
  }
  const { reason } = await req.json().catch(() => ({ reason: '' }))
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
  if (!why) return NextResponse.json({ error: 'Please give a short reason for deleting.' }, { status: 400 })

  const { data: q } = await supabase.from('quotation_requests')
    .select('id, quotation_number, customer_name, mobile, city, status, source, admin_capacity_kw, recommended_capacity_kw, admin_total_cost, total_cost_before_subsidy, job_number, project_id, created_at')
    .eq('id', id).maybeSingle()
  if (!q) return NextResponse.json({ error: 'Quotation not found, or you do not have access to it.' }, { status: 404 })
  if (q.project_id || q.job_number || q.status === 'project_created') {
    return NextResponse.json({ error: `This quotation has a job card (${q.job_number ?? 'project'}) and cannot be deleted.` }, { status: 409 })
  }

  // Runs as the signed-in user, so the database's own delete rule applies
  const { data: gone, error } = await supabase.from('quotation_requests').delete().eq('id', id).select('id')
  if (error) return dbError(error)
  if (!gone?.length) return NextResponse.json({ error: 'You do not have permission to delete this quotation.' }, { status: 403 })

  const admin = createAdminClient()
  // Uploaded bill / roof photos for this quotation
  const { data: files } = await admin.storage.from('quotation-documents').list(id)
  if (files?.length) await admin.storage.from('quotation-documents').remove(files.map((f: { name: string }) => `${id}/${f.name}`))
  await admin.from('audit_log').insert({
    action_by: me.id, action_type: 'quotation_deleted', target_entity: 'quotation_requests', target_id: id,
    description: `Quotation ${q.quotation_number ?? ''} for ${q.customer_name} deleted by ${me.full_name}. Reason: ${why}`,
    metadata: { ...q, reason: why },
  })
  return NextResponse.json({ ok: true, quotation_number: q.quotation_number })
}
