'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'

// The CEO's rules: when a quotation may be approved without the CEO, referral reward, neighbour-group
// discounts, alert timing, and the company details printed on invoices, reports and reminders.

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3'
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white'
const F = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) =>
  <label className="block"><span className="text-xs font-medium text-slate-600 block mb-1">{label}</span>{children}{hint && <span className="text-[11px] text-slate-400">{hint}</span>}</label>

export default function Rules() {
  const supabase = createClient()
  const [s, setS] = useState<Record<string, Row>>({})
  const [uid, setUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setUid(user?.id ?? null)
    const { data, error } = await supabase.from('business_settings').select('key, data')
    setMissing(!!error)
    setS(Object.fromEntries((data ?? []).map((r: Row) => [r.key, r.data])))
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  const set = (key: string, k: string, v: unknown) => setS(x => ({ ...x, [key]: { ...(x[key] ?? {}), [k]: v } }))
  async function save(key: string) {
    const { error } = await supabase.from('business_settings').upsert({ key, data: s[key] ?? {}, updated_by: uid, updated_at: new Date().toISOString() })
    setMsg(error ? { t: error.message, ok: false } : { t: 'Saved', ok: true }); setTimeout(() => setMsg(null), 3500)
  }
  const SaveBtn = ({ k }: { k: string }) => <div className="flex justify-end"><button onClick={() => save(k)} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg flex items-center gap-1"><Save size={14} /> Save</button></div>

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  const a = s.auto_approval ?? {}, r = s.referral ?? {}, g = s.group_buy ?? {}, al = s.alerts ?? {}, c = s.company ?? {}, kb = s.kanban ?? {}, lv = s.leave ?? {}
  const tiers: { homes: number; discount_pct: number }[] = g.tiers ?? []

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Business rules" subtitle="Your decisions, written once, applied every time" />
      {msg && <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.t}</div>}
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-5">
        {missing && <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">The growth database update has not been run yet (supabase/growth_v1.sql).</p>}

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Auto-approval of quotations</h2>
          <p className="text-xs text-slate-500">A quotation submitted by staff is approved at once, without waiting for you, only if <b>all</b> of these hold. It must also be priced from the price list with no extra items, and re-priced after any size change. Everything else still comes to you. You are told about every auto-approval.</p>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!a.enabled} onChange={e => set('auto_approval', 'enabled', e.target.checked)} /> Switch on auto-approval</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <F label="Up to (kW)"><input className={INPUT} type="number" min="1" step="0.5" value={a.max_kw ?? 10} onChange={e => set('auto_approval', 'max_kw', Number(e.target.value))} /></F>
            <F label="Margin at least (%)" hint="(price before GST − cost) ÷ price"><input className={INPUT} type="number" min="0" max="60" step="0.5" value={a.min_margin_pct ?? 15} onChange={e => set('auto_approval', 'min_margin_pct', Number(e.target.value))} /></F>
            <F label="Discount at most (%)"><input className={INPUT} type="number" min="0" max="30" step="0.5" value={a.max_discount_pct ?? 3} onChange={e => set('auto_approval', 'max_discount_pct', Number(e.target.value))} /></F>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.domestic_only !== false} onChange={e => set('auto_approval', 'domestic_only', e.target.checked)} /> Homes (domestic) only: commercial and industrial always come to me</label>
          <SaveBtn k="auto_approval" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Referral reward</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <F label="Reward per installed referral (₹)"><input className={INPUT} type="number" min="0" step="100" value={r.reward_amount ?? 0} onChange={e => set('referral', 'reward_amount', Number(e.target.value))} /></F>
            <div className="sm:col-span-2"><F label="How it is paid (shown to staff)"><input className={INPUT} value={r.reward_note ?? ''} onChange={e => set('referral', 'reward_note', e.target.value)} /></F></div>
          </div>
          <SaveBtn k="referral" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Neighbour group discounts</h2>
          <p className="text-xs text-slate-500">Shown on each quotation in a group; staff apply the discount when preparing it (an auto-approval still checks your discount limit).</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <input className={`${INPUT} w-24`} type="number" min="2" value={t.homes} onChange={e => set('group_buy', 'tiers', tiers.map((x, j) => j === i ? { ...x, homes: Number(e.target.value) } : x))} aria-label="Homes" /> homes or more →
              <input className={`${INPUT} w-24`} type="number" min="0" max="20" step="0.5" value={t.discount_pct} onChange={e => set('group_buy', 'tiers', tiers.map((x, j) => j === i ? { ...x, discount_pct: Number(e.target.value) } : x))} aria-label="Discount %" /> % off
              <button className="text-xs text-red-600" onClick={() => set('group_buy', 'tiers', tiers.filter((_, j) => j !== i))}>Remove</button>
            </div>))}
          <button className="text-xs font-semibold text-green-700" onClick={() => set('group_buy', 'tiers', [...tiers, { homes: (tiers[tiers.length - 1]?.homes ?? 2) + 2, discount_pct: 0 }])}>+ Add a tier</button>
          <SaveBtn k="group_buy" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Alerts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <F label="Alert if a lead is not called within (minutes)"><input className={INPUT} type="number" min="10" max="480" step="5" value={al.first_call_minutes ?? 60} onChange={e => set('alerts', 'first_call_minutes', Number(e.target.value))} /></F>
            <F label="Working day starts (hour)"><input className={INPUT} type="number" min="0" max="23" value={al.day_start ?? 9} onChange={e => set('alerts', 'day_start', Number(e.target.value))} /></F>
            <F label="Working day ends (hour)"><input className={INPUT} type="number" min="1" max="24" value={al.day_end ?? 19} onChange={e => set('alerts', 'day_end', Number(e.target.value))} /></F>
          </div>
          <p className="text-[11px] text-slate-400">A lead that arrives at night is alerted once the working day starts.</p>
          <SaveBtn k="alerts" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Leave policy</h2>
          <p className="text-xs text-slate-500">Applied by the database to every leave: the Sr Admin Manager approves first, then you. Abrupt casual leave and absence without intimation are always loss of pay; sick leave is paid only with a medical certificate.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <F label="Casual leave: days of notice needed"><input className={INPUT} type="number" min="0" max="30" value={lv.notice_days ?? 5} onChange={e => set('leave', 'notice_days', Math.max(0, Math.round(Number(e.target.value))))} /></F>
            <F label="Casual leave: paid days"><input className={INPUT} type="number" min="0" max="10" value={lv.casual_paid_days ?? 1} onChange={e => set('leave', 'casual_paid_days', Math.max(0, Math.round(Number(e.target.value))))} /></F>
            <F label="…paid days if the reason is genuine"><input className={INPUT} type="number" min="0" max="10" value={lv.casual_paid_days_genuine ?? 2} onChange={e => set('leave', 'casual_paid_days_genuine', Math.max(0, Math.round(Number(e.target.value))))} /></F>
            <F label="Termination review after (days away)"><input className={INPUT} type="number" min="3" max="60" value={lv.termination_days ?? 10} onChange={e => set('leave', 'termination_days', Math.max(3, Math.round(Number(e.target.value))))} /></F>
            <F label="Sick leave can be applied up to (days after)"><input className={INPUT} type="number" min="0" max="30" value={lv.sick_backdate_days ?? 7} onChange={e => set('leave', 'sick_backdate_days', Math.max(0, Math.round(Number(e.target.value))))} /></F>
            <div><span className="text-xs font-medium text-slate-600 mb-1 block">Weekly off (not counted as leave)</span>
              <div className="flex flex-wrap gap-2 text-xs">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
                const off: number[] = Array.isArray(lv.week_off) ? lv.week_off : [0]
                return <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={off.includes(i)} className="accent-green-600"
                  onChange={e => set('leave', 'week_off', e.target.checked ? [...off, i].sort() : off.filter(x => x !== i))} />{d}</label>
              })}</div></div>
          </div>
          <SaveBtn k="leave" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Task board (Kanban)</h2>
          <p className="text-xs text-slate-500">A WIP limit stops people starting more than they can finish: a new task can go to “Doing” only when there is room. You and the admin manager can go over it for urgent work.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <F label="Tasks in “Doing” per person (0 = no limit)"><input className={INPUT} type="number" min="0" max="20" value={kb.wip_per_person ?? 3} onChange={e => set('kanban', 'wip_per_person', Math.max(0, Math.round(Number(e.target.value))))} /></F>
            <F label="Mark a card amber after this many days in one column"><input className={INPUT} type="number" min="1" max="30" value={kb.aging_days ?? 3} onChange={e => set('kanban', 'aging_days', Math.max(1, Math.round(Number(e.target.value))))} /></F>
          </div>
          <SaveBtn k="kanban" />
        </div>

        <div className={CARD}>
          <h2 className="font-semibold text-slate-900">Company details</h2>
          <p className="text-xs text-slate-500">Printed on service invoices and commissioning reports, and put into payment reminders.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([['name', 'Company name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address'], ['state', 'State (for GST)'],
               ['gstin', 'GSTIN'], ['sac', 'SAC code for service invoices (check with your CA)'], ['upi_id', 'UPI ID for payments'], ['bank', 'Bank details (name, account, IFSC)']] as [string, string][]).map(([k, l]) => (
              <F key={k} label={l}><input className={INPUT} value={c[k] ?? ''} onChange={e => set('company', k, e.target.value)} /></F>))}
          </div>
          <SaveBtn k="company" />
        </div>
      </div>
    </div>
  )
}
