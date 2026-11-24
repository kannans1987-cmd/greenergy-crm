import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/staff'
import { loadPricing, toOpts } from '@/lib/pricing-server'
import { workout, customerView } from '@/lib/pricing-engine'
import { buildPrice, isManager } from '@/lib/workflow'

// Price a system from the supplier price list. Sales staff get the specification and
// selling price; the CEO / admin manager also get the bill of materials, cost and margin.
export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { me } = auth
  const b = await req.json().catch(() => ({}))
  const p = await loadPricing().catch(() => null)
  if (!p) return NextResponse.json({ error: 'The price list has not been loaded yet. Ask the CEO to load it (Price List page).' }, { status: 503 })
  try {
    const w = workout(p.model, p.catalogue, toOpts(b))
    const view = customerView(w)
    const extras = Array.isArray(b.line_items)
      ? b.line_items.reduce((n: number, x: { quantity?: number; unit_price?: number }) => n + (Number(x.quantity) || 1) * (Number(x.unit_price) || 0), 0) : 0
    const money = buildPrice({ kw: view.kwp, pricePerKw: view.pricePerKwPreGst, extras, discount: Number(b.discount) || 0,
      region: b.region, consumerType: b.consumer_type, solarType: b.solar_type, panelType: view.type })
    return NextResponse.json({
      ...view, money, catalogueVersion: p.catalogueVersion, priceListMonth: p.catalogue.quoteMonth ?? null,
      ...(isManager(me.role) ? { costing: { lines: w.lines, subtotal: w.subtotal, profit: w.profit, profitPct: p.model.profitPct, band: w.band } } : {}),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not price this system.' }, { status: 400 })
  }
}
