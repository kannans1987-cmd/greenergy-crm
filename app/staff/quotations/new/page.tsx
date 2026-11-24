'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'
import Header from '@/components/staff/Header'
import CostingTable, { type Costing } from '@/components/staff/CostingTable'
import { buildPrice, inr, REGION_LABELS, GST_NOTE, SUBSIDY_CHECKED, ROLE_LABELS, isManager, type Role } from '@/lib/workflow'

interface Rule { system_type: string; consumer_type: string; dcr_price_per_kw: number; non_dcr_price_per_kw: number }
interface Person { id: string; full_name: string; role: Role }
interface Options { available: boolean; quoteMonth?: string | null; panelBrands?: { DCR: string[]; NonDCR: string[] }
  panelSizes?: { brand: string; dcr: boolean; wp: number }[]; inverterBrands?: { ongrid: string[]; hybrid: string[] }; batteries?: { id: string; label: string }[] }
interface Priced { kwp: number; panels: number; wp: number; panelBrand: string; inverterLabel: string; inverterWarrantyYears: number | null; phase: number
  battery: { label: string; qty: number; kwh: number } | null; pricePerKwPreGst: number; warnings: string[]; type: string; priceListMonth: string | null
  money: ReturnType<typeof buildPrice>; costing?: Costing }

const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white disabled:bg-slate-50'
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-5'
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}</label>
}

