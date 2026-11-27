// Greenergy price engine — same method as the website's staff pricing engine.
// Holds NO prices: the supplier price list and cost model live in the private
// pricing_config table (supabase/pricing_v1.sql), readable only on the server.
//
//   parts list (supplier prices, before GST) → subtotal → + profit % → + GST 8.9%
//   GST 8.9% = 70% supply at 5% + 30% installation service at 18% (from 22 Sep 2025)

/* eslint-disable @typescript-eslint/no-explicit-any */
export type PanelType = 'DCR' | 'NonDCR'
// A home system can mix DCR panels (subsidy part) with cheaper Non-DCR panels for the rest
export type PanelChoice = PanelType | 'Mixed'
export interface PanelPart { type: PanelType; id: string; brand: string; wp: number; rate: number; count: number; kwp: number; series?: string; supplier?: string }
export type Segment = 'domestic' | 'commercial'
export type Roof = 'rcc' | 'shed'

export interface Catalogue {
  quoteMonth?: string
  taxBasis?: 'exGST'   // every price in the list excludes GST
  taxNote?: string
  suppliers?: Record<string, { name: string; note?: string }>
  panels: Record<string, { supplier?: string; brand: string; series?: string; dcr: boolean; wp: number; rate: number; tech?: string; active?: boolean; preferred?: boolean }>
  inverters: Record<string, { supplier?: string; brand: string; kind?: 'ongrid' | 'hybrid'; phase: 1 | 3; kw: number; price: number; warrantyYears?: number; active?: boolean; preferred?: boolean }>
  batteries?: Record<string, { supplier?: string; brand: string; chemistry?: string; kwh: number; price: number; note?: string; active?: boolean }>
  cables: Record<string, { label: string; rate: number; unit?: string }>
  distBoxes: { fromKw: number; toKw: number | null; acdb: number; dcdb: number; note?: string }[]
  shed: { adhesive: { label?: string; actual?: number; fixed: number }; rail: { label?: string; actual?: number; fixed: number; note?: string } }
}

interface BandItem { qty: number; rate: number }
export interface CostModel {
  profitPct: number; gstPct: number; singlePhaseMaxKw: number
  dcAcRatio: Record<PanelType, number>; preferredInverterBrand: string
  bandAMaxKw: number; bandBMaxKw: number
  shed: { railsPerModule: number; extraRails: number; modulesPerAdhesiveLot: number }
  bands: Record<'A' | 'B' | 'C' | 'D', { structurePerKwp: number; installPerW: number; items: Record<string, BandItem> }>
  [k: string]: any
}

export const ITEM_DEFS = [
  { id: 'dcCable',     label: 'DC cable',                 unit: 'm' },
  { id: 'acCable',     label: 'AC cable',                 unit: 'm' },
  { id: 'earthCable',  label: 'Earth cable',              unit: 'm' },
  { id: 'earthRod',    label: 'Earth rod & chamber',      unit: 'nos' },
  { id: 'la',          label: 'Lightning arrester',       unit: 'nos' },
  { id: 'copper',      label: '10 gauge copper / strips', unit: 'nos' },
  { id: 'acdb',        label: 'ACDB',                     unit: 'nos' },
  { id: 'dcdb',        label: 'DCDB',                     unit: 'nos' },
  { id: 'ctPanel',     label: 'CT panel board',           unit: 'nos' },
  { id: 'netMeter',    label: 'Net meter',                unit: 'nos' },
  { id: 'energyMeter', label: 'Energy meter',             unit: 'nos' },
  { id: 'conduits',    label: 'Conduits',                 unit: 'm / lot' },
  { id: 'transport',   label: 'Transport',                unit: 'lot' },
  { id: 'licensing',   label: 'Licensing',                unit: 'lot' },
  { id: 'civil',       label: 'Civil blocks',             unit: 'nos / lot' },
] as const

const OVERSIZE_LIMIT = 1.5 // above this the inverter price is interpolated between listed sizes
const round2 = (v: number) => Math.round(v * 100) / 100
export const keyOf = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const values = <T,>(o: Record<string, T> | undefined) => Object.entries(o ?? {}).map(([id, v]) => ({ id, ...(v as any) })) as (T & { id: string })[]

