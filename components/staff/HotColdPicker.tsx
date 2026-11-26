'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Flame, Snowflake, Loader2 } from 'lucide-react'
import { TEMP_NEXT_DAYS, daysFromToday } from '@/lib/workflow'

// Mark a lead hot or cold at any stage, with a short reason and when to contact next.
// Used on the quotation page and in each row of the quotations list.

type Temp = 'hot' | 'cold'

export default function HotColdPicker({ id, value, note, since, canSet, compact = false, onDone }: {
  id: string; value: string | null; note?: string | null; since?: string | null
  canSet: boolean; compact?: boolean; onDone?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState<Temp | null>(null)
  const [reason, setReason] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const days = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : null
  const age = days == null ? '' : days === 0 ? 'today' : `${days}d`

  const pick = (t: Temp) => { setOpen(t); setReason(''); setErr(''); setNext(daysFromToday(TEMP_NEXT_DAYS[t])) }

  const save = async (v: Temp | 'none') => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/quotations/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'temperature', value: v, remarks: reason.trim(), next_follow_up_date: v === 'none' ? null : next || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Could not save.')
      setOpen(null)
      onDone ? onDone() : router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }

  const badge = value === 'hot'
    ? <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600"><Flame size={12} /> Hot{age && <span className="font-normal text-slate-400">· {age}</span>}</span>
    : value === 'cold'
    ? <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-600"><Snowflake size={12} /> Cold{age && <span className="font-normal text-slate-400">· {age}</span>}</span>
    : <span className="text-xs text-slate-400">Not set</span>

  if (!canSet) return <span title={note ?? ''}>{badge}</span>

  const btn = (t: Temp) => (
    <button type="button" onClick={() => pick(t)} disabled={busy} aria-pressed={value === t}
      title={t === 'hot' ? 'Mark HOT: likely to buy soon' : 'Mark COLD: not ready / unlikely for now'}
      className={`inline-flex items-center gap-1 rounded-full border font-bold transition ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'} ${
        value === t
          ? t === 'hot' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-sky-500 border-sky-500 text-white'
          : t === 'hot' ? 'border-orange-200 text-orange-600 hover:bg-orange-50' : 'border-sky-200 text-sky-600 hover:bg-sky-50'}`}>
      {t === 'hot' ? <Flame size={compact ? 11 : 13} /> : <Snowflake size={compact ? 11 : 13} />}{t === 'hot' ? 'Hot' : 'Cold'}
    </button>
  )

  return (
    <div className="relative inline-block">
      <div className="flex items-center gap-1.5 flex-wrap">
        {btn('hot')}{btn('cold')}
        {!compact && value && age && <span className="text-[11px] text-slate-400">since {age}</span>}
      </div>
      {!compact && note && !open && <p className="text-xs text-slate-500 mt-1 max-w-md">“{note}”</p>}
      {open && (
        <div className={`${compact ? 'fixed z-50 inset-x-4 top-1/3 mx-auto max-w-xs' : 'mt-2 w-full max-w-md'} bg-white border border-slate-200 rounded-xl shadow-xl p-3 space-y-2 text-left`}>
          <p className="text-xs font-semibold text-slate-700">Mark {open === 'hot' ? '🔥 HOT' : '❄ COLD'}</p>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} autoFocus
            placeholder={open === 'hot' ? 'Why? e.g. loan approved, wants it this month' : 'Why? e.g. only comparing prices, next year'}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" aria-label="Reason" />
          <label className="flex items-center gap-2 text-xs text-slate-600">Next follow-up
            <input type="date" value={next} onChange={e => setNext(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm" />
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-center gap-2 justify-end">
            {value && <button type="button" onClick={() => save('none')} disabled={busy} className="mr-auto text-[11px] text-slate-400 hover:text-slate-600">Clear hot / cold</button>}
            <button type="button" onClick={() => setOpen(null)} className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="button" onClick={() => save(open)} disabled={busy}
              className={`px-3 py-1 text-xs font-semibold text-white rounded-lg disabled:opacity-50 ${open === 'hot' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-sky-500 hover:bg-sky-600'}`}>
              {busy ? <Loader2 size={12} className="animate-spin inline" /> : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
