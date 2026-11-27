'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PRICE_MODES, perKwFromEntry, perKwWarning, buildPrice, GST_RATE, inr, type PriceMode } from '@/lib/workflow'

// The quotation stores ₹/kW before GST. Staff can type it that way, as ₹/kW including GST,
// or as the total payable including GST; the box shows what each figure works out to.
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500'

export default function PriceInput({ label = 'Price', kw, ppk, extras = 0, discount = 0, disabled, onChange, placeholder, price }: {
  label?: string
  kw: number                      // system size the price is for
  ppk: number                     // current ₹/kW before GST (0 = empty)
  extras?: number                 // extra items before GST
  discount?: number               // discount before GST
  disabled?: boolean
  onChange: (ppkBeforeGst: number) => void
  placeholder?: string
  price?: Parameters<typeof buildPrice>[0]   // full inputs, so the total shown matches the quotation (subsidy etc.)
}) {
  const [mode, setMode] = useState<PriceMode>('per_kw')
  const [raw, setRaw] = useState('')

  // What to show in the box for a ₹/kW before GST, in the chosen way of entering it
  const shown = (m: PriceMode, v: number) => {
    if (!(v > 0)) return ''
    if (m === 'per_kw') return String(Math.round(v * 100) / 100)
    if (m === 'per_kw_incl') return String(Math.round(v * (1 + GST_RATE)))
    return kw > 0 ? String(buildPrice({ ...(price ?? {}), kw, pricePerKw: v, extras, discount }).total) : ''
  }
  // Keep the box in step when the price changes from outside (load, re-price)
  useEffect(() => {
    const cur = perKwFromEntry(mode, Number(raw), kw, extras, discount)
    if (Math.abs(cur - ppk) > 0.5 || (!ppk && raw)) setRaw(shown(mode, ppk))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppk])

  const change = (v: string) => { setRaw(v); onChange(perKwFromEntry(mode, Number(v), kw, extras, discount)) }
  const switchMode = (m: PriceMode) => { setMode(m); setRaw(shown(m, ppk)) }

  const total = ppk > 0 && kw > 0 ? buildPrice({ ...(price ?? {}), kw, pricePerKw: ppk, extras, discount }).total : 0
  const warn = perKwWarning(ppk, kw)

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-slate-600 block">{label}</span>
      <div className="flex gap-2">
        <select className={`${INPUT} w-auto shrink-0`} value={mode} disabled={disabled} onChange={e => switchMode(e.target.value as PriceMode)} aria-label="How the price is entered">
          {PRICE_MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={INPUT} type="number" min="0" inputMode="decimal" disabled={disabled} value={raw} placeholder={placeholder}
          onChange={e => change(e.target.value)} aria-label={label} />
      </div>
      {ppk > 0 && (
        <p className="text-[11px] text-slate-500">
          = {inr(Math.round(ppk))}/kW before GST · {inr(Math.round(ppk * (1 + GST_RATE)))}/kW incl. GST{total ? ` · total ${inr(total)} incl. GST` : ''}
        </p>
      )}
      {warn && <p className="text-[11px] text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{warn}</p>}
    </div>
  )
}