export interface Line { id: string; label: string; qty: number; unit: string; rate: number; amount: number; note?: string }
export interface Workout {
  segment: Segment; type: PanelChoice; roof: Roof; systemKind: 'ongrid' | 'hybrid'
  parts: PanelPart[]; dcrKwp: number; phaseChosen: boolean
  panel: { id: string; brand: string; wp: number; rate: number; series?: string; supplier?: string }
  panels: number; wp: number; kwp: number; band: string; phase: 1 | 3
  inverter: { id?: string; brand?: string; kw: number; qty: number; price: number; label: string; warrantyYears?: number; interpolated?: boolean; multiple?: boolean }
  battery: { id: string; label: string; kwh: number; qty: number; price: number } | null
  lines: Line[]; warnings: string[]
  subtotal: number; profit: number; gst: number; total: number; preGst: number; perKW: number; perW: number
}

function bandFor(model: CostModel, segment: Segment, kwp: number) {
  if (segment === 'commercial') return 'D' as const
  if (kwp <= model.bandAMaxKw) return 'A' as const
  if (kwp <= model.bandBMaxKw) return 'B' as const
  return 'C' as const
}

export function panelOptions(cat: Catalogue, type: PanelType) {
  return values(cat.panels).filter(p => p.active !== false && p.rate > 0 && p.wp > 0 && (type === 'DCR') === !!p.dcr)
}

// Preferred item first, otherwise cheapest ₹/W (ties: higher wattage). A wattage can be requested too.
export function selectPanel(cat: Catalogue, type: PanelType, brand?: string | null, wp?: number | null) {
  const all = panelOptions(cat, type)
  let list = brand ? all.filter(p => keyOf(p.brand) === keyOf(brand)) : all
  let warning: string | null = brand && !list.length ? `No active ${type === 'DCR' ? 'DCR' : 'Non-DCR'} ${brand} panel in the price list; used the default.` : null
  if (!list.length) list = all
  if (wp) { const exact = list.filter(p => p.wp === wp); if (exact.length) list = exact; else warning = (warning ? warning + ' ' : '') + `No ${wp} Wp panel listed; used the nearest option.` }
  if (!list.length) return null
  list.sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || a.rate - b.rate || b.wp - a.wp)
  return { ...list[0], warning }
}

type Inv = Catalogue['inverters'][string] & { id: string }
// Smallest listed size that fits; interpolated price if badly oversized; several of the largest if nothing fits
export function pickInverter(inverters: Inv[], requiredKw: number): Workout['inverter'] & { warning?: string } {
  const list = inverters.filter(i => i.kw > 0 && i.price >= 0).slice().sort((a, b) => a.kw - b.kw || a.price - b.price)
  if (!list.length) return { kw: 0, qty: 0, price: 0, label: 'No inverter in the price list', warning: 'Inverter list is empty' }
  const largest = list[list.length - 1]
  const one = (i: Inv) => ({ kw: i.kw, qty: 1, price: i.price, label: `${i.brand} ${i.kw} kW`, id: i.id, brand: i.brand, warrantyYears: i.warrantyYears })
  if (requiredKw <= list[0].kw) return one(list[0])
  const fitIdx = list.findIndex(i => i.kw >= requiredKw)
  if (fitIdx === -1) {
    const qty = Math.ceil(requiredKw / largest.kw)
    return { ...one(largest), kw: largest.kw * qty, qty, price: largest.price * qty, label: `${qty} × ${largest.brand} ${largest.kw} kW`, multiple: true }
  }
  const fit = list[fitIdx]
  if (fit.kw <= requiredKw * OVERSIZE_LIMIT || fitIdx === 0) return one(fit)
  const lo = list[fitIdx - 1]
  const price = Math.round(lo.price + (requiredKw - lo.kw) / (fit.kw - lo.kw) * (fit.price - lo.price))
  const kw = Math.ceil(requiredKw * 10) / 10
  return { ...one(fit), kw, price, label: `${fit.brand} ≈${kw} kW`, interpolated: true,
    warning: `No ${fit.brand} inverter between ${lo.kw} and ${fit.kw} kW in the price list; price interpolated — confirm the real model.` }
}

