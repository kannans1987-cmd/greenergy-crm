'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'
import { inr, isManager } from '@/lib/workflow'
import { LOST_REASONS, lostLabel, SOURCE_LABELS } from '@/lib/growth'

// Sales insights: funnel, where the jobs come from, why deals are lost (Pareto), speed to lead, cycle time,
// team hours. Numbers become meaningful after about 30 enquiries; until then the counts are the story.

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const PERIODS: [string, number | null][] = [['30 days', 30], ['90 days', 90], ['12 months', 365], ['All', null]]
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

// One series, one hue: bar length = magnitude; label and value in ink, never in the bar colour
function Bars({ rows, max, unit = '' }: { rows: { label: string; value: number; note?: string }[]; max: number; unit?: string }) {
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${r.value}${unit}${r.note ? ' · ' + r.note : ''}`}>
          <span className="text-slate-700 truncate">{r.label}</span>
          <span className="h-3 bg-slate-100 rounded-r"><span className="block h-3 bg-green-700 rounded-r" style={{ width: `${max ? Math.max(r.value ? 2 : 0, (r.value / max) * 100) : 0}%` }} /></span>
          <span className="text-slate-900 font-semibold tabular-nums text-right w-24">{r.value}{unit}{r.note && <span className="block text-[11px] font-normal text-slate-500">{r.note}</span>}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Insights() {
  const supabase = createClient()
  const [role, setRole] = useState<string | null>(null)
  const [days, setDays] = useState<number | null>(90)
  const [quotes, setQuotes] = useState<Row[]>([])
  const [hist, setHist] = useState<Row[]>([])
  const [att, setAtt] = useState<Row[]>([])
  const [people, setPeople] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    setRole(me?.role ?? null)
    if (!isManager(me?.role)) { setLoading(false); return }
    const monthStart = new Date(); monthStart.setDate(1)
    const [{ data: q }, { data: h }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('quotation_requests').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('quotation_status_history').select('quotation_id, to_status, created_at').limit(20000),
      supabase.from('attendance').select('*').gte('date', monthStart.toISOString().slice(0, 10)),
      supabase.from('profiles').select('id, full_name, role').eq('status', 'active').neq('role', 'admin'),
    ])
    setQuotes(q ?? []); setHist(h ?? []); setAtt(a ?? []); setPeople(p ?? []); setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  const m = useMemo(() => {
    const since = days ? Date.now() - days * 86400000 : 0
    const qs = quotes.filter(q => new Date(q.created_at).getTime() >= since)
    const reached = new Map<string, Set<string>>()
    for (const h of hist) reached.set(h.quotation_id, (reached.get(h.quotation_id) ?? new Set()).add(h.to_status))
    const got = (q: Row, ...st: string[]) => st.some(s => q.status === s || reached.get(q.id)?.has(s))
    const contacted = (q: Row) => !!q.first_contact_at || !['new'].includes(q.status) || got(q, 'site_visit_scheduled')
    const visited = (q: Row) => !!q.site_visit_done_at || got(q, 'site_visit_done')
    const quoted = (q: Row) => !!q.sent_to_customer_at || got(q, 'sent_to_customer', 'customer_accepted', 'project_created')
    const accepted = (q: Row) => got(q, 'customer_accepted', 'advance_pending', 'project_created')
    const won = (q: Row) => q.status === 'project_created'
    const funnel = [
      { label: 'Enquiries', value: qs.length },
      { label: 'Contacted', value: qs.filter(contacted).length },
      { label: 'Site visit done', value: qs.filter(visited).length },
      { label: 'Quotation shared', value: qs.filter(quoted).length },
      { label: 'Customer accepted', value: qs.filter(accepted).length },
      { label: 'Job card (won)', value: qs.filter(won).length },
    ].map((r, i, all) => ({ ...r, note: i ? `${pct(r.value, all[i - 1].value)}% of previous` : undefined }))

    const sources = Object.keys({ ...SOURCE_LABELS, ...Object.fromEntries(qs.map(q => [q.source ?? 'other', 1])) }).map(s => {
      const rows = qs.filter(q => (q.source ?? 'other') === s)
      const w = rows.filter(won)
      return { source: SOURCE_LABELS[s] ?? s, leads: rows.length, won: w.length, rate: pct(w.length, rows.length), value: w.reduce((t, q) => t + Number(q.admin_total_cost ?? 0), 0) }
    }).filter(r => r.leads > 0).sort((a, b) => b.leads - a.leads)

    const lostRows = qs.filter(q => q.status === 'cancelled')
    const lostCounts = [...LOST_REASONS.map(r => r.code), null].map(code => ({ code, n: lostRows.filter(q => (q.lost_reason_code ?? null) === code).length }))
      .filter(r => r.n > 0).sort((a, b) => b.n - a.n)
    let cum = 0
    const pareto = lostCounts.map(r => { cum += r.n; return { label: r.code ? lostLabel(r.code) : 'No reason recorded', value: r.n, note: `${pct(cum, lostRows.length)}% cumulative` } })

    const speed = qs.filter(q => q.first_contact_at && ['website', 'referral'].includes(q.source))
      .map(q => (new Date(q.first_contact_at).getTime() - new Date(q.created_at).getTime()) / 60000).filter(x => x >= 0)
    const medSpeed = median(speed)
    const within1h = pct(speed.filter(x => x <= 60).length, speed.length)
    const notCalled = qs.filter(q => 'first_contact_at' in q && !q.first_contact_at && ['website', 'referral'].includes(q.source)).length

    const cycle = qs.filter(q => q.sent_to_customer_at && (q.converted_at || (q.status === 'cancelled' && q.updated_at)))
      .map(q => (new Date(q.converted_at ?? q.updated_at).getTime() - new Date(q.sent_to_customer_at).getTime()) / 86400000)
    const wins = qs.filter(won)
    const kwWon = wins.reduce((t, q) => t + Number(q.admin_capacity_kw ?? 0), 0)
    const preGstWon = wins.reduce((t, q) => t + Number(q.admin_system_cost ?? 0), 0)
    const valueWon = wins.reduce((t, q) => t + Number(q.admin_total_cost ?? 0), 0)
    const pipeline = qs.filter(q => ['approved', 'sent_to_customer', 'customer_accepted', 'advance_pending'].includes(q.status))
    const autoN = qs.filter(q => q.auto_approved).length
    const approvedN = qs.filter(q => q.approved_at).length

    // Team hours this month: attended, on project sites, on service jobs
    const team = people.map(p => {
      const rs = att.filter(a => a.employee_id === p.id)
      const total = rs.reduce((t, a) => t + Number(a.total_hours ?? 0), 0)
      const service = rs.filter(a => a.service_ticket_id).reduce((t, a) => t + Number(a.total_hours ?? 0), 0)
      const site = rs.filter(a => a.project_id && !a.service_ticket_id).reduce((t, a) => t + Number(a.total_hours ?? 0), 0)
      return { name: p.full_name, days: new Set(rs.map(a => a.date)).size, total, site, service, office: total - site - service }
    }).filter(t => t.total > 0).sort((a, b) => b.total - a.total)

    return { qs, funnel, sources, pareto, lostN: lostRows.length, medSpeed, within1h, speedN: speed.length, notCalled, medCycle: median(cycle), cycleN: cycle.length,
      wins: wins.length, kwWon, perKw: kwWon ? preGstWon / kwWon : null, valueWon, avgDeal: wins.length ? valueWon / wins.length : null,
      pipelineN: pipeline.length, pipelineValue: pipeline.reduce((t, q) => t + Number(q.admin_total_cost ?? 0), 0), autoN, approvedN, team }
  }, [quotes, hist, att, people, days])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!isManager(role)) return <div className="p-10 text-center text-slate-500">Sales insights are for the CEO and the admin manager.</div>

  const fmtMin = (x: number | null) => x == null ? '—' : x < 60 ? `${Math.round(x)} min` : x < 2880 ? `${(x / 60).toFixed(1)} h` : `${Math.round(x / 1440)} days`
  const tiles: [string, string, string][] = [
    ['Jobs won', String(m.wins), `${m.kwWon.toFixed(1)} kW · ${inr(m.valueWon)}`],
    ['Win rate', `${pct(m.wins, m.qs.length)}%`, `${m.wins} of ${m.qs.length} enquiries`],
    ['Average job', inr(m.avgDeal), m.perKw ? `${inr(m.perKw)}/kW before GST` : 'no wins yet'],
    ['Open pipeline', inr(m.pipelineValue), `${m.pipelineN} quotations with customers`],
    ['First call (median)', fmtMin(m.medSpeed), m.speedN ? `${m.within1h}% within 1 hour · ${m.notCalled} not called` : 'no website leads yet'],
    ['Quote → decision', m.medCycle == null ? '—' : `${Math.round(m.medCycle)} days`, m.cycleN ? `median of ${m.cycleN}` : 'no decisions yet'],
  ]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Sales insights" subtitle="Where enquiries come from, where they drop out and why" />
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Enquiries received in the last</span>
          {PERIODS.map(([l, v]) => (
            <button key={l} onClick={() => setDays(v)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${days === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600'}`}>{l}</button>
          ))}
        </div>
        {m.qs.length < 30 && <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">Only {m.qs.length} enquiries in this period. Percentages swing a lot below about 30, so read the counts, not the rates. The more leads go into the CRM, the more this page can tell you.</p>}

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map(([l, v, s]) => <div key={l} className={`${CARD} p-4`}><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold text-slate-900">{v}</p><p className="text-xs text-slate-500">{s}</p></div>)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${CARD} p-5`}>
            <h2 className="font-semibold text-sm text-slate-900">Sales funnel</h2>
            <p className="text-xs text-slate-500 mb-4">How many enquiries reach each step. The biggest drop is where to work first.</p>
            <Bars rows={m.funnel} max={m.funnel[0].value} />
          </div>
          <div className={`${CARD} p-5`}>
            <h2 className="font-semibold text-sm text-slate-900">Why deals are lost</h2>
            <p className="text-xs text-slate-500 mb-4">{m.lostN} lost in this period, most common first. Fix the top one or two reasons first; together they are usually most of the losses.</p>
            {m.pareto.length ? <Bars rows={m.pareto} max={m.pareto[0].value} /> : <p className="text-sm text-slate-400">No lost quotations in this period.</p>}
          </div>
        </div>

        <div className={CARD}>
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm text-slate-900">Where the jobs come from</h2>
            <p className="text-xs text-slate-500">Spend time and money on the sources that turn into jobs, not just enquiries.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Source', 'Enquiries', 'Jobs won', 'Win rate', 'Value won'].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {m.sources.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No enquiries in this period.</td></tr> : m.sources.map(s => (
                <tr key={s.source}><td className="px-4 py-2 font-medium">{s.source}</td><td className="px-4 py-2 tabular-nums">{s.leads}</td><td className="px-4 py-2 tabular-nums">{s.won}</td>
                  <td className="px-4 py-2 tabular-nums">{s.rate}%</td><td className="px-4 py-2 tabular-nums">{inr(s.value)}</td></tr>))}
            </tbody>
          </table></div>
        </div>

        <div className={CARD}>
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm text-slate-900">Team hours this month</h2>
            <p className="text-xs text-slate-500">From attendance. Site = project work, Service = O&amp;M jobs (billable or AMC). Attendance shows presence, not output: compare with kW installed and jobs closed.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Name', 'Days', 'Hours', 'Site', 'Service', 'Office / other'].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {m.team.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No attendance this month yet.</td></tr> : m.team.map(t => (
                <tr key={t.name}><td className="px-4 py-2 font-medium">{t.name}</td><td className="px-4 py-2 tabular-nums">{t.days}</td><td className="px-4 py-2 tabular-nums">{t.total.toFixed(1)}</td>
                  <td className="px-4 py-2 tabular-nums">{t.site.toFixed(1)}</td><td className="px-4 py-2 tabular-nums">{t.service.toFixed(1)}</td><td className="px-4 py-2 tabular-nums">{t.office.toFixed(1)}</td></tr>))}
            </tbody>
          </table></div>
        </div>

        <div className={`${CARD} p-5 text-sm text-slate-700 space-y-2`}>
          <h2 className="font-semibold text-slate-900">Monday 30-minute review (kaizen)</h2>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Funnel: which step lost the most enquiries since last week? Pick one action for it.</li>
            <li>Lost reasons: read the notes behind the top reason. Is it price, speed or trust?</li>
            <li>First call: any lead not called within the hour? Who was on it, and what stopped them?</li>
            <li>Control room: clear everything red before Wednesday.</li>
          </ol>
          <p className="text-xs text-slate-500">Auto-approved: {m.autoN} of {m.approvedN} approved quotations in this period (Business rules).</p>
        </div>
      </div>
    </div>
  )
}
