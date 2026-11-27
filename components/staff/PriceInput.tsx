'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PRICE_MODES, perKwWarning, buildPrice, GST_RATE, inr, type PriceMode } from '@/lib/workflow'

// How the price is typed:
//   per_kw      ₹/kW before GST (GST is added on top)
//   per_kw_incl ₹/kW including GST: the customer pays exactly that per kW
//   total_incl  total payable including GST: the customer pays exactly that figure
// For the two "including GST" ways the figure is kept as typed and the before-GST amount and the
// GST are worked backwards from it (lib/workflow.ts buildPrice).
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500'

export interface PriceValue { ppk: number; mode: PriceMode; entry: number | null }

export default function PriceInput({ label = 'Price', kw, value, extras = 0, discount = 0, disabled, onChange, placeholder, price }: {
  label?: string
  kw: number
  value: PriceValue
  extras?: number
  discount?: number
  disabled?: boolean
  onChange: (v: PriceValue) => void
  placeholder?: string
  price?: Omit<Parameters<typeof buildPrice>[0], 'kw' | 'pricePerKw' | 'extras' | 'discount'>   // region, panels … so subsidy matches
}) {
  const calc = (v: PriceValue) => kw > 0 && (v.ppk > 0 || (v.entry ?? 0) > 0)
    ? buildPrice({ ...(price ?? {}), kw, pricePerKw: v.ppk, extras, discount, entryMode: v.mode, entryValue: v.entry }) : null
  const textFor = (v: PriceValue) => v.mode === 'per_kw' ? (v.ppk > 0 ? String(Math.round(v.ppk * 100) / 100) : '') : v.entry ? String(v.entry) : ''
  const [raw, setRaw] = useState(textFor(value))

  // Follow changes made elsewhere (loading the quotation, re-pricing from the list)
  useEffect(() => {
    const typed = value.mode === 'per_kw' ? Number(raw) : Number(raw)
    const now = value.mode === 'per_kw' ? value.ppk : value.entry ?? 0
    if (Math.abs(typed - now) > 0.004) setRaw(textFor(value))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.mode, value.ppk, value.entry])

  const type = (txt: string) => {
    setRaw(txt)
    const n = Number(txt)
    if (value.mode === 'per_kw') { onChange({ ppk: n > 0 ? n : 0, mode: 'per_kw', entry: null }); return }
    const p = n > 0 && kw > 0 ? buildPrice({ ...(price ?? {}), kw, pricePerKw: 0, extras, discount, entryMode: value.mode, entryValue: n }) : null
    onChange({ ppk: p ? p.pricePerKw : 0, mode: value.mode, entry: n > 0 ? n : null })
  }

  // Switching the way of typing keeps the same customer price
  const switchMode = (m: PriceMode) => {
    const cur = calc(value)
    if (!cur) { onChange({ ppk: 0, mode: m, entry: null }); setRaw(''); return }
    const next: PriceValue = m === 'per_kw' ? { ppk: cur.pricePerKw, mode: m, entry: null }
      : m === 'total_incl' ? { ppk: cur.pricePerKw, mode: m, entry: cur.total }
      : { ppk: cur.pricePerKw, mode: m, entry: Math.round(cur.pricePerKw * (1 + GST_RATE)) }
    onChange(next); setRaw(textFor(next))
  }

  const p = calc(value)
  const warn = perKwWarning(p?.pricePerKw ?? value.ppk, kw)

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-slate-600 block">{label}</span>
      <div className="flex gap-2 flex-col sm:flex-row">
        <select className={`${INPUT} sm:w-auto shrink-0`} value={value.mode} disabled={disabled} onChange={e => switchMode(e.target.value as PriceMode)} aria-label="How the price is typed">
          {PRICE_MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={INPUT} type="number" min="0" step="1" inputMode="decimal" disabled={disabled} value={raw} placeholder={placeholder}
          onChange={e => type(e.target.value)} aria-label={label} />
      </div>
      {p && (
        <p className="text-[11px] text-slate-600">
          Customer pays <b>{inr(p.total)}</b> incl. GST{value.mode === 'total_incl' ? ' (exactly as typed)' : value.mode === 'per_kw_incl' ? ` (${inr(value.entry)}/kW × ${kw} kW${extras - discount ? ' + extras − discount' : ''})` : ''}
          {' '}= {inr(p.system)} + GST {inr(p.gst)} · {inr(Math.round(p.pricePerKw))}/kW before GST
        </p>
      )}
      {warn && <p className="text-[11px] text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{warn}</p>}
    </div>
  )
}
