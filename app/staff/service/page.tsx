'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Plus, Wrench, FileText, RefreshCw, Printer } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'
import { inr, todayIso, isManager } from '@/lib/workflow'
import { SERVICE_KINDS, SERVICE_STATUS, SERVICE_STATUS_COLORS, daysBetween } from '@/lib/growth'
import { canAllocate, allocatable, type AllocationLevel } from '@/lib/allocation'

// Service after installation: breakdown / cleaning / inspection jobs and yearly maintenance contracts (AMC).
// Technicians see the jobs given to them; the CEO and admin manager see everything and sell / renew AMCs.

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white'
const F = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) =>
  <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}</label>
const addYear = (d: string) => { const x = new Date(d + 'T00:00:00'); x.setFullYear(x.getFullYear() + 1); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10) }

function ServicePage() {
  const supabase = createClient()
  const params = useSearchParams()
  const [tab, setTab] = useState<'jobs' | 'amc'>(params.get('tab') === 'amc' ? 'amc' : 'jobs')
  const [me, setMe] = useState<{ id: string; role: string; allocation_level?: AllocationLevel } | null>(null)
  const [tickets, setTickets] = useState<Row[]>([])
  const [contracts, setContracts] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [staff, setStaff] = useState<Row[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [form, setForm] = useState<Row | null>(null)
  const [amc, setAmc] = useState<Row | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const today = todayIso()
  const mgr = isManager(me?.role)
  // Sr / Jr Admin Managers give service jobs to technicians (the database checks who to)
  const alloc = canAllocate(me?.role, me?.allocation_level)
  const say = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setMe(prof)
    const [t, c, p, s] = await Promise.all([
      supabase.from('service_tickets').select('*, technician:assigned_to(full_name)').order('due_date').limit(1000),
      isManager(prof?.role) ? supabase.from('service_contracts').select('*').order('end_date').limit(1000) : Promise.resolve({ data: [], error: null }),
      isManager(prof?.role) ? supabase.from('projects').select('id, job_number, customer_name, customer_mobile, site_address, capacity_kwp, region').not('job_number', 'is', null).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      fetch('/api/profiles').then(r => r.ok ? r.json() : { profiles: [] }).catch(() => ({ profiles: [] })),
    ])
    setMissing(!!t.error && /service_tickets|schema cache/i.test(t.error.message))
    setTickets(t.data ?? []); setContracts(c.data ?? []); setProjects(p.data ?? [])
    setStaff(allocatable(((s.profiles ?? []) as (Row & { id: string })[]).filter(x => x.role !== 'admin'), prof?.role, prof?.allocation_level))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])
  // "Offer an AMC" from a project page opens the form filled in for that customer
  useEffect(() => {
    const pid = params.get('new_amc')
    if (!pid || !projects.length) return
    fromProject(pid, setAmc, { start_date: today, visits_per_year: 2, includes_cleaning: true, plan: 'Standard', region: 'puducherry' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  const fromProject = (id: string, setter: (f: Row) => void, cur: Row) => {
    const p = projects.find(x => x.id === id)
    setter({ ...cur, project_id: id, ...(p ? { customer_name: p.customer_name ?? '', customer_mobile: p.customer_mobile ?? '', site_address: p.site_address ?? '',
      capacity_kw: p.capacity_kwp ?? '', region: p.region ?? 'puducherry' } : {}) })
  }

  async function saveTicket() {
    if (!form?.customer_name?.trim() || !form?.description?.trim()) { say('Enter the customer and what needs doing.', false); return }
    setBusy(true)
    const row: Row = { customer_name: form.customer_name.trim(), customer_mobile: form.customer_mobile || null, site_address: form.site_address || null,
      region: form.region || 'puducherry', kind: form.kind || 'breakdown', priority: form.priority || 'normal', description: form.description.trim(),
      project_id: form.project_id || null, scheduled_for: form.scheduled_for || null, created_by: me?.id }
    if (mgr) Object.assign(row, { assigned_to: form.assigned_to || null, chargeable: !!form.chargeable, charge_amount: Number(form.charge_amount) || 0 })
    else if (alloc) Object.assign(row, { assigned_to: form.assigned_to || null })
    const { error } = await supabase.from('service_tickets').insert(row)
    setBusy(false)
    if (error) return say(error.message, false)
    say(alloc ? 'Service job created' + (row.assigned_to ? ' and the technician told' : '') : 'Reported. The admin manager will assign it.'); setForm(null); load()
  }

  // Give an existing job to a technician (or take it back)
  async function assignTicket(t: Row, to: string) {
    const { data, error } = await supabase.from('service_tickets').update({ assigned_to: to || null }).eq('id', t.id).select('id')
    if (error || !data?.length) return say(error?.message ?? 'Could not change the technician.', false)
    say(to ? `${t.ticket_number} given to ${staff.find(x => x.id === to)?.full_name ?? 'the technician'} — they have been told` : `${t.ticket_number} is now unassigned`)
    load()
  }

  async function saveAmc() {
    if (!amc?.customer_name?.trim() || !amc?.start_date) { say('Enter the customer and the start date.', false); return }
    setBusy(true)
    const { error } = await supabase.from('service_contracts').insert({
      project_id: amc.project_id || null, customer_name: amc.customer_name.trim(), customer_mobile: amc.customer_mobile || null,
      site_address: amc.site_address || null, region: amc.region || 'puducherry', capacity_kw: Number(amc.capacity_kw) || null,
      plan: amc.plan || 'Standard', visits_per_year: Number(amc.visits_per_year) || 2, includes_cleaning: amc.includes_cleaning !== false,
      start_date: amc.start_date, end_date: addYear(amc.start_date), fee: Number(amc.fee) || 0, notes: amc.notes || null })
    setBusy(false)
    if (error) return say(error.message, false)
    say('AMC contract created and its visits booked'); setAmc(null); setTab('amc'); load()
  }

  async function rpc(fn: string, args: Row, ok: string) {
    const { error } = await supabase.rpc(fn, args)
    if (error) return say(error.message, false)
    say(ok); load()
  }
  async function payAmc(c: Row) {
    const ref = window.prompt(`Payment received for ${c.contract_number} (${inr(Number(c.fee) * (1 + Number(c.gst_pct) / 100))} incl. GST).\nMode and reference, e.g. "UPI 4123…":`)
    if (ref === null) return
    const mode = /upi/i.test(ref) ? 'upi' : /neft|imps|rtgs/i.test(ref) ? 'neft' : /cheque|chq/i.test(ref) ? 'cheque' : /cash/i.test(ref) ? 'cash' : 'other'
    rpc('record_service_payment', { p_kind: 'amc', p_id: c.id, p_mode: mode, p_ref: ref, p_date: today }, 'Payment recorded')
  }

  const shown = tickets.filter(t => filter === 'all' || ['open', 'assigned', 'in_progress'].includes(t.status))
  const visitsOf = (c: Row) => tickets.filter(t => t.contract_id === c.id)
  const activeAmc = contracts.filter(c => c.status === 'active')
  const amcIncome = activeAmc.reduce((t, c) => t + Number(c.fee), 0)

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Service" subtitle={mgr ? 'Service jobs and maintenance contracts (AMC)' : alloc ? 'Service jobs: give them to technicians' : 'Service jobs given to you'} />
      {msg && <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.t}</div>}
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        {missing && <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">The service database update has not been run yet (supabase/service_v1.sql).</p>}
        <div className="flex flex-wrap items-center gap-2">
          {(['jobs', ...(mgr ? ['amc'] : [])] as ('jobs' | 'amc')[]).map(k => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {k === 'jobs' ? `Service jobs (${tickets.filter(t => ['open', 'assigned', 'in_progress'].includes(t.status)).length} open)` : `AMC contracts (${activeAmc.length} active)`}</button>))}
          <span className="ml-auto flex gap-2">
            <button onClick={() => { setAmc(null); setForm({ kind: 'breakdown', priority: 'normal', region: 'puducherry' }) }} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Plus size={14} /> {alloc ? 'New service job' : 'Report a fault'}</button>
            {mgr && <button onClick={() => { setForm(null); setAmc({ start_date: today, visits_per_year: 2, includes_cleaning: true, plan: 'Standard', region: 'puducherry' }) }} className="px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Plus size={14} /> New AMC</button>}
          </span>
        </div>

        {form && (
          <div className={`${CARD} p-5 space-y-3`}>
            <h2 className="font-semibold text-sm">{alloc ? 'New service job' : 'Report a fault at a customer site'}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {mgr && <F label="Customer from a job card (fills the details)" wide><select className={INPUT} value={form.project_id ?? ''} onChange={e => fromProject(e.target.value, setForm, form)}>
                <option value="">— not our installation / type below —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.job_number} · {p.customer_name}</option>)}</select></F>}
              <F label="Customer name *"><input className={INPUT} value={form.customer_name ?? ''} onChange={e => setForm({ ...form, customer_name: e.target.value })} /></F>
              <F label="Mobile"><input className={INPUT} inputMode="tel" value={form.customer_mobile ?? ''} onChange={e => setForm({ ...form, customer_mobile: e.target.value })} /></F>
              <F label="Site address" wide><input className={INPUT} value={form.site_address ?? ''} onChange={e => setForm({ ...form, site_address: e.target.value })} /></F>
              <F label="Type"><select className={INPUT} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(SERVICE_KINDS).filter(([k]) => k !== 'amc_visit').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></F>
              <F label="Priority (sets the due date)"><select className={INPUT} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="urgent">Urgent: next day</option><option value="high">High: 2 days</option><option value="normal">Normal: 3 days</option><option value="low">Low: 7 days</option></select></F>
              <F label="What is wrong / what to do *" wide><textarea className={INPUT} rows={3} maxLength={2000} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Inverter shows grid fault since yesterday; generation zero" /></F>
              {alloc && !mgr && <F label="Technician"><select className={INPUT} value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="">— assign later —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></F>}
              {mgr && <>
                <F label="Technician"><select className={INPUT} value={form.assigned_to ?? ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="">— assign later —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></F>
                <F label="Visit date (optional)"><input className={INPUT} type="date" value={form.scheduled_for ?? ''} onChange={e => setForm({ ...form, scheduled_for: e.target.value })} /></F>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.chargeable} onChange={e => setForm({ ...form, chargeable: e.target.checked })} /> Chargeable (not under warranty / AMC)</label>
                {form.chargeable && <F label="Charge (₹, before GST)"><input className={INPUT} type="number" min="0" value={form.charge_amount ?? ''} onChange={e => setForm({ ...form, charge_amount: e.target.value })} /></F>}
              </>}
            </div>
            <div className="flex justify-end gap-2"><button className="px-4 py-2 text-sm text-slate-600" onClick={() => setForm(null)}>Cancel</button>
              <button className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={busy} onClick={saveTicket}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        )}

        {amc && (
          <div className={`${CARD} p-5 space-y-3`}>
            <h2 className="font-semibold text-sm">New maintenance contract (AMC), one year</h2>
            <p className="text-xs text-slate-500">The CRM books the visits across the year as service jobs, reminds you to assign them, and reminds you 30 days before it ends to offer the renewal.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <F label="Customer from a job card" wide><select className={INPUT} value={amc.project_id ?? ''} onChange={e => fromProject(e.target.value, setAmc, amc)}>
                <option value="">— not our installation / type below —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.job_number} · {p.customer_name}</option>)}</select></F>
              <F label="Customer name *"><input className={INPUT} value={amc.customer_name ?? ''} onChange={e => setAmc({ ...amc, customer_name: e.target.value })} /></F>
              <F label="Mobile"><input className={INPUT} inputMode="tel" value={amc.customer_mobile ?? ''} onChange={e => setAmc({ ...amc, customer_mobile: e.target.value })} /></F>
              <F label="Site address" wide><input className={INPUT} value={amc.site_address ?? ''} onChange={e => setAmc({ ...amc, site_address: e.target.value })} /></F>
              <F label="System size (kW)"><input className={INPUT} type="number" min="0" step="0.01" value={amc.capacity_kw ?? ''} onChange={e => setAmc({ ...amc, capacity_kw: e.target.value })} /></F>
              <F label="State (for GST on the invoice)"><select className={INPUT} value={amc.region} onChange={e => setAmc({ ...amc, region: e.target.value })}><option value="puducherry">Puducherry</option><option value="tamilnadu">Tamil Nadu</option></select></F>
              <F label="Plan name"><input className={INPUT} value={amc.plan ?? ''} onChange={e => setAmc({ ...amc, plan: e.target.value })} placeholder="Standard / Premium" /></F>
              <F label="Visits per year"><input className={INPUT} type="number" min="1" max="12" value={amc.visits_per_year} onChange={e => setAmc({ ...amc, visits_per_year: e.target.value })} /></F>
              <F label="Start date *"><input className={INPUT} type="date" value={amc.start_date} onChange={e => setAmc({ ...amc, start_date: e.target.value })} /></F>
              <F label="Yearly fee (₹, before GST)"><input className={INPUT} type="number" min="0" value={amc.fee ?? ''} onChange={e => setAmc({ ...amc, fee: e.target.value })} /></F>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={amc.includes_cleaning !== false} onChange={e => setAmc({ ...amc, includes_cleaning: e.target.checked })} /> Panel cleaning included</label>
              <F label="Notes"><input className={INPUT} value={amc.notes ?? ''} onChange={e => setAmc({ ...amc, notes: e.target.value })} /></F>
            </div>
            <div className="flex justify-end gap-2"><button className="px-4 py-2 text-sm text-slate-600" onClick={() => setAmc(null)}>Cancel</button>
              <button className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={busy} onClick={saveAmc}>{busy ? 'Saving…' : 'Create contract'}</button></div>
          </div>
        )}

        {tab === 'jobs' && (
          <div className={CARD}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2"><Wrench size={16} className="text-green-600" /><h2 className="font-semibold text-sm">Service jobs</h2>
              <span className="ml-auto flex gap-1">{(['open', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{f === 'open' ? 'Open' : 'All'}</button>)}</span></div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Job', 'Customer', 'Type', 'Technician', 'Due', 'Status'].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-50">
                {shown.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">{filter === 'open' ? 'No open service jobs.' : 'No service jobs yet.'}</td></tr> : shown.map(t => {
                  const late = ['open', 'assigned', 'in_progress'].includes(t.status) && t.due_date && t.due_date < today
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2"><Link href={`/staff/service/${t.id}`} className="font-mono text-xs text-green-700 hover:underline">{t.ticket_number}</Link></td>
                      <td className="px-4 py-2"><p className="font-medium">{t.customer_name}</p><p className="text-xs text-slate-500 truncate max-w-[220px]">{t.description}</p></td>
                      <td className="px-4 py-2 text-slate-600">{SERVICE_KINDS[t.kind] ?? t.kind}{t.chargeable && <span className="block text-xs text-slate-500">{inr(t.charge_amount)} + GST</span>}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {alloc && ['open', 'assigned'].includes(t.status) && (!t.assigned_to || staff.some(s => s.id === t.assigned_to)) ? (
                          <select className="border border-slate-200 rounded-md px-1.5 py-1 text-xs bg-white max-w-[160px]" value={t.assigned_to ?? ''} aria-label={`Technician for ${t.ticket_number}`}
                            onChange={e => assignTicket(t, e.target.value)}>
                            <option value="">— not assigned —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                          </select>
                        ) : t.technician?.full_name ?? <span className="text-amber-700">not assigned</span>}
                      </td>
                      <td className={`px-4 py-2 tabular-nums ${late ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{t.scheduled_for && t.kind === 'amc_visit' ? `visit ${t.scheduled_for}` : t.due_date}{late && <span className="block text-xs">{daysBetween(t.due_date)} d late</span>}</td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${SERVICE_STATUS_COLORS[t.status] ?? ''}`}>{SERVICE_STATUS[t.status] ?? t.status}</span></td>
                    </tr>)
                })}
              </tbody>
            </table></div>
          </div>
        )}

        {tab === 'amc' && mgr && (
          <div className={CARD}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2"><FileText size={16} className="text-green-600" /><h2 className="font-semibold text-sm">Maintenance contracts</h2>
              <span className="ml-auto text-xs text-slate-500">Active: {activeAmc.length} · {inr(amcIncome)} a year before GST</span></div>
            <ul className="divide-y divide-slate-50">
              {contracts.length === 0 ? <li className="px-5 py-8 text-center text-slate-400 text-sm">No contracts yet. Every commissioned customer without an AMC is listed in the Control room.</li> : contracts.map(c => {
                const visits = visitsOf(c)
                const ending = c.status === 'active' && !c.renewed_to && daysBetween(today, c.end_date) <= 30
                return (
                  <li key={c.id} className="px-5 py-3 text-sm space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{c.contract_number}</span><b>{c.customer_name}</b>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                      {ending && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">ends in {daysBetween(today, c.end_date)} days</span>}
                      <span className="ml-auto text-slate-600">{inr(c.fee)} + GST {c.gst_pct}%</span>
                    </div>
                    <p className="text-xs text-slate-500">{c.plan} · {c.visits_per_year} visits{c.includes_cleaning ? ' incl. cleaning' : ''} · {c.start_date} → {c.end_date}
                      {c.invoice_number && ` · invoice ${c.invoice_number}`}{c.paid_at && ` · paid ${c.paid_at}`}</p>
                    <p className="text-xs text-slate-500">Visits: {visits.map(v => <Link key={v.id} href={`/staff/service/${v.id}`} className="hover:underline mr-2">{v.scheduled_for} ({SERVICE_STATUS[v.status]})</Link>)}</p>
                    <div className="flex flex-wrap gap-3 text-xs font-semibold">
                      {!c.invoice_number && Number(c.fee) > 0 && <button className="text-green-700 hover:underline" onClick={() => rpc('issue_service_invoice', { p_kind: 'amc', p_id: c.id }, 'Invoice number issued')}>Issue invoice</button>}
                      {c.invoice_number && <Link className="text-green-700 hover:underline flex items-center gap-1" href={`/staff/service/invoice?type=amc&id=${c.id}`}><Printer size={12} /> Invoice</Link>}
                      {c.invoice_number && !c.paid_at && <button className="text-green-700 hover:underline" onClick={() => payAmc(c)}>Record payment</button>}
                      {c.status === 'active' && !c.renewed_to && <button className="text-slate-700 hover:underline flex items-center gap-1" onClick={() => {
                        const fee = window.prompt('Renew for another year. Yearly fee before GST:', String(c.fee)); if (fee !== null) rpc('renew_amc_contract', { p_contract: c.id, p_fee: Number(fee) || c.fee }, 'Renewed: new contract created and its visits booked') }}>
                        <RefreshCw size={12} /> Renew</button>}
                      {c.renewed_to && <span className="text-slate-400">renewed</span>}
                    </div>
                  </li>)
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>}><ServicePage /></Suspense>
}
