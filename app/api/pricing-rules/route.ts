import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PUBLIC — no auth required (used by customer enquiry form to calculate estimates)
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create pricing rules.' }, { status: 403 })
  }

  const body = await req.json()
  const {
    system_type, consumer_type,
    dcr_price_per_kw, non_dcr_price_per_kw,
    panel_brand, inverter_brand,
    structure_cost_per_kw, dc_cable_cost_per_kw, ac_cable_cost_per_kw,
    earthing_cost, lightning_arrester_cost, civil_work_cost,
    net_meter_cost, eb_coordination_charges, transportation_cost,
    battery_cost_per_kwh, gst_percent,
    subsidy_1kw, subsidy_2kw, subsidy_3kw,
    peak_sun_hours, system_efficiency, electricity_tariff,
    validity_days, terms_conditions, disclaimer,
  } = body

  if (!system_type) {
    return NextResponse.json({ error: 'system_type is required.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pricing_rules')
    .insert({
      system_type,
      consumer_type:            consumer_type || null,
      dcr_price_per_kw:         dcr_price_per_kw ?? null,
      non_dcr_price_per_kw:     non_dcr_price_per_kw ?? null,
      panel_brand:              panel_brand || null,
      inverter_brand:           inverter_brand || null,
      structure_cost_per_kw:    structure_cost_per_kw ?? null,
      dc_cable_cost_per_kw:     dc_cable_cost_per_kw ?? null,
      ac_cable_cost_per_kw:     ac_cable_cost_per_kw ?? null,
      earthing_cost:            earthing_cost ?? null,
      lightning_arrester_cost:  lightning_arrester_cost ?? null,
      civil_work_cost:          civil_work_cost ?? null,
      net_meter_cost:           net_meter_cost ?? null,
      eb_coordination_charges:  eb_coordination_charges ?? null,
      transportation_cost:      transportation_cost ?? null,
      battery_cost_per_kwh:     battery_cost_per_kwh ?? null,
      gst_percent:              gst_percent ?? null,
      subsidy_1kw:              subsidy_1kw ?? null,
      subsidy_2kw:              subsidy_2kw ?? null,
      subsidy_3kw:              subsidy_3kw ?? null,
      peak_sun_hours:           peak_sun_hours ?? null,
      system_efficiency:        system_efficiency ?? null,
      electricity_tariff:       electricity_tariff ?? null,
      validity_days:            validity_days ?? null,
      terms_conditions:         terms_conditions || null,
      disclaimer:               disclaimer || null,
      updated_by:               user.id,
      updated_at:               new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