export function selectInverter(model: CostModel, cat: Catalogue, kind: 'ongrid' | 'hybrid', phase: 1 | 3, requiredKw: number, brand?: string | null, phaseChosen = false) {
  // Hybrid units: any phase unless a phase was chosen on the quotation
  const all = values(cat.inverters).filter(i => i.active !== false && (i.kind ?? 'ongrid') === kind && ((kind === 'hybrid' && !phaseChosen) || i.phase === phase)) as Inv[]
  const want = brand || model.preferredInverterBrand
  let list = all.filter(i => keyOf(i.brand) === keyOf(want))
  let warning: string | null = null
  if (!list.length) {
    if (brand || kind === 'ongrid') warning = `No active ${kind === 'hybrid' ? 'hybrid' : phase + '-phase'} ${want} inverter in the price list; used the cheapest available.`
    list = all
  }
  // single-phase on-grid units above the single-phase limit are never offered
  if (kind === 'ongrid' && phase === 1) list = list.filter(i => i.kw <= model.singlePhaseMaxKw)
  if (!list.length) return { kw: 0, qty: 0, price: 0, label: `No ${phase}-phase ${kind === 'hybrid' ? 'hybrid' : 'on-grid'} inverter in the price list`, warning: `No ${phase}-phase ${kind === 'hybrid' ? 'hybrid' : 'on-grid'} inverter in the price list. Choose the other phase, or add one to the price list.` }
  const pick = pickInverter(list, requiredKw)
  if (warning) pick.warning = pick.warning ? warning + ' ' + pick.warning : warning
  return pick
}

// AC cable size by inverter output current (voltage drop under 2%)
function acCableSqmm(phase: number, invKw: number) {
  if (phase === 1) return invKw <= 3.6 ? 4 : 6
  if (invKw <= 12) return 4
  if (invKw <= 20) return 6
  return null // larger cable not in the price list: band rate is used
}

function distBoxFor(cat: Catalogue, kw: number) {
  const bands = (cat.distBoxes ?? []).slice().sort((a, b) => a.fromKw - b.fromKw)
  const upper = (b: (typeof bands)[number], i: number) => Math.min(b.toKw == null ? Infinity : b.toKw, bands[i + 1] ? bands[i + 1].fromKw : Infinity)
  return bands.find((b, i) => kw <= upper(b, i)) ?? bands[bands.length - 1] ?? null
}

export interface WorkoutOpts {
  kw: number; segment?: Segment; type?: PanelChoice; roof?: Roof; systemKind?: 'ongrid' | 'hybrid'
  panelBrand?: string | null; panelWp?: number | null; inverterBrand?: string | null; batteries?: number; batteryId?: string | null
  dcrKw?: number | null                                   // Mixed: kW of DCR panels; the rest is Non-DCR
  nonDcrBrand?: string | null; nonDcrWp?: number | null   // Mixed: the Non-DCR panel
  phase?: 1 | 3 | null                                    // inverter phase chosen on the quotation (null = automatic)
  // Chosen by hand on the quotation (empty = worked out from the size):
  dcrCount?: number | null; nonDcrCount?: number | null   // number of DCR / Non-DCR panels
  inverterId?: string | null                              // a model from the price list
  inverterQty?: number | null                             // how many inverters
}

