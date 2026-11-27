'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, PhoneCall, Clock, IndianRupee, Wrench, AlertTriangle, CheckCircle, Flame, Hourglass, Users } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'
import { inr, todayIso, isManager, STATUS_LABELS, whatsappLink } from '@/lib/workflow'
import { hoursAgo, daysBetween } from '@/lib/growth'

// Andon board: everything that is stuck today, for the CEO and the admin manager. Each line links to where it is fixed.

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const OPEN_FILTER = '(project_created,cancelled,rejected)'

function Section({ title, icon: Icon, tone, count, empty, children, more }: {
  title: string; icon: React.ElementType; tone: 'red' | 'amber' | 'blue' | 'green'; count: number; empty: string; children: React.ReactNode; more?: React.ReactNode
}) {
  const c = { red: 'text-red-600 bg-red-50', amber: 'text-amber-700 bg-amber-50', blue: 'text-blue-700 bg-blue-50', green: 'text-green-700 bg-green-50' }[tone]
  return (
    <div className={CARD}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={16} className={c.split(' ')[0]} />
        <h2 className="font-semibold text-sm text-slate-900">{title}</h2>
        <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${count ? c : 'bg-slate-100 text-slate-400'}`}>{count}</span>
      </div>
      {count === 0 ? <p className="px-4 py-4 text-sm text-slate-400 flex items-center gap-2"><CheckCircle size={14} className="text-green-500" /> {empty}</p>
        : <ul className="divide-y divide-slate-50 text-sm">{children}</ul>}
      {more}
    </div>
  )
}
const Item = ({ href, main, sub, right }: { href: string; main: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) => (
  <li><Link href={href} className="px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50">
    <div className="min-w-0 flex-1"><p className="text-slate-800 truncate">{main}</p>{sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}</div>
    {right && <span className="text-xs font-semibold text-slate-600 shrink-0 text-right">{right}</span>}
  </Link></li>
)

export default function ControlRoom() {
  const supabase = createClient()
  const [role, setRole] = useState<string | null>(null)
  const [d, setD] = useState<Record<string, Row[]>>({})
  const [loading, setLoading] = useState(true)
  const today = todayIso()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    setRole(me?.role ?? 'employee')
    if (!isManager(me?.role)) { setLoading(false); return }
    supabase.rpc('run_scheduled_alerts').then(() => {}, () => {})   // alerts also run from here (no-op if run recently)
    const safe = async (p: PromiseLike<{ data: unknown; error: unknown }>) => { const r = await p; return (r.error ? [] : r.data ?? []) as Row[] }
    const [quotes, stages, pays, tickets, contracts, att, leaves, rewards, commissioned] = await Promise.all([
      safe(supabase.from('quotation_requests').select('*').not('status', 'in', OPEN_FILTER).order('created_at', { ascending: false }).limit(500)),
      safe(supabase.from('project_stage_history').select('project_id, stage_name, stage_code, planned_date, status, projects!inner(id, job_number, customer_name, status)')
        .in('status', ['pending', 'in_progress', 'blocked']).lt('planned_date', today).not('projects.status', 'in', '(completed,cancelled)').order('planned_date').limit(300)),
      safe(supabase.from('project_payments').select('*, projects(id, job_number, customer_name, customer_mobile)').not('status', 'in', '(paid,waived)').order('due_date').limit(300)),
      safe(supabase.from('service_tickets').select('id, ticket_number, customer_name, kind, status, assigned_to, due_date, scheduled_for, created_at').in('status', ['open', 'assigned', 'in_progress']).order('due_date').limit(300)),
      safe(supabase.from('service_contracts').select('id, contract_number, customer_name, end_date, renewed_to, status, project_id').order('end_date').limit(500)),
      safe(supabase.from('attendance').select('id, employee_id, clock_in_time, date, profiles!attendance_employee_id_fkey(full_name)').is('clock_out_time', null).lt('clock_in_time', new Date(Date.now() - 12 * 3600000).toISOString()).gt('clock_in_time', new Date(Date.now() - 7 * 86400000).toISOString())),
      safe(supabase.from('leaves').select('id, from_date, to_date, type, profiles!leaves_employee_id_fkey(full_name)').eq('status', 'pending')),
      safe(supabase.from('referral_rewards').select('id, amount, created_at').eq('status', 'due')),
      safe(supabase.from('project_stage_history').select('project_id, actual_date, projects!inner(id, job_number, customer_name, customer_mobile, capacity_kwp)').eq('stage_code', 'commissioning').eq('status', 'completed')),
    ])
    setD({ quotes, stages, pays, tickets, contracts, att, leaves, rewards, commissioned })
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!isManager(role)) return <div className="p-10 text-center text-slate-500">The Control room is for the CEO and the admin manager.</div>

  const q = d.quotes ?? []
  const hasContact = q.some(x => 'first_contact_at' in x)
  const notCalled = hasContact ? q.filter(x => !x.first_contact_at && ['new', 'sales_review', 'site_details_pending'].includes(x.status) && Date.now() - new Date(x.created_at).getTime() > 3600000) : []
  const waitingCeo = q.filter(x => x.status === 'owner_approval_pending')
  const fuLate = q.filter(x => x.next_follow_up_date && x.next_follow_up_date < today)
  const fuToday = q.filter(x => x.next_follow_up_date === today)
  const sentQuiet = q.filter(x => ['sent_to_customer', 'customer_accepted'].includes(x.status) && (x.follow_up_count ?? 0) === 0 && x.sent_to_customer_at && daysBetween(x.sent_to_customer_at) >= 2)
  const hotNoDate = q.filter(x => x.lead_temperature === 'hot' && !x.next_follow_up_date)
  const unallocated = q.filter(x => ['new', 'sales_review'].includes(x.status) && !x.assigned_engineer_id && !x.assigned_sales_id)
  const acceptedNoJob = q.filter(x => ['customer_accepted', 'advance_pending'].includes(x.status))

  const byProject = new Map<string, Row[]>()
  for (const s of d.stages ?? []) byProject.set(s.project_id, [...(byProject.get(s.project_id) ?? []), s])
  const stuck = Array.from(byProject.values()).sort((a, b) => a[0].planned_date.localeCompare(b[0].planned_date))

  const pays = d.pays ?? []
  const due = (p: Row) => Number(p.amount) - Number(p.amount_received ?? 0)
  const overdue = pays.filter(p => p.due_date && p.due_date < today)
  const soon = pays.filter(p => p.due_date && p.due_date >= today && daysBetween(today, p.due_date) <= 7)
  const outstanding = pays.reduce((t, p) => t + due(p), 0)

  const tk = d.tickets ?? []
  const tkLate = tk.filter(t => t.due_date && t.due_date < today)
  const tkUnassigned = tk.filter(t => !t.assigned_to && (t.kind !== 'amc_visit' || (t.scheduled_for && daysBetween(today, t.scheduled_for) <= 7)))
  const contracts = d.contracts ?? []
  const renewals = contracts.filter(c => c.status === 'active' && !c.renewed_to && daysBetween(today, c.end_date) <= 30)
  const withAmc = new Set(contracts.filter(c => c.status === 'active').map(c => c.project_id))
  const noAmc = (d.commissioned ?? []).filter(s => !withAmc.has(s.project_id))

  const weekLeads = q.filter(x => daysBetween(x.created_at) < 7).length

  const kpis: [string, string | number, string][] = [
    ['Open leads & quotations', q.length, `${weekLeads} new this week`],
    ['Not called within 1 hour', notCalled.length, notCalled.length ? 'call them first' : 'all contacted'],
    ['Waiting for CEO approval', waitingCeo.length, waitingCeo.length ? `oldest ${hoursAgo(waitingCeo[waitingCeo.length - 1].updated_at ?? waitingCeo[waitingCeo.length - 1].created_at)}` : '—'],
    ['Money to collect', inr(outstanding), `${inr(overdue.reduce((t, p) => t + due(p), 0))} overdue`],
  ]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Control room" subtitle="What is stuck today: fix from the top down" />
      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(([l, v, s]) => (
            <div key={l} className={`${CARD} p-4`}><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold text-slate-900">{v}</p><p className="text-xs text-slate-400">{s}</p></div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Leads not called within the hour" icon={PhoneCall} tone="red" count={notCalled.length}
            empty={hasContact ? 'Every lead has been contacted.' : 'Shows once the growth database update is run.'}>
            {notCalled.slice(0, 8).map(x => <Item key={x.id} href={`/staff/quotations/${x.id}`} main={`${x.customer_name} · ${x.mobile}`}
              sub={`${x.city ?? ''} · ${x.source ?? ''} · ${x.quotation_number}`} right={<span className="text-red-600">{hoursAgo(x.created_at)}</span>} />)}
          </Section>
          <Section title="Waiting for the CEO's approval" icon={Hourglass} tone="amber" count={waitingCeo.length} empty="Nothing waiting.">
            {waitingCeo.slice(0, 8).map(x => <Item key={x.id} href={`/staff/quotations/${x.id}`} main={x.customer_name}
              sub={`${x.quotation_number} · ${x.admin_capacity_kw ?? '?'} kW`} right={inr(x.admin_total_cost)} />)}
          </Section>
          <Section title="Follow-ups overdue / due today" icon={Clock} tone="red" count={fuLate.length + fuToday.length} empty="No follow-up is late.">
            {[...fuLate, ...fuToday].sort((a, b) => Number(b.lead_temperature === 'hot') - Number(a.lead_temperature === 'hot')).slice(0, 10).map(x => (
              <Item key={x.id} href={`/staff/quotations/${x.id}`} main={<>{x.lead_temperature === 'hot' && '🔥 '}{x.customer_name} · {STATUS_LABELS[x.status] ?? x.status}</>}
                sub={`${x.mobile} · ${x.follow_up_count ?? 0} follow-ups so far`} right={<span className={x.next_follow_up_date < today ? 'text-red-600' : 'text-amber-600'}>{x.next_follow_up_date < today ? `${daysBetween(x.next_follow_up_date)} d late` : 'today'}</span>} />))}
          </Section>
          <Section title="Quotes sent but never followed up" icon={Flame} tone="amber" count={sentQuiet.length + hotNoDate.length} empty="Every shared quote has a follow-up.">
            {[...sentQuiet, ...hotNoDate.filter(h => !sentQuiet.includes(h))].slice(0, 8).map(x => <Item key={x.id} href={`/staff/quotations/${x.id}`} main={x.customer_name}
              sub={x.sent_to_customer_at ? `Sent ${daysBetween(x.sent_to_customer_at)} days ago, no follow-up logged` : 'Hot, but no next follow-up date'} right={inr(x.admin_total_cost)} />)}
          </Section>
          <Section title="Not given to anyone" icon={Users} tone="amber" count={unallocated.length} empty="Every new enquiry has someone on it.">
            {unallocated.slice(0, 8).map(x => <Item key={x.id} href={`/staff/quotations/${x.id}`} main={x.customer_name} sub={`${x.city ?? ''} · ${hoursAgo(x.created_at)} ago`} right="allocate" />)}
          </Section>
          <Section title="Accepted: create the job card" icon={CheckCircle} tone="green" count={acceptedNoJob.length} empty="No accepted quote is waiting.">
            {acceptedNoJob.slice(0, 8).map(x => <Item key={x.id} href={`/staff/quotations/${x.id}`} main={x.customer_name} sub={x.lead_temperature === 'hot' ? 'Hot: ready for the job card' : 'Mark HOT, then create the job card'} right={inr(x.admin_total_cost)} />)}
          </Section>

          <Section title="Projects with overdue milestones" icon={AlertTriangle} tone="red" count={stuck.length} empty="Every project is on schedule.">
            {stuck.slice(0, 8).map(rs => { const p = rs[0].projects; return (
              <Item key={rs[0].project_id} href={`/staff/projects/${rs[0].project_id}`} main={`${p?.job_number ?? ''} · ${p?.customer_name ?? ''}`}
                sub={`${rs.length} overdue: ${rs.slice(0, 2).map(s => s.stage_name).join('; ')}${rs.length > 2 ? '…' : ''}`} right={<span className="text-red-600">{daysBetween(rs[0].planned_date)} d late</span>} />) })}
          </Section>
          <Section title="Customer payments overdue / due this week" icon={IndianRupee} tone="red" count={overdue.length + soon.length} empty="No payment is due."
            more={<Link href="/staff/money" className="block px-4 py-2 text-xs text-green-700 hover:underline border-t border-slate-100">Money &amp; subsidy →</Link>}>
            {[...overdue, ...soon].slice(0, 8).map(p => <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
              <Link href={`/staff/projects/${p.project_id}`} className="min-w-0 flex-1 hover:underline"><p className="truncate">{p.projects?.job_number} · {p.projects?.customer_name}</p>
                <p className="text-xs text-slate-500 truncate">{p.milestone_name} · due {p.due_date}</p></Link>
              <span className={`text-xs font-semibold ${p.due_date < today ? 'text-red-600' : 'text-amber-600'}`}>{inr(due(p))}</span>
              {p.projects?.customer_mobile && <a target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 hover:underline"
                href={whatsappLink(p.projects.customer_mobile, `Dear ${p.projects.customer_name}, a gentle reminder from Greenergy Solar Solutions: ${inr(due(p))} for "${p.milestone_name}" on your solar project ${p.projects.job_number ?? ''} is due ${p.due_date < today ? 'since' : 'on'} ${new Date(p.due_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Thank you!`)}>Remind</a>}
            </li>)}
          </Section>

          <Section title="Service jobs late or not assigned" icon={Wrench} tone="red" count={tkLate.length + tkUnassigned.filter(t => !tkLate.includes(t)).length} empty="Every service job is on time."
            more={<Link href="/staff/service" className="block px-4 py-2 text-xs text-green-700 hover:underline border-t border-slate-100">Service →</Link>}>
            {[...tkLate, ...tkUnassigned.filter(t => !tkLate.includes(t))].slice(0, 8).map(t => <Item key={t.id} href={`/staff/service/${t.id}`} main={`${t.ticket_number} · ${t.customer_name}`}
              sub={`${t.kind.replace('_', ' ')} · ${t.assigned_to ? 'assigned' : 'NOT assigned'}`} right={<span className={t.due_date < today ? 'text-red-600' : 'text-amber-600'}>due {t.due_date}</span>} />)}
          </Section>
          <Section title="Repeat income: AMC to sell or renew" icon={IndianRupee} tone="blue" count={renewals.length + noAmc.length} empty="Every commissioned customer has an AMC."
            more={<Link href="/staff/service?tab=amc" className="block px-4 py-2 text-xs text-green-700 hover:underline border-t border-slate-100">AMC contracts →</Link>}>
            {renewals.slice(0, 4).map(c => <Item key={c.id} href="/staff/service?tab=amc" main={`Renew: ${c.customer_name}`} sub={`${c.contract_number} ends ${c.end_date}`} right="renew" />)}
            {noAmc.slice(0, 6).map(s => <Item key={s.project_id} href={`/staff/projects/${s.project_id}`} main={`Offer AMC: ${s.projects?.customer_name}`}
              sub={`${s.projects?.job_number ?? ''} · ${s.projects?.capacity_kwp ?? '?'} kW · commissioned ${s.actual_date ?? ''}`} right="no AMC" />)}
          </Section>

          <Section title="People: forgotten clock-outs, leave to approve, rewards to pay" icon={Users} tone="amber"
            count={(d.att ?? []).length + (d.leaves ?? []).length + (d.rewards ?? []).length} empty="Nothing waiting.">
            {(d.att ?? []).map(a => <Item key={a.id} href="/staff/attendance" main={`${a.profiles?.full_name ?? 'Someone'} did not clock out`} sub={`Clocked in ${new Date(a.clock_in_time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`} right="correct" />)}
            {(d.leaves ?? []).map(l => <Item key={l.id} href="/staff/leave" main={`Leave: ${l.profiles?.full_name ?? ''}`} sub={`${l.type ?? ''} · ${l.from_date} → ${l.to_date}`} right="decide" />)}
            {(d.rewards ?? []).length > 0 && <Item href="/staff/growth" main={`${d.rewards.length} referral reward${d.rewards.length > 1 ? 's' : ''} to pay`} sub="Thank the customers who sent you work" right={inr(d.rewards.reduce((t, r) => t + Number(r.amount), 0))} />}
          </Section>
        </div>
        <p className="text-xs text-slate-400">Opening this page also sends the due alerts (leads not called, follow-ups, overdue payments, service jobs). With the background job set up, they are sent every 15 minutes anyway.</p>
      </div>
    </div>
  )
}
