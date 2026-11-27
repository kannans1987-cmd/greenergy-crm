import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Public customer portal API (no login). Reads through the service role, so it
// only ever returns customer-safe fields — never internal remarks or staff notes.
//   GET /api/portal?mobile=9943256109&number=GSS-QT-2026-1001 → { portal_token }
//   GET /api/portal?token=<uuid>                              → quotation for the customer
export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const url    = new URL(req.url)
  const mobile = url.searchParams.get('mobile')?.replace(/\D/g, '').slice(-10)
  const number = url.searchParams.get('number')?.trim().toUpperCase()
  const token  = url.searchParams.get('token')

  // Both the mobile number and the quotation number are needed, so knowing
  // someone's phone number alone does not reveal their quotation.
  if (mobile || number) {
    if (!mobile || mobile.length !== 10 || !number) {
      return NextResponse.json({ error: 'Enter your 10-digit mobile number and your quotation number.' }, { status: 400 })
    }
    const { data } = await supabase
      .from('quotation_requests')
      .select('portal_token, mobile')
      .eq('quotation_number', number)
      .maybeSingle()
    if (!data || String(data.mobile).replace(/\D/g, '').slice(-10) !== mobile) {
      return NextResponse.json({ error: 'No quotation matches this mobile number and quotation number.' }, { status: 404 })
    }
    return NextResponse.json({ portal_token: data.portal_token })
  }

  if (token) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
    const { data: quotation, error } = await supabase
      .from('quotation_requests')
      .select(`
        id, quotation_number, revision, customer_name, city, region,
        consumer_type, solar_type, panel_type, status,
        recommended_capacity_kw, admin_capacity_kw, estimated_monthly_savings, estimated_yearly_savings,
        estimated_payback_years, price_per_kw, discount,
        admin_system_cost, admin_gst_amount, admin_total_cost, admin_subsidy, admin_net_cost,
        central_subsidy, state_subsidy, state_subsidy_name,
        total_cost_before_subsidy, subsidy_applicable, net_cost_after_subsidy,
        rejection_reason, more_info_request, valid_until,
        approved_at, sent_to_customer_at, customer_response_at, accepted_by_name, accepted_via,
        loan_required, subsidy_required, site_visit_required, job_number,
        panel_brand, panel_wp, panel_count, inverter_label, system_phase, battery_label, battery_qty,
        created_at, updated_at, project_id,
        assigned_sales:assigned_sales_id ( full_name, phone )
      `)
      .eq('portal_token', token)
      .maybeSingle()

    if (error || !quotation) {
      return NextResponse.json({ error: 'This link is no longer valid — the quotation may have been revised. Please contact us for the latest link.' }, { status: 404 })
    }

    const { data: lineItems } = await supabase
      .from('quotation_line_items')
      .select('description, quantity, unit, unit_price, category')
      .eq('quotation_id', quotation.id)
      .eq('is_included', true)
      .order('sort_order')

    const { data: history } = await supabase
      .from('quotation_status_history')
      .select('to_status, created_at')
      .eq('quotation_id', quotation.id)
      .order('created_at', { ascending: true })

    let projectStages = null, payments = null
    if (quotation.project_id) {
      const [{ data: stages }, { data: pmts }] = await Promise.all([
        supabase.from('project_stage_history').select('stage_name, phase, status, planned_date, actual_date, completed_at, sort_order')
          .eq('project_id', quotation.project_id).neq('status', 'skipped').order('sort_order'),
        supabase.from('project_payments').select('milestone_name, amount, status, paid_date')
          .eq('project_id', quotation.project_id).order('created_at'),
      ])
      projectStages = stages; payments = pmts
    }

    // Mixed DCR + Non-DCR panels (quotation_panels_v1.sql); read separately so the link works before that update
    const { data: mix } = await supabase.from('quotation_requests').select('panel_mix, dcr_kw').eq('id', quotation.id).maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, project_id: _p, ...safe } = quotation
    return NextResponse.json({
      quotation: { ...safe, panel_mix: mix?.panel_mix ?? null, dcr_kw: mix?.dcr_kw ?? null },
      lineItems:     lineItems     ?? [],
      history:       history       ?? [],
      projectStages: projectStages ?? [],
      payments:      payments      ?? [],
    })
  }

  return NextResponse.json({ error: 'Provide your mobile and quotation number, or open the link we sent you.' }, { status: 400 })
}
