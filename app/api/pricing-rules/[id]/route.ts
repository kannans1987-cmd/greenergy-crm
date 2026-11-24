import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can update pricing rules.' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const ALLOWED_FIELDS = [
    'system_type', 'consumer_type',
    'dcr_price_per_kw', 'non_dcr_price_per_kw',
    'panel_brand', 'inverter_brand',
    'structure_cost_per_kw', 'dc_cable_cost_per_kw', 'ac_cable_cost_per_kw',
    'earthing_cost', 'lightning_arrester_cost', 'civil_work_cost',
    'net_meter_cost', 'eb_coordination_charges', 'transportation_cost',
    'battery_cost_per_kwh', 'gst_percent',
    'subsidy_1kw', 'subsidy_2kw', 'subsidy_3kw',
    'peak_sun_hours', 'system_efficiency', 'electricity_tariff',
    'validity_days', 'terms_conditions', 'disclaimer',
  ]

  const updates: Record<string, unknown> = {
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }

  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field]
  }

  if (Object.keys(updates).length === 2) {
    return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('pricing_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Pricing rule not found.' }, { status: 404 })
  return NextResponse.json(data)
}
