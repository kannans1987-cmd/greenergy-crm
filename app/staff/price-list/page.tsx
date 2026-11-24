'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, CheckCircle, AlertTriangle } from 'lucide-react'
import Header from '@/components/staff/Header'
import type { Catalogue, CostModel } from '@/lib/pricing-engine'

type Row<T> = T & { id: string }
const INPUT = 'border border-slate-200 rounded px-2 py-1 text-sm w-full bg-white'
const NUM = `${INPUT} text-right`
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'

export default function PriceListPage() {
  const [cat, setCat] = useState<Catalogue | null>(null)
  const [model, setModel] = useState<CostModel | null>(null)
  const [versions, setVersions] = useState<{ catalogue: number; cost_model: number }>({ catalogue: 0, cost_model: 0 })
  const [history, setHistory] = useState<{ key: string; version: number; note: string | null; changed_by_name: string | null; created_at: string }[]>([])
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [marginOk, setMarginOk] = useState(false)
  const [modelDirty, setModelDirty] = useState(false)

  async function load() {
    const r = await fetch('/api/pricing/config'); const d = await r.json()
    if (!r.ok) { setLoadErr(d.error ?? 'Could not load.'); return }
    const c = d.config.find((x: { key: string }) => x.key === 'catalogue'), m = d.config.find((x: { key: string }) => x.key === 'cost_model')
    if (!c || !m) { setLoadErr('The price list has not been loaded yet. Run supabase/pricing/pricing_seed.sql in the Supabase SQL editor (see SETUP-NEW-SUPABASE.md).'); return }
    setCat(c.data); setModel(m.data); setVersions({ catalogue: c.version, cost_model: m.version }); setHistory(d.history); setMarginOk(!!d.canEditMargin); setDirty(false); setModelDirty(false)
  }
  useEffect(() => { load() }, [])

  if (loadErr) return <div className="p-10 text-center text-slate-600">{loadErr}</div>
  if (!cat || !model) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>

  const touch = () => setDirty(true)
  const editIn = <K extends 'panels' | 'inverters' | 'batteries'>(bucket: K, id: string, k: string, v: unknown) => {
    setCat(c => c && ({ ...c, [bucket]: { ...(c[bucket] ?? {}), [id]: { ...(c[bucket] as Record<string, object>)[id], [k]: v } } })); touch()
  }
  const rows = <T,>(o: Record<string, T> | undefined) => Object.entries(o ?? {}).map(([id, v]) => ({ id, ...v })) as Row<T>[]

  async function save() {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/pricing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogue: { ...cat, taxBasis: 'exGST' }, ...(marginOk && modelDirty ? { cost_model: model } : {}), catalogueVersion: versions.catalogue, modelVersion: versions.cost_model, note }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg({ t: d.error ?? 'Could not save.', ok: false }); return }
    setMsg({ t: 'Saved — new quotations use these prices now.', ok: true }); setNote(''); load()
  }

  function addPanel() {
    const brand = window.prompt('Panel brand (e.g. Waaree)'); if (!brand) return
    const wp = Number(window.prompt('Wattage (Wp)', '550')); const rate = Number(window.prompt('Price ₹ per W, EXCLUDING GST', '25'))
    const dcr = window.confirm('Is it a DCR panel? (OK = DCR, Cancel = Non-DCR)')
    if (!(wp > 0 && rate > 0)) return
    const id = `${brand}-${dcr ? 'dcr' : 'ndcr'}-${wp}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setCat(c => c && ({ ...c, panels: { ...c.panels, [id]: { brand, dcr, wp, rate, active: true } } })); touch()
  }
  function addInverter() {
    const brand = window.prompt('Inverter brand (e.g. Solaryaan)'); if (!brand) return
    const kw = Number(window.prompt('Size (kW)', '5')); const price = Number(window.prompt('Price ₹, EXCLUDING GST', '25000'))
    const hybrid = window.confirm('Is it a HYBRID inverter? (OK = hybrid, Cancel = on-grid)')
    const phase = hybrid ? 1 : window.confirm('Three-phase? (OK = 3-phase, Cancel = single-phase)') ? 3 : 1
    if (!(kw > 0 && price > 0)) return
    const id = `${brand}-${hybrid ? 'hyb' : phase + 'ph'}-${kw}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setCat(c => c && ({ ...c, inverters: { ...c.inverters, [id]: { brand, kind: hybrid ? 'hybrid' : 'ongrid', phase: phase as 1 | 3, kw, price, active: true } } })); touch()
  }

  const panels = rows(cat.panels).sort((a, b) => Number(b.dcr) - Number(a.dcr) || a.brand.localeCompare(b.brand) || a.wp - b.wp)
  const invs = rows(cat.inverters).sort((a, b) => (a.kind ?? '').localeCompare(b.kind ?? '') || a.brand.localeCompare(b.brand) || a.phase - b.phase || a.kw - b.kw)

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Price List" subtitle="Supplier purchase prices used to price every quotation. Only the CEO and people the CEO allows can open this page." />
      {msg && <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white flex gap-2 ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}{msg.t}</div>}
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        <p className="text-sm bg-blue-50 text-blue-800 rounded-lg px-4 py-3"><b>All prices on this page exclude GST.</b> Enter supplier prices before tax. Quotations add the margin, then GST ({model.gstPct}%) once on the final price.</p>
        {!marginOk && <p className="text-xs text-slate-500">You can edit supplier prices. Margin, GST and sizing rules can only be changed by the CEO.</p>}
        <div className={`${CARD} p-5 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm`}>
          <label><span className="text-xs text-slate-500">Price list month</span><input className={INPUT} value={cat.quoteMonth ?? ''} onChange={e => { setCat({ ...cat, quoteMonth: e.target.value }); touch() }} /></label>
          <label><span className="text-xs text-slate-500">Margin (profit %)</span><input className={NUM} type="number" value={model.profitPct} disabled={!marginOk} onChange={e => { setModel({ ...model, profitPct: Number(e.target.value) }); setModelDirty(true); touch() }} /></label>
          <label><span className="text-xs text-slate-500">GST %</span><input className={NUM} type="number" step="0.1" value={model.gstPct} disabled={!marginOk} onChange={e => { setModel({ ...model, gstPct: Number(e.target.value) }); setModelDirty(true); touch() }} /></label>
          <label><span className="text-xs text-slate-500">Preferred inverter brand</span><input className={INPUT} value={model.preferredInverterBrand} disabled={!marginOk} onChange={e => { setModel({ ...model, preferredInverterBrand: e.target.value }); setModelDirty(true); touch() }} /></label>
          <label><span className="text-xs text-slate-500">Single-phase up to (kW)</span><input className={NUM} type="number" value={model.singlePhaseMaxKw} disabled={!marginOk} onChange={e => { setModel({ ...model, singlePhaseMaxKw: Number(e.target.value) }); setModelDirty(true); touch() }} /></label>
        </div>

        <section className={CARD}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center"><h2 className="font-semibold text-sm">Panels <span className="text-slate-400 font-normal">₹ per watt, excluding GST</span></h2>
            <button onClick={addPanel} className="ml-auto text-xs font-semibold text-green-700 flex items-center gap-1"><Plus size={12} /> Add panel</button></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs text-slate-500 bg-slate-50"><tr>{['In use', 'Brand', 'Type', 'Wp', '₹/W (excl. GST)', 'Supplier'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>{panels.map(p => (
              <tr key={p.id} className={`border-t border-slate-50 ${p.active === false ? 'text-slate-400' : ''}`}>
                <td className="px-3 py-1.5"><input type="checkbox" checked={p.active !== false} onChange={e => editIn('panels', p.id, 'active', e.target.checked)} aria-label={`Use ${p.brand} ${p.wp}`} /></td>
                <td className="px-3 py-1.5">{p.brand}</td><td className="px-3 py-1.5">{p.dcr ? 'DCR' : 'Non-DCR'}</td>
                <td className="px-3 py-1.5 w-24"><input className={NUM} type="number" value={p.wp} onChange={e => editIn('panels', p.id, 'wp', Number(e.target.value))} /></td>
                <td className="px-3 py-1.5 w-24"><input className={NUM} type="number" step="0.05" value={p.rate} onChange={e => editIn('panels', p.id, 'rate', Number(e.target.value))} /></td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{cat.suppliers?.[p.supplier ?? '']?.name ?? p.supplier ?? '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </section>

        <section className={CARD}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center"><h2 className="font-semibold text-sm">Inverters <span className="text-slate-400 font-normal">₹ each, excluding GST</span></h2>
            <button onClick={addInverter} className="ml-auto text-xs font-semibold text-green-700 flex items-center gap-1"><Plus size={12} /> Add inverter</button></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs text-slate-500 bg-slate-50"><tr>{['In use', 'Brand', 'Type', 'Phase', 'kW', 'Price ₹ (excl. GST)', 'Warranty (yrs)'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>{invs.map(i => (
              <tr key={i.id} className={`border-t border-slate-50 ${i.active === false ? 'text-slate-400' : ''}`}>
                <td className="px-3 py-1.5"><input type="checkbox" checked={i.active !== false} onChange={e => editIn('inverters', i.id, 'active', e.target.checked)} aria-label={`Use ${i.brand} ${i.kw} kW`} /></td>
                <td className="px-3 py-1.5">{i.brand}</td><td className="px-3 py-1.5">{i.kind === 'hybrid' ? 'Hybrid' : 'On-grid'}</td><td className="px-3 py-1.5">{i.phase}</td>
                <td className="px-3 py-1.5 w-24"><input className={NUM} type="number" step="0.1" value={i.kw} onChange={e => editIn('inverters', i.id, 'kw', Number(e.target.value))} /></td>
                <td className="px-3 py-1.5 w-32"><input className={NUM} type="number" value={i.price} onChange={e => editIn('inverters', i.id, 'price', Number(e.target.value))} /></td>
                <td className="px-3 py-1.5 w-24"><input className={NUM} type="number" value={i.warrantyYears ?? ''} onChange={e => editIn('inverters', i.id, 'warrantyYears', e.target.value ? Number(e.target.value) : undefined)} /></td>
              </tr>))}</tbody>
          </table></div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className={`${CARD} p-5 space-y-3 text-sm`}>
            <h2 className="font-semibold">Batteries</h2>
            {rows(cat.batteries).map(x => (
              <div key={x.id} className="grid grid-cols-[auto_1fr_6rem_8rem] gap-2 items-center">
                <input type="checkbox" checked={x.active !== false} onChange={e => editIn('batteries', x.id, 'active', e.target.checked)} aria-label="In use" />
                <span>{x.brand} {x.chemistry} {x.kwh} kWh</span>
                <input className={NUM} type="number" value={x.kwh} aria-label="kWh" onChange={e => editIn('batteries', x.id, 'kwh', Number(e.target.value))} />
                <input className={NUM} type="number" value={x.price} aria-label="Price" onChange={e => editIn('batteries', x.id, 'price', Number(e.target.value))} />
              </div>))}
            <h2 className="font-semibold pt-2">Cables (₹/m, excl. GST)</h2>
            {Object.entries(cat.cables).map(([k, c]) => (
              <div key={k} className="grid grid-cols-[1fr_8rem] gap-2 items-center"><span>{c.label}</span>
                <input className={NUM} type="number" value={c.rate} onChange={e => { setCat({ ...cat, cables: { ...cat.cables, [k]: { ...c, rate: Number(e.target.value) } } }); touch() }} /></div>))}
            <h2 className="font-semibold pt-2">Shed roof materials</h2>
            {(['rail', 'adhesive'] as const).map(k => (
              <div key={k} className="grid grid-cols-[1fr_8rem] gap-2 items-center"><span>{cat.shed[k].label ?? k} (₹, used in quotes)</span>
                <input className={NUM} type="number" value={cat.shed[k].fixed} onChange={e => { setCat({ ...cat, shed: { ...cat.shed, [k]: { ...cat.shed[k], fixed: Number(e.target.value) } } }); touch() }} /></div>))}
          </section>
          <section className={`${CARD} p-5 text-sm`}>
            <h2 className="font-semibold mb-2">ACDB / DCDB by inverter size <span className="font-normal text-slate-400">(excl. GST)</span></h2>
            <table className="w-full"><thead className="text-xs text-slate-500"><tr><th className="text-left">kW from</th><th className="text-left">to</th><th className="text-right">ACDB ₹</th><th className="text-right">DCDB ₹</th></tr></thead>
              <tbody>{cat.distBoxes.map((b, i) => (
                <tr key={i}><td className="py-1 pr-2">{b.fromKw}</td><td className="pr-2">{b.toKw ?? '+'}</td>
                  {(['acdb', 'dcdb'] as const).map(k => <td key={k} className="py-1 pl-2 w-28"><input className={NUM} type="number" value={b[k]}
                    onChange={e => { const d = cat.distBoxes.slice(); d[i] = { ...b, [k]: Number(e.target.value) }; setCat({ ...cat, distBoxes: d }); touch() }} /></td>)}</tr>))}</tbody></table>
            <p className="text-xs text-slate-400 mt-2">{cat.distBoxes.find(b => b.note)?.note}</p>
            <h2 className="font-semibold mt-5 mb-2">Recent changes</h2>
            <ul className="text-xs text-slate-600 space-y-1">{history.map((h, i) => <li key={i}>{h.key === 'catalogue' ? 'Price list' : 'Cost model'} v{h.version} · {h.changed_by_name ?? '—'} · {new Date(h.created_at).toLocaleString('en-IN')}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
          </section>
        </div>

        <div className={`${CARD} p-4 flex flex-wrap gap-3 items-center sticky bottom-3`}>
          <input className={`${INPUT} flex-1 min-w-[200px]`} value={note} onChange={e => setNote(e.target.value)} placeholder="What changed? (e.g. Kandha Solar December price list)" maxLength={300} />
          <span className="text-xs text-slate-500">Price list v{versions.catalogue} · cost model v{versions.cost_model}</span>
          <button onClick={save} disabled={!dirty || busy} className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin inline mr-1" />}Save prices</button>
        </div>
        <p className="text-xs text-slate-400">Existing quotations keep the price they were approved at. Drafts can be updated with “Re-price from price list”.</p>
      </div>
    </div>
  )
}
