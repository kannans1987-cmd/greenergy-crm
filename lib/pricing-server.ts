// Server only: imported by API routes, never by client components
import { createAdminClient } from '@/lib/supabase/server'
import { workout, customerView, type Catalogue, type CostModel, type WorkoutOpts, type Workout } from '@/lib/pricing-engine'

// Reads the private price list with the service role. Never send the result to the browser
// except through customerView() (sales) or to the CEO / admin manager.
export async function loadPricing() {
  const admin = createAdminClient()
  const { data, error } = await admin.from('pricing_config').select('key, data, version, updated_at')
  if (error) throw new Error('Could not load the price list: ' + error.message)
  const cat = data?.find((r: { key: string }) => r.key === 'catalogue')
  const model = data?.find((r: { key: string }) => r.key === 'cost_model')
  if (!cat || !model) return null
  return {
    catalogue: cat.data as Catalogue, model: model.data as CostModel,
    catalogueVersion: cat.version as number, modelVersion: model.version as number, updatedAt: cat.updated_at as string,
  }
}

export interface PriceRequest {
  kw: number; consumer_type?: string | null; solar_type?: string | null; panel_type?: string | null; roof_type?: string | null
  panel_brand?: string | null; panel_wp?: number | null; inverter_brand?: string | null; battery_qty?: number | null
  dcr_kw?: number | string | null; panel_brand_nondcr?: string | null; inverter_phase?: string | number | null
  dcr_panel_qty?: number | string | null; nondcr_panel_qty?: number | string | null; panel_wp_nondcr?: number | string | null
  inverter_choice?: string | null; inverter_qty?: number | string | null
}

export function toOpts(r: PriceRequest): WorkoutOpts {
  return {
    kw: Number(r.kw),
    segment: ['commercial', 'industrial', 'institution'].includes(String(r.consumer_type)) ? 'commercial' : 'domestic',
    type: r.panel_type === 'NonDCR' ? 'NonDCR' : r.panel_type === 'Mixed' ? 'Mixed' : 'DCR',
    dcrKw: r.panel_type === 'Mixed' && Number(r.dcr_kw) > 0 ? Number(r.dcr_kw) : null,
    nonDcrBrand: r.panel_brand_nondcr || null,
    phase: String(r.inverter_phase) === '1' ? 1 : String(r.inverter_phase) === '3' ? 3 : null,
    dcrCount: Number(r.dcr_panel_qty) > 0 ? Number(r.dcr_panel_qty) : null,
    nonDcrCount: Number(r.nondcr_panel_qty) > 0 ? Number(r.nondcr_panel_qty) : null,
    nonDcrWp: Number(r.panel_wp_nondcr) > 0 ? Number(r.panel_wp_nondcr) : null,
    inverterId: r.inverter_choice || null,
    inverterQty: Number(r.inverter_qty) > 0 ? Number(r.inverter_qty) : null,
    roof: r.roof_type === 'sheet' ? 'shed' : 'rcc',
    systemKind: r.solar_type === 'hybrid' ? 'hybrid' : 'ongrid',
    panelBrand: r.panel_brand || null,
    panelWp: r.panel_wp ? Number(r.panel_wp) : null,
    inverterBrand: r.inverter_brand || null,
    batteries: r.solar_type === 'hybrid' ? Math.max(1, Number(r.battery_qty) || 1) : 0,
  }
}

// Columns written on the quotation for a list-priced system (specification + selling price, no costs)
export function quotationColumns(w: Workout, catalogueMonth?: string | null) {
  const v = customerView(w)
  return {
    admin_capacity_kw: v.kwp, recommended_capacity_kw: v.kwp, price_per_kw: v.pricePerKwPreGst,
    panel_brand: v.panelBrand, panel_wp: v.wp, panel_count: v.panels, panel_type: v.type,
    // only for mixed systems, so single-type quotations save before quotation_panels_v1.sql is run
    ...(v.type === 'Mixed' ? { panel_mix: v.mix, dcr_kw: v.dcrKwp } : {}),
    inverter_brand: v.inverterBrand, inverter_label: v.inverterLabel, inverter_kw: v.inverterKw, system_phase: v.phase,
    battery_label: v.battery?.label ?? null, battery_qty: v.battery?.qty ?? null,
    priced_from_list: true, price_list_month: catalogueMonth ?? null,
  }
}

// Saves the internal costing for managers (service role; the table has no write policy)
export async function saveCosting(quotationId: string, w: Workout, catalogueVersion: number, modelVersion: number) {
  const admin = createAdminClient()
  await admin.from('quotation_costings').upsert({
    quotation_id: quotationId, catalogue_version: catalogueVersion, model_version: modelVersion, updated_at: new Date().toISOString(),
    data: { lines: w.lines, subtotal: w.subtotal, profit: w.profit, preGst: w.preGst, gst: w.gst, total: w.total, perKW: w.perKW,
            band: w.band, panel: w.panel, inverter: w.inverter, battery: w.battery, warnings: w.warnings },
  })
}

export { workout, customerView }
