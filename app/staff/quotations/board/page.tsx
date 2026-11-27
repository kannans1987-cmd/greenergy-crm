'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Clock, AlertTriangle, List } from 'lucide-react'
import Header from '@/components/staff/Header'
import { inr } from '@/lib/workflow'

// Sales pipeline as a Kanban board: one column per stage, the value waiting in each, and how long
// each quotation has sat there. Read-only: a quotation moves through its own steps on its page.
interface Q {
  id: string; quotation_number: string; customer_name: string; city: string | null; status: string
  admin_total_cost: number | null; total_cost_before_subsidy: number | null; admin_capacity_kw: number | null; recommended_capacity_kw: number | null
  lead_temperature: string | null; next_follow_up_date: string | null; updated_at: string; created_at: string
  assigned_sales: { full_name: string } | null; assigned_engineer: { full_name: string } | null
}

const STAGES: { key: string; label: string; statuses: string[]; ageWarn: number; owner: string }[] = [
  { key: 'enquiry',  label: 'Enquiry',          statuses: ['new', 'sales_review', 'site_details_pending'], ageWarn: 1, owner: 'Call and plan the visit' },
  { key: 'visit',    label: 'Site visit',       statuses: ['site_visit_scheduled'], ageWarn: 3, owner: 'Visit the site' },
  { key: 'prepare',  label: 'Preparing',        statuses: ['site_visit_done', 'technical_review', 'drafted', 'more_info_requested'], ageWarn: 2, owner: 'Prepare and submit' },
  { key: 'ceo',      label: 'CEO approval',     statuses: ['owner_approval_pending'], ageWarn: 1, owner: 'CEO approves' },
  { key: 'share',    label: 'Approved',         statuses: ['approved'], ageWarn: 1, owner: 'Share with the customer' },
  { key: 'customer', label: 'With customer',    statuses: ['sent_to_customer'], ageWarn: 7, owner: 'Follow up' },
  { key: 'won',      label: 'Accepted',         statuses: ['customer_accepted', 'advance_pending'], ageWarn: 3, owner: 'Advance → job card' },
]
const DAY = 86400000
const days = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / DAY))
const lakh = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(n >= 1000000 ? 1 : 2)} L` : inr(n))

export default function QuotationBoard() {
  const [rows, setRows] = useState<Q[] | null>(null)
  const [error, setError] = useState('')
  const [hot, setHot] = useState(false)

  useEffect(() => {
    fetch('/api/quotations').then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not load'); setRows(d) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load'))
  }, [])

  const cols = useMemo(() => STAGES.map(st => {
    const items = (rows ?? []).filter(q => st.statuses.includes(q.status) && (!hot || q.lead_temperature === 'hot'))
      .sort((a, b) => days(b.updated_at) - days(a.updated_at))
    const value = items.reduce((n, q) => n + Number(q.admin_total_cost ?? q.total_cost_before_subsidy ?? 0), 0)
    const ages = items.map(q => days(q.updated_at))
    const avg = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0
    return { ...st, items, value, avg, late: ages.filter(a => a >= st.ageWarn).length }
  }), [rows, hot])

  // The bottleneck: the stage holding the most quotations past its normal time
  const neck = cols.reduce<(typeof cols)[number] | null>((w, c) => (c.late > 0 && (!w || c.late > w.late) ? c : w), null)
  const open = cols.reduce((n, c) => n + c.items.length, 0)
  const value = cols.reduce((n, c) => n + c.value, 0)

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Sales pipeline board" subtitle="Every open quotation by stage: what is waiting where, and for how long" />
      <div className="flex-1 p-4 sm:p-6 max-w-[1500px] mx-auto w-full space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/staff/quotations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Quotations</Link>
          <Link href="/staff/quotations?view=all" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><List size={13} /> List view</Link>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-auto"><input type="checkbox" checked={hot} onChange={e => setHot(e.target.checked)} className="accent-orange-500" /> 🔥 Hot only</label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!rows && !error && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-green-600" /></div>}

        {rows && (<>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="bg-white border border-slate-100 rounded-xl px-3 py-2"><b>{open}</b> open · <b>{lakh(value)}</b> in the pipeline</span>
            {neck && <span className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Bottleneck: <b>{neck.label}</b> — {neck.late} waiting longer than {neck.ageWarn} day{neck.ageWarn === 1 ? '' : 's'} ({neck.owner.toLowerCase()})</span>}
          </div>

          <div className="overflow-x-auto pb-2">
            <div className="grid grid-flow-col auto-cols-[minmax(210px,1fr)] gap-3 min-w-[1100px]">
              {cols.map(c => (
                <div key={c.key} className={`rounded-xl p-2 space-y-2 ${neck?.key === c.key ? 'bg-amber-100/60 ring-1 ring-amber-300' : 'bg-slate-100/70'}`}>
                  <div className="px-1">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">{c.label} <span className="text-slate-400">{c.items.length}</span></p>
                    <p className="text-[11px] text-slate-500">{c.items.length ? lakh(c.value) : '—'} · {c.owner}</p>
                  </div>
                  {c.items.map(q => {
                    const age = days(q.updated_at)
                    const late = age >= c.ageWarn
                    const fuLate = q.next_follow_up_date && q.next_follow_up_date < new Date().toISOString().slice(0, 10)
                    return (
                      <Link key={q.id} href={`/staff/quotations/${q.id}`}
                        className={`block bg-white rounded-lg border p-2 text-xs space-y-0.5 hover:shadow ${late ? 'border-amber-300' : 'border-slate-200'}`}>
                        <p className="font-semibold text-slate-800 text-[13px] flex items-center gap-1">
                          {q.lead_temperature === 'hot' && <span title="Hot">🔥</span>}{q.lead_temperature === 'cold' && <span title="Cold">❄</span>}{q.customer_name}</p>
                        <p className="text-slate-500">{q.admin_capacity_kw ?? q.recommended_capacity_kw ?? '?'} kW · {inr(q.admin_total_cost ?? q.total_cost_before_subsidy)}{q.city ? ` · ${q.city}` : ''}</p>
                        <p className="flex items-center gap-2">
                          <span className={`flex items-center gap-0.5 ${late ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}><Clock size={11} />{age}d here</span>
                          {fuLate && <span className="text-red-600 font-semibold">follow-up late</span>}
                          <span className="text-slate-400 ml-auto truncate">{(q.assigned_sales ?? q.assigned_engineer)?.full_name.split(' ')[0] ?? 'nobody'}</span>
                        </p>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">“Days here” counts from the quotation&apos;s last change. Each column turns a card amber after its normal time (Enquiry 1 day, Site visit 3, Preparing 2, CEO approval 1, Approved 1, With customer 7, Accepted 3).</p>
        </>)}
      </div>
    </div>
  )
}
