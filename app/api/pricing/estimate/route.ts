import { NextRequest, NextResponse } from 'next/server'
import { loadPricing, toOpts } from '@/lib/pricing-server'
import { workout, customerView } from '@/lib/pricing-engine'
import { buildPrice, subsidyEligible } from '@/lib/workflow'

// PUBLIC price estimate for the customer quote form (no login).
// Uses the current supplier price list but returns only the selling price and the
// system specification — never costs, margin or supplier names.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const kw = Number(b.kw)
  if (!(kw > 0 && kw <= 1000)) return NextResponse.json({ error: 'Enter a system size between 0.5 and 1000 kW.' }, { status: 400 })
  if (!['ongrid', 'hybrid', 'not_sure', '', undefined, null].includes(b.solar_type)) {
    return NextResponse.json({ available: false })   // off-grid and pumps are priced after a site visit
  }
  const p = await loadPricing().catch(() => null)
  if (!p) return NextResponse.json({ available: false })
  try {
    const subsidy = b.subsidy_required === 'yes' && subsidyEligible(b.consumer_type, b.solar_type || 'ongrid', 'DCR')
    const w = workout(p.model, p.catalogue, toOpts({ kw, consumer_type: b.consumer_type, solar_type: b.solar_type === 'hybrid' ? 'hybrid' : 'ongrid',
      // Like the website quote page: DCR panels when the customer wants the subsidy, otherwise Non-DCR
      panel_type: subsidy ? 'DCR' : 'NonDCR', roof_type: b.roof_type }))
    const v = customerView(w)
    const money = buildPrice({ kw: v.kwp, pricePerKw: v.pricePerKwPreGst, region: b.region, consumerType: b.consumer_type,
      solarType: b.solar_type || 'ongrid', panelType: subsidy ? v.type : 'NonDCR' })
    return NextResponse.json({
      available: true, priceList: p.catalogue.quoteMonth ?? null,
      kwp: v.kwp, panels: v.panels, wp: v.wp, panelBrand: v.panelBrand, panelType: v.type, inverterLabel: v.inverterLabel,
      battery: v.battery, systemCost: money.system, gst: money.gst, total: money.total,
      centralSubsidy: money.central, stateSubsidy: money.state, stateName: money.stateName, net: money.net,
    })
  } catch {
    return NextResponse.json({ available: false })
  }
}