// Full internal workout for one system (costs and margin — never sent to sales staff or customers)
export function workout(model: CostModel, cat: Catalogue, opts: WorkoutOpts): Workout {
  const segment: Segment = opts.segment === 'commercial' ? 'commercial' : 'domestic'
  const type: PanelChoice = segment === 'commercial' ? 'NonDCR' : opts.type === 'NonDCR' ? 'NonDCR' : opts.type === 'Mixed' ? 'Mixed' : 'DCR'
  const roof: Roof = opts.roof === 'shed' ? 'shed' : 'rcc'
  const systemKind = opts.systemKind === 'hybrid' ? 'hybrid' : 'ongrid'
  const warnings: string[] = []
  const dcrCount = Math.round(Number(opts.dcrCount) || 0), nonCount = Math.round(Number(opts.nonDcrCount) || 0)
  const byCount = dcrCount > 0 || nonCount > 0
  if (dcrCount < 0 || nonCount < 0 || dcrCount > 5000 || nonCount > 5000) throw new Error('Enter a sensible number of panels.')
  if (!byCount && !(opts.kw > 0)) throw new Error('Enter the system size in kW, or the number of panels.')

  // Panels: one type, or DCR for part of the size and Non-DCR for the rest
  const pick = (t: PanelType, brand?: string | null, wpWant?: number | null) => {
    const p = selectPanel(cat, t, brand, wpWant)
    if (!p) throw new Error(`No active ${t === 'DCR' ? 'DCR' : 'Non-DCR'} panel in the price list.`)
    if (p.warning) warnings.push(p.warning)
    return p
  }
  const part = (t: PanelType, p: ReturnType<typeof pick>, kw: number, exact?: number): PanelPart => {
    const count = exact && exact > 0 ? exact : Math.max(1, Math.ceil(kw * 1000 / p.wp - 1e-9))
    return { type: t, id: p.id, brand: p.brand, wp: p.wp, rate: p.rate, count, kwp: round2(count * p.wp / 1000), series: p.series, supplier: p.supplier }
  }
  let parts: PanelPart[]
  if (byCount) {
    // The number of panels was chosen: that decides the size (commercial systems are Non-DCR only)
    if (segment === 'commercial' && dcrCount > 0) throw new Error('Commercial systems use Non-DCR panels only: enter the Non-DCR panel count.')
    if (type === 'Mixed' && !(dcrCount > 0 && nonCount > 0)) throw new Error('For mixed panels, enter both the number of DCR panels and of Non-DCR panels.')
    if (type === 'DCR' && !(dcrCount > 0)) throw new Error('Enter the number of DCR panels.')
    if (type === 'NonDCR' && !(nonCount > 0)) throw new Error('Enter the number of Non-DCR panels.')
    parts = []
    if (type !== 'NonDCR') parts.push(part('DCR', pick('DCR', opts.panelBrand, opts.panelWp), 0, dcrCount))
    if (type !== 'DCR') parts.push(part('NonDCR', pick('NonDCR', type === 'Mixed' ? opts.nonDcrBrand : opts.panelBrand, type === 'Mixed' ? opts.nonDcrWp : opts.panelWp), 0, nonCount))
  } else if (type === 'Mixed') {
    const dcrKw = Number(opts.dcrKw)
    if (!(dcrKw > 0) || dcrKw >= opts.kw) throw new Error(`For mixed panels, enter the DCR part in kW (more than 0 and less than the total ${opts.kw} kW).`)
    parts = [part('DCR', pick('DCR', opts.panelBrand, opts.panelWp), dcrKw),
             part('NonDCR', pick('NonDCR', opts.nonDcrBrand, opts.nonDcrWp), opts.kw - dcrKw)]
  } else {
    parts = [part(type, pick(type, opts.panelBrand, opts.panelWp), opts.kw)]
  }
  const panel = parts[0]
  const wp = panel.wp, rate = panel.rate
  const count = parts.reduce((n, p) => n + p.count, 0)
  const watts = parts.reduce((n, p) => n + p.count * p.wp, 0)
  const kwp = watts / 1000
  const dcrKwp = round2(parts.filter(p => p.type === 'DCR').reduce((n, p) => n + p.kwp, 0))
  const band = bandFor(model, segment, kwp)
  const b = model.bands[band]
  const required = parts.reduce((n, p) => n + p.count * p.wp / 1000 / model.dcAcRatio[p.type], 0)
  const phaseChosen = opts.phase === 1 || opts.phase === 3
  const phase: 1 | 3 = phaseChosen ? opts.phase as 1 | 3
    : systemKind === 'hybrid' ? 1 : segment === 'domestic' && required <= model.singlePhaseMaxKw ? 1 : 3
  // Inverter: a model and quantity chosen by hand, or the best fit from the price list
  const invQty = Math.max(1, Math.min(50, Math.round(Number(opts.inverterQty) || 1)))
  let inv: ReturnType<typeof selectInverter>
  let invPhase: 1 | 3 = phase
  if (opts.inverterId) {
    const m = values(cat.inverters).find(i => i.id === opts.inverterId && i.active !== false) as Inv | undefined
    if (!m) throw new Error('That inverter is no longer in the price list. Choose another.')
    if ((m.kind ?? 'ongrid') !== systemKind) warnings.push(`${m.brand} ${m.kw} kW is ${(m.kind ?? 'ongrid') === 'hybrid' ? 'a hybrid' : 'an on-grid'} inverter but the system is ${systemKind === 'hybrid' ? 'hybrid' : 'on-grid'}.`)
    invPhase = m.phase
    inv = { id: m.id, brand: m.brand, kw: m.kw * invQty, qty: invQty, price: m.price * invQty, warrantyYears: m.warrantyYears,
            label: invQty > 1 ? `${invQty} × ${m.brand} ${m.kw} kW` : `${m.brand} ${m.kw} kW`, multiple: invQty > 1 }
  } else if (invQty > 1) {
    const one = selectInverter(model, cat, systemKind, phase, required / invQty, opts.inverterBrand, phaseChosen)
    inv = { ...one, kw: one.kw * invQty, qty: (one.qty || 1) * invQty, price: one.price * invQty,
            label: `${invQty} × ${one.label.replace(/^\d+ × /, '')}`, multiple: true }
  } else {
    inv = selectInverter(model, cat, systemKind, phase, required, opts.inverterBrand, phaseChosen)
  }
  if (inv.warning) warnings.push(inv.warning)
  // The phase shown is the one of the inverter actually picked
  if (inv.id && cat.inverters[inv.id]) invPhase = cat.inverters[inv.id].phase
  if (inv.kw > 0 && inv.kw < required / 1.35) warnings.push(`The inverter (${round2(inv.kw)} kW) is small for ${round2(kwp)} kWp of panels; about ${round2(required)} kW is normal.`)
  if (inv.kw > required * 1.6 + 1) warnings.push(`The inverter (${round2(inv.kw)} kW) is much bigger than ${round2(kwp)} kWp of panels needs (about ${round2(required)} kW).`)
  if (phaseChosen && phase === 1 && systemKind === 'ongrid' && required > model.singlePhaseMaxKw) {
    warnings.push(`Single-phase for ${round2(required)} kW of inverter: above ${model.singlePhaseMaxKw} kW the EB normally asks for a three-phase connection.`)
  }

  let battery: Workout['battery'] = null
  if (systemKind === 'hybrid') {
    const bats = values(cat.batteries).filter(x => x.active !== false)
    const bat = bats.find(x => x.id === opts.batteryId) ?? bats.sort((x, y) => x.price - y.price)[0]
    const qty = Math.max(0, Math.round(opts.batteries ?? 1))
    if (!bat && qty) warnings.push('No battery in the price list.')
    if (bat && qty) battery = { id: bat.id, label: `${bat.brand} ${bat.chemistry ?? ''} battery ${bat.kwh} kWh`.replace('  ', ' '), kwh: bat.kwh * qty, qty, price: bat.price * qty }
  }

  const structure: Line[] = roof === 'shed'
    ? (() => {
        const s = model.shed, rail = cat.shed.rail, adh = cat.shed.adhesive
        const rails = count * s.railsPerModule + s.extraRails
        const lots = Math.ceil(count / s.modulesPerAdhesiveLot)
        return [
          { id: 'rails', label: 'Shed rails', qty: rails, unit: 'nos', rate: rail.fixed, amount: rails * rail.fixed },
          { id: 'adhesive', label: 'Shed adhesive', qty: lots, unit: 'lot', rate: adh.fixed, amount: lots * adh.fixed },
        ]
      })()
    : [{ id: 'structure', label: 'Mounting structure (RCC)', qty: Math.round(kwp), unit: 'kWp', rate: b.structurePerKwp, amount: Math.round(kwp) * b.structurePerKwp }]

  const sq = acCableSqmm(invPhase, inv.kw / (inv.qty || 1))
  const acRate = sq && cat.cables?.['ac' + sq] ? cat.cables['ac' + sq].rate : null
  const earthRate = cat.cables?.earth6 ? cat.cables.earth6.rate : null
  const box = distBoxFor(cat, inv.kw)
  const override: Record<string, number | null | undefined> = { acCable: acRate, earthCable: earthRate, acdb: box?.acdb, dcdb: box?.dcdb }
  const noteFor: Record<string, string> = { acCable: sq && acRate ? `${sq} sq.mm` : 'band rate', earthCable: earthRate ? '6 sq.mm' : '',
    acdb: box ? `${box.fromKw}–${box.toKw ?? '+'} kW band` : '', dcdb: box ? `${box.fromKw}–${box.toKw ?? '+'} kW band` : '' }

  const lines: Line[] = [
    ...parts.map((p, i) => ({ id: i === 0 ? 'panels' : 'panels_' + p.type.toLowerCase(), label: `Solar panels — ${p.brand} ${p.type === 'DCR' ? 'DCR' : 'Non-DCR'} ${p.wp} Wp`,
      qty: p.count * p.wp, unit: 'W', rate: p.rate, amount: p.count * p.wp * p.rate, note: `${p.count} × ${p.wp} Wp` })),
    { id: 'inverter', label: `${systemKind === 'hybrid' ? 'Hybrid inverter' : 'Inverter'} (${invPhase}-phase)`, qty: inv.qty, unit: 'nos', rate: inv.qty ? inv.price / inv.qty : 0, amount: inv.price, note: inv.label },
    ...(battery ? [{ id: 'battery', label: 'Battery', qty: battery.qty, unit: 'nos', rate: battery.price / battery.qty, amount: battery.price, note: battery.label }] : []),
    ...structure,
    { id: 'installation', label: 'Installation', qty: watts, unit: 'W', rate: b.installPerW, amount: watts * b.installPerW },
    ...ITEM_DEFS.map(d => {
      const it = b.items?.[d.id] ?? { qty: 0, rate: 0 }
      const r = override[d.id] != null ? Number(override[d.id]) : it.rate
      return { id: d.id, label: d.label, qty: it.qty, unit: d.unit, rate: r, amount: it.qty * r, note: override[d.id] != null ? noteFor[d.id] : '' }
    }).filter(l => l.qty > 0),
  ]
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const profit = subtotal * model.profitPct / 100
  const preGst = subtotal + profit
  const gst = preGst * model.gstPct / 100
  const total = preGst + gst
  return {
    segment, type, roof, systemKind, parts, dcrKwp, phaseChosen,
    panel: { id: panel.id, brand: panel.brand, wp, rate, series: panel.series, supplier: panel.supplier },
    panels: count, wp, kwp: round2(kwp), band, phase: invPhase, inverter: inv, battery, lines, warnings,
    subtotal: round2(subtotal), profit: round2(profit), gst: round2(gst), total: round2(total), preGst: round2(preGst),
    perKW: Math.round(total / kwp), perW: round2(total / watts),
  }
}