export default function NewQuotationPage() {
  const router = useRouter()
  const [rules, setRules] = useState<Rule[]>([])
  const [opts, setOpts] = useState<Options | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [myRole, setMyRole] = useState<Role>('employee')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [priced, setPriced] = useState<Priced | null>(null)
  const [pricing, setPricing] = useState(false)
  const [priceErr, setPriceErr] = useState('')
  const [f, setF] = useState({
    customer_name: '', mobile: '', email: '', city: '', address: '', eb_consumer_number: '',
    region: 'puducherry', consumer_type: 'domestic', solar_type: 'ongrid', panel_type: 'DCR',
    capacity_kw: '3', price_per_kw: '', price_per_kw_override: '', discount: '0', sanctioned_load_kw: '', avg_monthly_units: '',
    roof_type: 'rcc', current_phase: 'single', source: 'walk_in', priority: 'normal', notes: '',
    panel_brand: '', panel_wp: '', inverter_brand: '', battery_qty: '1',
    loan_required: false, follow_up_manager_id: '', assigned_sales_id: '',
  })
  const [items, setItems] = useState<{ description: string; quantity: number; unit_price: number }[]>([])
  const set = (k: string, v: string | boolean) => setF(x => ({ ...x, [k]: v }))
  const useList = !!opts?.available && f.solar_type !== 'offgrid' && f.solar_type !== 'solar_pump'

  useEffect(() => {
    fetch('/api/pricing/options').then(r => r.ok ? r.json() : { available: false }).then(setOpts).catch(() => setOpts({ available: false }))
    fetch('/api/pricing-rules').then(r => r.ok ? r.json() : []).then(setRules).catch(() => {})
    fetch('/api/profiles').then(r => r.ok ? r.json() : { profiles: [] }).then(d => setPeople(d.profiles ?? [])).catch(() => {})
    fetch('/api/profiles?me=1').then(r => r.ok ? r.json() : null).then(d => d?.me && setMyRole(d.me.role)).catch(() => {})
  }, [])

  // Live price from the supplier price list (debounced)
  const extras = items.reduce((n, x) => n + (x.quantity || 1) * (x.unit_price || 0), 0)
  useEffect(() => {
    if (!useList || !(Number(f.capacity_kw) > 0)) { setPriced(null); return }
    const t = setTimeout(async () => {
      setPricing(true); setPriceErr('')
      try {
        const r = await fetch('/api/pricing/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          kw: Number(f.capacity_kw), consumer_type: f.consumer_type, solar_type: f.solar_type, panel_type: f.panel_type, roof_type: f.roof_type,
          panel_brand: f.panel_brand || null, panel_wp: Number(f.panel_wp) || null, inverter_brand: f.inverter_brand || null,
          battery_qty: Number(f.battery_qty) || 1, region: f.region, discount: Number(f.discount) || 0, line_items: items }) })
        const d = await r.json()
        if (!r.ok) { setPriced(null); setPriceErr(d.error ?? 'Could not price this system.') } else setPriced(d)
      } catch { setPriceErr('Could not reach the price list.') }
      finally { setPricing(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [useList, f.capacity_kw, f.consumer_type, f.solar_type, f.panel_type, f.roof_type, f.panel_brand, f.panel_wp, f.inverter_brand, f.battery_qty, f.region, f.discount, items])

  // Fallback ₹/kW from Pricing Settings when the price list is not loaded (or for off-grid / pumps)
  const suggested = useMemo(() => {
    const r = rules.find(x => x.system_type === f.solar_type && x.consumer_type === f.consumer_type) ?? rules.find(x => x.system_type === f.solar_type)
    return r ? (f.panel_type === 'DCR' ? r.dcr_price_per_kw : r.non_dcr_price_per_kw) : null
  }, [rules, f.solar_type, f.consumer_type, f.panel_type])

  const override = Number(f.price_per_kw_override) || 0
  const kw = useList && priced ? priced.kwp : Number(f.capacity_kw)
  const ppk = override || (useList && priced ? priced.pricePerKwPreGst : Number(f.price_per_kw) || suggested || 0)
  const p = kw > 0 && ppk > 0 ? buildPrice({ kw, pricePerKw: ppk, extras, discount: Number(f.discount) || 0,
    region: f.region, consumerType: f.consumer_type, solarType: f.solar_type, panelType: useList && priced ? priced.type : f.panel_type }) : null

  const type = f.consumer_type === 'domestic' ? f.panel_type : 'NonDCR'
  const brands = opts?.panelBrands?.[type as 'DCR' | 'NonDCR'] ?? []
  const sizes = (opts?.panelSizes ?? []).filter(s => s.dcr === (type === 'DCR') && (!f.panel_brand || s.brand === f.panel_brand)).map(s => s.wp)
  const invBrands = opts?.inverterBrands?.[f.solar_type === 'hybrid' ? 'hybrid' : 'ongrid'] ?? []

  async function save() {
    setError('')
    if (!f.customer_name.trim() || !/^[0-9+\-\s]{10,16}$/.test(f.mobile.trim())) return setError('Enter the customer name and a valid mobile number.')
    if (!p) return setError(useList ? (priceErr || 'Waiting for the price.') : 'Enter the system size and price per kW.')
    setSaving(true)
    try {
      const r = await fetch('/api/quotations/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, use_price_list: useList, price_per_kw: ppk, price_per_kw_override: override || null,
          panel_wp: Number(f.panel_wp) || null, battery_qty: Number(f.battery_qty) || null, line_items: items }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not save.')
      router.push(`/staff/quotations/${d.id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false) }
  }

  const managers = people.filter(x => x.role === 'task_manager' || x.role === 'admin')
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="New quotation" subtitle="Priced from the current supplier price list. Saved as a draft; submit it for CEO approval when it is ready." />
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
        <Link href="/staff/quotations" className="inline-flex items-center gap-1 text-sm text-slate-500 mb-4 hover:text-slate-800"><ArrowLeft size={14} /> Quotations</Link>
        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex-1 space-y-5">
            <section className={CARD}><h2 className="font-semibold text-sm mb-3">Customer</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Name *"><input className={INPUT} value={f.customer_name} onChange={e => set('customer_name', e.target.value)} maxLength={120} /></Field>
                <Field label="Mobile *"><input className={INPUT} value={f.mobile} onChange={e => set('mobile', e.target.value)} inputMode="tel" maxLength={16} /></Field>
                <Field label="Email"><input className={INPUT} type="email" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
                <Field label="Town / city"><input className={INPUT} value={f.city} onChange={e => set('city', e.target.value)} /></Field>
                <Field label="Site address" wide><input className={INPUT} value={f.address} onChange={e => set('address', e.target.value)} /></Field>
                <Field label="Electricity connection in"><select className={INPUT} value={f.region} onChange={e => set('region', e.target.value)}>
                  {Object.entries(REGION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="EB consumer no."><input className={INPUT} value={f.eb_consumer_number} onChange={e => set('eb_consumer_number', e.target.value)} /></Field>
                <Field label="Lead source"><select className={INPUT} value={f.source} onChange={e => set('source', e.target.value)}>
                  {[['walk_in', 'Walk-in'], ['phone', 'Phone'], ['referral', 'Referral'], ['website', 'Website'], ['social_media', 'Social media'], ['other', 'Other']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Priority"><select className={INPUT} value={f.priority} onChange={e => set('priority', e.target.value)}>
                  {['urgent', 'high', 'normal', 'low'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></Field>
              </div>
            </section>

            <section className={CARD}><h2 className="font-semibold text-sm mb-3">System &amp; site</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Consumer type"><select className={INPUT} value={f.consumer_type} onChange={e => set('consumer_type', e.target.value)}>
                  {['domestic', 'commercial', 'industrial', 'institution', 'agricultural'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></Field>
                <Field label="System type"><select className={INPUT} value={f.solar_type} onChange={e => { set('solar_type', e.target.value); set('inverter_brand', '') }}>
                  {[['ongrid', 'On-grid'], ['hybrid', 'Hybrid (with battery)'], ['offgrid', 'Off-grid'], ['solar_pump', 'Solar pump']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Required size (kW) *"><input className={INPUT} type="number" min="0.5" step="0.01" value={f.capacity_kw} onChange={e => set('capacity_kw', e.target.value)} /></Field>
                <Field label="Roof"><select className={INPUT} value={f.roof_type} onChange={e => set('roof_type', e.target.value)}>
                  {[['rcc', 'RCC'], ['sheet', 'Metal sheet / shed'], ['ground_mount', 'Ground mount'], ['other', 'Other']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Sanctioned load (kW)"><input className={INPUT} type="number" value={f.sanctioned_load_kw} onChange={e => set('sanctioned_load_kw', e.target.value)} /></Field>
                <Field label="Monthly units (kWh)"><input className={INPUT} type="number" value={f.avg_monthly_units} onChange={e => set('avg_monthly_units', e.target.value)} /></Field>
                <Field label="Phase"><select className={INPUT} value={f.current_phase} onChange={e => set('current_phase', e.target.value)}>
                  <option value="single">Single phase</option><option value="three">Three phase</option></select></Field>
                <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={f.loan_required} onChange={e => set('loan_required', e.target.checked)} /> Needs a bank loan</label>
              </div>
            </section>

            <section className={CARD}>
              <h2 className="font-semibold text-sm mb-1">Components &amp; price</h2>
              {useList
                ? <p className="text-xs text-slate-500 mb-3">Priced from the supplier price list{opts?.quoteMonth ? ` (${opts.quoteMonth})` : ''}: panels × ₹/W, inverter, structure, cables, ACDB/DCDB, earthing, installation, then margin and {GST_NOTE}. Leave a choice on “Best value” to let the price list pick.</p>
                : <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">{opts && !opts.available ? 'The supplier price list has not been loaded yet — enter ₹/kW manually.' : 'Off-grid and pump systems are priced manually.'}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Panels"><select className={INPUT} value={f.panel_type} disabled={f.consumer_type !== 'domestic'} onChange={e => { set('panel_type', e.target.value); set('panel_brand', ''); set('panel_wp', '') }}>
                  <option value="DCR">DCR (subsidy eligible)</option><option value="NonDCR">Non-DCR</option></select></Field>
                {useList && <>
                  <Field label="Panel brand"><select className={INPUT} value={f.panel_brand} onChange={e => { set('panel_brand', e.target.value); set('panel_wp', '') }}>
                    <option value="">Best value</option>{brands.map(b => <option key={b} value={b}>{b}</option>)}</select></Field>
                  <Field label="Panel size"><select className={INPUT} value={f.panel_wp} onChange={e => set('panel_wp', e.target.value)}>
                    <option value="">Best value</option>{Array.from(new Set(sizes)).sort((a, b) => a - b).map(w => <option key={w} value={w}>{w} Wp</option>)}</select></Field>
                  <Field label={f.solar_type === 'hybrid' ? 'Hybrid inverter brand' : 'Inverter brand'}><select className={INPUT} value={f.inverter_brand} onChange={e => set('inverter_brand', e.target.value)}>
                    <option value="">Preferred / best value</option>{invBrands.map(b => <option key={b} value={b}>{b}</option>)}</select></Field>
                  {f.solar_type === 'hybrid' && <Field label="Batteries"><input className={INPUT} type="number" min="1" max="20" value={f.battery_qty} onChange={e => set('battery_qty', e.target.value)} /></Field>}
                </>}
                {!useList && <Field label={`Price per kW (₹, before GST)${suggested ? ` — Pricing Settings: ${inr(suggested)}` : ''}`}>
                  <input className={INPUT} type="number" min="0" value={f.price_per_kw} placeholder={suggested ? String(suggested) : 'Enter ₹/kW'} onChange={e => set('price_per_kw', e.target.value)} /></Field>}
                <Field label="Discount (₹, before GST)"><input className={INPUT} type="number" min="0" value={f.discount} onChange={e => set('discount', e.target.value)} /></Field>
                {useList && <Field label="Override ₹/kW (optional, CEO reviews)"><input className={INPUT} type="number" min="0" value={f.price_per_kw_override} placeholder="Use the price list" onChange={e => set('price_per_kw_override', e.target.value)} /></Field>}
              </div>

              {useList && priced && (
                <div className="mt-4 bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                  <p><b>{priced.panels} × {priced.panelBrand} {priced.wp} Wp</b> = {priced.kwp} kWp ({priced.type === 'DCR' ? 'DCR' : 'Non-DCR'})</p>
                  <p>Inverter: <b>{priced.inverterLabel}</b> ({priced.phase}-phase){priced.inverterWarrantyYears ? ` · ${priced.inverterWarrantyYears}-year warranty` : ''}</p>
                  {priced.battery && <p>Battery: <b>{priced.battery.qty} × {priced.battery.label}</b></p>}
                  <p className="text-slate-500">List price {inr(priced.pricePerKwPreGst)}/kW before GST{override ? ` — overridden to ${inr(override)}/kW` : ''}</p>
                  {priced.warnings.map((w, i) => <p key={i} className="text-amber-700 flex gap-1"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>)}
                </div>
              )}
              {useList && priceErr && <p className="mt-3 text-sm text-red-600">{priceErr}</p>}
              {isManager(myRole) && priced?.costing && <div className="mt-4"><CostingTable costing={priced.costing} total={p?.total ?? null} preGstSold={p?.system ?? null} /></div>}

              <p className="text-xs font-semibold text-slate-600 mt-4 mb-2">Extra items (before GST)</p>
              {items.map((x, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input className={`${INPUT} flex-[3]`} placeholder="e.g. Elevated structure 6 ft" value={x.description} onChange={e => setItems(items.map((y, j) => j === i ? { ...y, description: e.target.value } : y))} />
                  <input className={`${INPUT} flex-1`} type="number" aria-label="Quantity" value={x.quantity} onChange={e => setItems(items.map((y, j) => j === i ? { ...y, quantity: Number(e.target.value) } : y))} />
                  <input className={`${INPUT} flex-[1.5]`} type="number" aria-label="Unit price" placeholder="₹" value={x.unit_price || ''} onChange={e => setItems(items.map((y, j) => j === i ? { ...y, unit_price: Number(e.target.value) } : y))} />
                  <button className="px-2 text-slate-400 hover:text-red-600" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="text-xs font-semibold text-green-700 hover:underline" onClick={() => setItems([...items, { description: '', quantity: 1, unit_price: 0 }])}>+ Add item</button>
              <div className="mt-4"><Field label="Notes for the customer / scope"><textarea className={INPUT} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} maxLength={2000} /></Field></div>
            </section>

            <section className={CARD}><h2 className="font-semibold text-sm mb-3">People</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {myRole !== 'employee' && <Field label="Prepared by (sales)"><select className={INPUT} value={f.assigned_sales_id} onChange={e => set('assigned_sales_id', e.target.value)}>
                  <option value="">Me</option>{people.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></Field>}
                <Field label="Admin manager for follow-up"><select className={INPUT} value={f.follow_up_manager_id} onChange={e => set('follow_up_manager_id', e.target.value)}>
                  <option value="">— choose —</option>{managers.map(x => <option key={x.id} value={x.id}>{x.full_name} · {ROLE_LABELS[x.role]}</option>)}</select></Field>
              </div>
            </section>
          </div>

          <aside className="lg:w-80 shrink-0">
            <div className={`${CARD} lg:sticky lg:top-4 space-y-2 text-sm`}>
              <h2 className="font-semibold flex items-center gap-2">Summary {pricing && <Loader2 size={14} className="animate-spin text-slate-400" />}</h2>
              {p ? <>
                <div className="flex justify-between"><span className="text-slate-500">{kw} kW × {inr(ppk)}</span><span>{inr(kw * ppk)}</span></div>
                {extras > 0 && <div className="flex justify-between"><span className="text-slate-500">Extra items</span><span>{inr(extras)}</span></div>}
                {Number(f.discount) > 0 && <div className="flex justify-between"><span className="text-slate-500">Discount</span><span>− {inr(Number(f.discount))}</span></div>}
                <div className="flex justify-between"><span className="text-slate-500">GST 8.9%</span><span>{inr(p.gst)}</span></div>
                <div className="flex justify-between font-bold border-t pt-2"><span>Total payable</span><span>{inr(p.total)}</span></div>
                {p.central > 0 && <div className="flex justify-between text-green-700"><span>Central subsidy</span><span>{inr(p.central)}</span></div>}
                {p.state > 0 && <div className="flex justify-between text-green-700"><span>{p.stateName}</span><span>{inr(p.state)}</span></div>}
                {p.subsidy > 0 && <div className="flex justify-between font-semibold"><span>Effective cost</span><span>{inr(p.net)}</span></div>}
                {p.subsidy > 0 && <p className="text-[11px] text-slate-400">Subsidies credited to the customer later; amounts checked {SUBSIDY_CHECKED}.</p>}
              </> : <p className="text-slate-400">{pricing ? 'Pricing…' : 'Enter the size to see the price.'}</p>}
              {error && <p role="alert" className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={save} disabled={saving || pricing} className="w-full mt-2 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin inline mr-1" />}Save draft</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
