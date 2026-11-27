'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'
import { inr, todayIso, isManager, whatsappLink } from '@/lib/workflow'
import { daysBetween } from '@/lib/growth'

// Cash: what customers owe and when, reminders by WhatsApp, money received this month,
// and where each net-meter and subsidy file is waiting (the slowest part of a solar job).

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const TRACK: [string, string][] = [
  ['discom_application', 'DISCOM application'], ['discom_inspection', 'Inspection'], ['net_meter_sync', 'Net meter'],
  ['commissioning', 'Commissioned'], ['pmsg_application', 'PM Surya Ghar applied'], ['subsidy_claim', 'Subsidy claimed'],
  ['central_subsidy', 'Central credited'], ['state_subsidy', 'State credited'],
]
const fmt = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''

export default function Money() {
  const supabase = createClient()
  const [role, setRole] = useState<string | null>(null)
  const [pays, setPays] = useState<Row[]>([])
  const [receipts, setReceipts] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [stages, setStages] = useState<Row[]>([])
  const [company, setCompany] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const today = todayIso()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    setRole(me?.role ?? null)
    if (!isManager(me?.role)) { setLoading(false); return }
    const monthStart = today.slice(0, 8) + '01'
    const [{ data: p }, { data: r }, { data: pr }, { data: st }, { data: co }] = await Promise.all([
      supabase.from('project_payments').select('*, projects(id, job_number, customer_name, customer_mobile, status)').order('due_date', { nullsFirst: false }),
      supabase.from('payment_receipts').select('amount, received_on, mode').gte('received_on', monthStart),
      supabase.from('projects').select('id, job_number, customer_name, customer_mobile, subsidy_job, status, region').not('status', 'eq', 'cancelled').not('job_number', 'is', null),
      supabase.from('project_stage_history').select('project_id, stage_code, status, actual_date, planned_date').in('stage_code', TRACK.map(t => t[0])),
      supabase.from('business_settings').select('data').eq('key', 'company').maybeSingle(),
    ])
    setPays(p ?? []); setReceipts(r ?? []); setProjects(pr ?? []); setStages(st ?? []); setCompany(co?.data ?? {}); setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!isManager(role)) return <div className="p-10 text-center text-slate-500">This page is for the CEO and the admin manager.</div>

  const open = pays.filter(p => !['paid', 'waived'].includes(p.status) && p.projects?.status !== 'cancelled')
  const due = (p: Row) => Number(p.amount) - Number(p.amount_received ?? 0)
  const overdue = open.filter(p => p.due_date && p.due_date < today)
  const next30 = open.filter(p => p.due_date && p.due_date >= today && daysBetween(today, p.due_date) <= 30)
  const noDate = open.filter(p => !p.due_date)
  const sum = (xs: Row[]) => xs.reduce((t, p) => t + due(p), 0)
  const got = receipts.reduce((t, r) => t + Number(r.amount), 0)
  const payNote = [company.upi_id && `UPI: ${company.upi_id}`, company.bank && `Bank: ${company.bank}`].filter(Boolean).join(' · ')
  const remind = (p: Row) => `Dear ${p.projects?.customer_name ?? 'Sir / Madam'}, a gentle reminder from ${company.name ?? 'Greenergy Solar Solutions'}: ${inr(due(p))} for "${p.milestone_name}" on your solar project ${p.projects?.job_number ?? ''} is ${p.due_date && p.due_date < today ? 'overdue since' : 'due on'} ${fmt(p.due_date)}.${payNote ? ' ' + payNote + '.' : ''} Please share the payment reference once paid. Thank you!`

  const stageOf = new Map<string, Row>()
  for (const s of stages) stageOf.set(s.project_id + '|' + s.stage_code, s)
  // Projects still waiting somewhere on the grid-connection / subsidy path
  const tracked = projects.map(p => {
    const cells = TRACK.map(([code]) => stageOf.get(p.id + '|' + code) ?? null)
    const relevant = cells.filter(c => c && c.status !== 'skipped')
    const done = relevant.filter(c => c!.status === 'completed')
    const lastDone = done.map(c => c!.actual_date).filter(Boolean).sort().pop() as string | undefined
    const waiting = relevant.find(c => c!.status !== 'completed')
    return { p, cells, waiting, waitDays: waiting && lastDone ? daysBetween(lastDone) : null, finished: relevant.length > 0 && !waiting }
  }).filter(t => t.cells.some(Boolean) && !t.finished).sort((a, b) => (b.waitDays ?? -1) - (a.waitDays ?? -1))

  const PayRow = ({ p }: { p: Row }) => (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2"><Link href={`/staff/projects/${p.project_id}`} className="font-medium hover:underline">{p.projects?.job_number ?? '—'}</Link>
        <p className="text-xs text-slate-500">{p.projects?.customer_name}</p></td>
      <td className="px-4 py-2 text-slate-600">{p.milestone_name}{p.status === 'partial' && <span className="block text-xs text-amber-700">part paid {inr(p.amount_received)}</span>}</td>
      <td className={`px-4 py-2 tabular-nums ${p.due_date && p.due_date < today ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{p.due_date ? fmt(p.due_date) : 'milestone not dated'}
        {p.due_date && p.due_date < today && <span className="block text-xs font-normal">{daysBetween(p.due_date)} days late</span>}</td>
      <td className="px-4 py-2 font-semibold tabular-nums text-right">{inr(due(p))}</td>
      <td className="px-4 py-2 text-right">{p.projects?.customer_mobile && <a target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-green-700 hover:underline" href={whatsappLink(p.projects.customer_mobile, remind(p))}>WhatsApp reminder</a>}</td>
    </tr>
  )
  const PayTable = ({ rows, empty }: { rows: Row[]; empty: string }) => (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Job', 'For', 'Due', 'Amount due', ''].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-50">{rows.length ? rows.map(p => <PayRow key={p.id} p={p} />) : <tr><td colSpan={5} className="px-4 py-5 text-center text-slate-400">{empty}</td></tr>}</tbody>
    </table></div>
  )

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Money & subsidy" subtitle="What customers owe, and where net-meter and subsidy files are waiting" />
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([['Still to collect', inr(sum(open)), `${open.length} payments`], ['Overdue', inr(sum(overdue)), `${overdue.length} payments`],
             ['Due in 30 days', inr(sum(next30)), `${next30.length} payments`], ['Received this month', inr(got), `${receipts.length} receipts`]] as [string, string, string][]).map(([l, v, s]) => (
            <div key={l} className={`${CARD} p-4`}><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold text-slate-900">{v}</p><p className="text-xs text-slate-500">{s}</p></div>))}
        </div>
        {!payNote && <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">Tip: add your UPI ID and bank details in Business rules → Company, and they are put into every payment reminder.</p>}

        <div className={CARD}><div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm text-red-700">Overdue</h2></div>
          <PayTable rows={overdue} empty="Nothing overdue." /></div>
        <div className={CARD}><div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Due in the next 30 days</h2>
          <p className="text-xs text-slate-500">Due dates follow the milestones (advance on order, 40% at material ordering, balance at commissioning). Move a milestone date and its payment moves too.</p></div>
          <PayTable rows={next30} empty="Nothing due in the next 30 days." /></div>
        {noDate.length > 0 && <div className={CARD}><div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Pending, milestone not dated yet</h2></div>
          <PayTable rows={noDate} empty="" /></div>}

        <div className={CARD}>
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Net meter &amp; subsidy tracker</h2>
            <p className="text-xs text-slate-500">Every job still waiting on the grid connection or the subsidy, longest wait first. “Waiting” counts days since the last step was done: chase the DISCOM / portal when it grows.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-3 py-2">Job</th>{TRACK.map(([c, l]) => <th key={c} className="px-2 py-2 text-center font-medium">{l}</th>)}<th className="px-3 py-2 text-right">Waiting</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {tracked.length === 0 ? <tr><td colSpan={TRACK.length + 2} className="px-4 py-6 text-center text-slate-400 text-sm">Nothing waiting.</td></tr> : tracked.map(t => (
                <tr key={t.p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2"><Link href={`/staff/projects/${t.p.id}`} className="font-medium hover:underline">{t.p.job_number}</Link><p className="text-slate-500">{t.p.customer_name}</p></td>
                  {t.cells.map((c, i) => (
                    <td key={i} className="px-2 py-2 text-center" title={c ? `${TRACK[i][1]}: ${c.status}${c.actual_date ? ' on ' + fmt(c.actual_date) : c.planned_date ? ', planned ' + fmt(c.planned_date) : ''}` : 'not on this job'}>
                      {!c || c.status === 'skipped' ? <span className="text-slate-300">—</span>
                        : c.status === 'completed' ? <span className="text-green-700 font-semibold">✓ {fmt(c.actual_date)}</span>
                        : c === t.waiting ? <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">waiting</span>
                        : <span className="text-slate-400">…</span>}
                    </td>))}
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${(t.waitDays ?? 0) > 30 ? 'text-red-600' : 'text-slate-700'}`}>{t.waitDays != null ? `${t.waitDays} d` : '—'}</td>
                </tr>))}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  )
}
