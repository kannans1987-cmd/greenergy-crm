'use client'

// Panels and inverter for a quotation, chosen from the supplier price list (no prices shown here).
// Leave a number empty to let the price list work it out from the size; type a number to decide it yourself.

export interface PickerOptions {
  available: boolean
  panelBrands?: { DCR: string[]; NonDCR: string[] }
  panelSizes?: { brand: string; dcr: boolean; wp: number }[]
  inverterBrands?: { ongrid: string[]; hybrid: string[] }
  inverters?: { id: string; brand: string; kw: number; phase: 1 | 3; kind: 'ongrid' | 'hybrid' }[]
}
export type PickerValue = Record<
  'consumer_type' | 'solar_type' | 'panel_type' | 'panel_brand' | 'panel_wp' | 'dcr_panel_qty' | 'panel_brand_nondcr' | 'panel_wp_nondcr'
  | 'nondcr_panel_qty' | 'inverter_phase' | 'inverter_brand' | 'inverter_choice' | 'inverter_qty' | 'battery_qty', string>

const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500'
function F({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}</label>
}
const kwOf = (count: string, wp: string) => (Number(count) > 0 && Number(wp) > 0 ? Math.round(Number(count) * Number(wp) / 10) / 100 : null)

export default function PanelInverterPicker({ v, set, opts, disabled }: {
  v: PickerValue; set: (k: keyof PickerValue, val: string) => void; opts: PickerOptions | null; disabled?: boolean
}) {
  const home = v.consumer_type === 'domestic'
  const type = home ? v.panel_type : 'NonDCR'
  const hybrid = v.solar_type === 'hybrid'
  const sizes = (dcr: boolean, brand: string) => Array.from(new Set((opts?.panelSizes ?? [])
    .filter(s => s.dcr === dcr && (!brand || s.brand === brand)).map(s => s.wp))).sort((a, b) => a - b)
  const models = (opts?.inverters ?? []).filter(i => i.kind === (hybrid ? 'hybrid' : 'ongrid') && (!v.inverter_phase || String(i.phase) === v.inverter_phase))

  // one row per panel type: brand, size, number of panels
  const row = (dcr: boolean) => {
    const pre = dcr ? '' : type === 'Mixed' ? '_nondcr' : ''
    const brandKey = (dcr || type !== 'Mixed' ? 'panel_brand' : 'panel_brand_nondcr') as keyof PickerValue
    const wpKey = (pre ? 'panel_wp_nondcr' : 'panel_wp') as keyof PickerValue
    const qtyKey = (dcr ? 'dcr_panel_qty' : 'nondcr_panel_qty') as keyof PickerValue
    const kw = kwOf(v[qtyKey], v[wpKey])
    const must = type === 'Mixed'
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <p className="col-span-2 sm:col-span-4 text-xs font-semibold text-slate-700">{dcr ? 'DCR panels (made in India, subsidy eligible)' : 'Non-DCR panels'}</p>
        <F label="Brand"><select className={INPUT} disabled={disabled} value={v[brandKey]} onChange={e => { set(brandKey, e.target.value); set(wpKey, '') }}>
          <option value="">Best value</option>{(opts?.panelBrands?.[dcr ? 'DCR' : 'NonDCR'] ?? []).map(b => <option key={b} value={b}>{b}</option>)}</select></F>
        <F label="Panel size"><select className={INPUT} disabled={disabled} value={v[wpKey]} onChange={e => set(wpKey, e.target.value)}>
          <option value="">Best value</option>{sizes(dcr, v[brandKey]).map(w => <option key={w} value={w}>{w} Wp</option>)}</select></F>
        <F label={`Number of panels${must ? ' *' : ''}`}><input className={INPUT} disabled={disabled} type="number" min="1" max="5000" step="1" inputMode="numeric"
          value={v[qtyKey]} placeholder={must ? 'e.g. 6' : 'From the size'} onChange={e => set(qtyKey, e.target.value.replace(/\D/g, ''))} /></F>
        <p className="text-xs text-slate-500 pb-2">{kw ? `= ${kw} kWp` : v[qtyKey] ? 'choose the panel size to see kWp' : must ? '' : 'empty = worked out from the size'}</p>
      </div>
    )
  }

  const totalKw = type === 'Mixed'
    ? (kwOf(v.dcr_panel_qty, v.panel_wp) ?? 0) + (kwOf(v.nondcr_panel_qty, v.panel_wp_nondcr) ?? 0)
    : kwOf(type === 'NonDCR' ? v.nondcr_panel_qty : v.dcr_panel_qty, v.panel_wp)
  const byCount = Number(type === 'NonDCR' ? v.nondcr_panel_qty : v.dcr_panel_qty) > 0 || (type === 'Mixed' && Number(v.nondcr_panel_qty) > 0)

  return (
    <div className="space-y-4">
      <F label="Panels" className="max-w-xs"><select className={INPUT} disabled={disabled || !home} value={type}
        onChange={e => { set('panel_type', e.target.value); if (e.target.value === 'DCR') set('nondcr_panel_qty', ''); if (e.target.value === 'NonDCR') set('dcr_panel_qty', '') }}>
        <option value="DCR">DCR only (subsidy eligible)</option><option value="NonDCR">Non-DCR only</option>
        {home && <option value="Mixed">Mixed: DCR + Non-DCR</option>}</select></F>

      {type !== 'NonDCR' && row(true)}
      {type !== 'DCR' && row(false)}
      {byCount && (
        <p className="text-xs text-green-800 bg-green-50 rounded-lg px-3 py-2">
          The number of panels decides the size{totalKw ? `: ${Math.round(totalKw * 100) / 100} kWp in total` : ''}{type === 'Mixed' && kwOf(v.dcr_panel_qty, v.panel_wp) ? `, subsidy on the ${kwOf(v.dcr_panel_qty, v.panel_wp)} kWp DCR part` : ''}.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <p className="col-span-2 sm:col-span-4 text-xs font-semibold text-slate-700">{hybrid ? 'Hybrid inverter' : 'Inverter'}</p>
        <F label="Phase"><select className={INPUT} disabled={disabled} value={v.inverter_phase} onChange={e => { set('inverter_phase', e.target.value); set('inverter_choice', '') }}>
          <option value="">Automatic (by size)</option><option value="1">Single phase</option><option value="3">Three phase</option></select></F>
        <F label="Model" className="col-span-2 sm:col-span-2"><select className={INPUT} disabled={disabled} value={v.inverter_choice} onChange={e => set('inverter_choice', e.target.value)}>
          <option value="">Automatic: best fit{v.inverter_brand ? ` (${v.inverter_brand})` : ''}</option>
          {models.map(i => <option key={i.id} value={i.id}>{i.brand} {i.kw} kW · {i.phase === 1 ? 'single' : 'three'} phase</option>)}</select></F>
        <F label="How many"><input className={INPUT} disabled={disabled} type="number" min="1" max="50" step="1" inputMode="numeric" value={v.inverter_qty}
          placeholder="1" onChange={e => set('inverter_qty', e.target.value.replace(/\D/g, ''))} /></F>
        {!v.inverter_choice && (
          <F label="Brand (for automatic)" className="col-span-2"><select className={INPUT} disabled={disabled} value={v.inverter_brand} onChange={e => set('inverter_brand', e.target.value)}>
            <option value="">Preferred</option>{(opts?.inverterBrands?.[hybrid ? 'hybrid' : 'ongrid'] ?? []).map(b => <option key={b} value={b}>{b}</option>)}</select></F>
        )}
        {hybrid && <F label="Batteries"><input className={INPUT} disabled={disabled} type="number" min="1" max="20" value={v.battery_qty} onChange={e => set('battery_qty', e.target.value)} /></F>}
      </div>
    </div>
  )
}