// What sales staff and customers may see: the specification and the selling price — no costs or margin
export function customerView(w: Workout) {
  return {
    segment: w.segment, type: w.type, roof: w.roof, systemKind: w.systemKind, band: w.band, phase: w.phase,
    kwp: w.kwp, panels: w.panels, wp: w.wp, panelBrand: w.parts.length > 1 ? w.parts.map(p => p.brand).filter((x, i, a) => a.indexOf(x) === i).join(' + ') : w.panel.brand,
    panelSeries: w.panel.series ?? null, dcrKwp: w.dcrKwp,
    mix: w.parts.map(p => ({ type: p.type, brand: p.brand, wp: p.wp, count: p.count, kwp: p.kwp })),
    inverterLabel: w.inverter.label, inverterBrand: w.inverter.brand ?? null, inverterKw: w.inverter.kw, inverterWarrantyYears: w.inverter.warrantyYears ?? null,
    battery: w.battery ? { label: w.battery.label, qty: w.battery.qty, kwh: w.battery.kwh } : null,
    pricePerKwPreGst: Math.round(w.preGst / w.kwp), preGst: Math.round(w.preGst), gst: Math.round(w.gst), total: Math.round(w.total),
    warnings: w.warnings,
  }
}

// Brands and wattages on offer (no prices) for the quotation form
export function catalogueOptions(cat: Catalogue) {
  const panels = values(cat.panels).filter(p => p.active !== false)
  const inverters = values(cat.inverters).filter(i => i.active !== false)
  const uniq = (a: string[]) => Array.from(new Set(a)).sort()
  return {
    quoteMonth: cat.quoteMonth ?? null,
    panelBrands: { DCR: uniq(panels.filter(p => p.dcr).map(p => p.brand)), NonDCR: uniq(panels.filter(p => !p.dcr).map(p => p.brand)) },
    panelSizes: panels.map(p => ({ brand: p.brand, dcr: p.dcr, wp: p.wp })),
    inverterBrands: { ongrid: uniq(inverters.filter(i => (i.kind ?? 'ongrid') === 'ongrid').map(i => i.brand)), hybrid: uniq(inverters.filter(i => i.kind === 'hybrid').map(i => i.brand)) },
    batteries: values(cat.batteries).filter(x => x.active !== false).map(x => ({ id: x.id, label: `${x.brand} ${x.chemistry ?? ''} ${x.kwh} kWh`.replace('  ', ' ') })),
    inverters: inverters.filter(i => i.kw > 0).map(i => ({ id: i.id, brand: i.brand, kw: i.kw, phase: i.phase, kind: i.kind ?? 'ongrid' }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.phase - b.phase || a.brand.localeCompare(b.brand) || a.kw - b.kw),
  }
}

export function validateCatalogue(c: Catalogue): string[] {
  const e: string[] = []
  const num = (v: unknown, lo: number, hi: number, name: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) e.push(`${name} must be a number from ${lo} to ${hi}`) }
  if (!c || typeof c !== 'object') return ['Price list is missing']
  values(c.panels).forEach(p => { num(p.wp, 200, 1000, `Panel ${p.id} wattage`); num(p.rate, 5, 80, `Panel ${p.id} ₹/W`) })
  values(c.inverters).forEach(i => { num(i.kw, 0.5, 2000, `Inverter ${i.id} size`); num(i.price, 0, 5000000, `Inverter ${i.id} price`); if (i.phase !== 1 && i.phase !== 3) e.push(`Inverter ${i.id} phase must be 1 or 3`) })
  values(c.batteries).forEach(x => { num(x.kwh, 0.5, 1000, `Battery ${x.id} kWh`); num(x.price, 0, 5000000, `Battery ${x.id} price`) })
  if (!panelOptions(c, 'DCR').length) e.push('No active DCR panel')
  if (!panelOptions(c, 'NonDCR').length) e.push('No active Non-DCR panel')
  if (!values(c.inverters).some(i => i.active !== false && (i.kind ?? 'ongrid') === 'ongrid' && i.phase === 1)) e.push('No active single-phase on-grid inverter')
  if (!values(c.inverters).some(i => i.active !== false && (i.kind ?? 'ongrid') === 'ongrid' && i.phase === 3)) e.push('No active three-phase on-grid inverter')
  for (const k of ['ac4', 'ac6', 'earth6']) num(c.cables?.[k]?.rate, 0, 10000, `Cable ${k} rate`)
  if (!Array.isArray(c.distBoxes) || !c.distBoxes.length) e.push('Add at least one ACDB/DCDB band')
  num(c.shed?.rail?.fixed, 0, 100000, 'Shed rail price'); num(c.shed?.adhesive?.fixed, 0, 100000, 'Shed adhesive price')
  return e
}

export function validateModel(m: CostModel): string[] {
  const e: string[] = []
  const num = (v: unknown, lo: number, hi: number, name: string) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) e.push(`${name} must be a number from ${lo} to ${hi}`) }
  num(m?.profitPct, 0, 60, 'Profit %'); num(m?.gstPct, 0, 28, 'GST %'); num(m?.singlePhaseMaxKw, 1, 20, 'Single-phase limit')
  num(m?.dcAcRatio?.DCR, 0.8, 1.6, 'DC:AC ratio (DCR)'); num(m?.dcAcRatio?.NonDCR, 0.8, 1.6, 'DC:AC ratio (Non-DCR)')
  num(m?.bandAMaxKw, 1, 100, 'Band A limit'); num(m?.bandBMaxKw, m?.bandAMaxKw || 1, 200, 'Band B limit')
  for (const bk of ['A', 'B', 'C', 'D'] as const) {
    const b = m?.bands?.[bk]
    if (!b) { e.push(`Band ${bk} is missing`); continue }
    num(b.structurePerKwp, 0, 50000, `Band ${bk} structure rate`); num(b.installPerW, 0, 50, `Band ${bk} installation rate`)
  }
  return e
}
