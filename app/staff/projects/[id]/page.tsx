'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Printer, CheckCircle, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import OngoingJobCardForm from '@/components/staff/OngoingJobCardForm'
import DeleteProjectButton from '@/components/staff/DeleteProjectButton'
import { STAGE_STATUS_LABELS, milestoneProgress, inr, todayIso, isManager, REGION_LABELS, type Role } from '@/lib/workflow'

interface Stage { id: string; stage_code: string; stage_name: string; phase: string | null; sort_order: number; status: string
  planned_date: string | null; actual_date: string | null; notes: string | null; is_subsidy: boolean; updated_by_name: string | null; updated_at: string }
interface Payment { id: string; milestone_name: string; percentage: number | null; amount: number; status: string; paid_date: string | null; payment_mode: string | null; reference_number: string | null }
interface Project { id: string; project_number: string; job_number: string | null; name: string; customer_name: string | null; customer_mobile: string | null
  site_address: string | null; capacity_kwp: number | null; project_type: string | null; region: string | null; subsidy_job: boolean; order_value: number | null
  status: string; start_date: string | null; target_commissioning: string | null; notes: string | null; quotation_id: string | null; admin_officer_id: string | null
  legacy_ref?: string | null; onboarded_at?: string | null }
interface Person { id: string; full_name: string; role: Role }

const INPUT = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm w-full bg-white disabled:bg-slate-50 disabled:text-slate-500'
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const PROJECT_STATUS: Record<string, string> = { planning: 'Planning', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' }

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const [me, setMe] = useState<{ id: string; role: Role } | null>(null)
  const [p, setP] = useState<Project | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [team, setTeam] = useState<{ job_card_number: string; id: string; profiles: { full_name: string } | null; current_stage: number | null }[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: prof }, { data: proj }, { data: st }, { data: pay }, { data: jc }, { data: ppl }] = await Promise.all([
      supabase.from('profiles').select('id, role').eq('id', user.id).single(),
      supabase.from('projects').select('*').eq('id', params.id).maybeSingle(),
      supabase.from('project_stage_history').select('*').eq('project_id', params.id).order('sort_order'),
      supabase.from('project_payments').select('*').eq('project_id', params.id).order('created_at'),
      supabase.from('job_cards').select('id, job_card_number, current_stage, profiles:employee_id ( full_name )').eq('project_id', params.id),
      supabase.from('profiles').select('id, full_name, role').eq('status', 'active').order('full_name'),
    ])
    setMe(prof as { id: string; role: Role }); setP(proj as Project | null); setStages((st ?? []) as Stage[])
    setPayments((pay ?? []) as Payment[]); setTeam((jc ?? []) as unknown as typeof team); setStaff((ppl ?? []) as Person[])
    setChanged(new Set()); setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!p || !me) return <div className="p-10 text-center text-slate-500">Project not found, or you do not have access to it. <Link href="/staff/projects" className="text-green-700 underline">Back</Link></div>

  const ceo = me.role === 'admin'
  const canTrack = isManager(me.role) || p.admin_officer_id === me.id
  const prog = milestoneProgress(stages)
  const today = todayIso()
  const say = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 4500) }
  const editStage = (id: string, k: keyof Stage, v: string) => {
    setStages(s => s.map(x => x.id === id ? { ...x, [k]: v || null } as Stage : x))
    setChanged(c => new Set(c).add(id))
  }

  async function saveAll() {
    setSaving(true)
    try {
      for (const id of Array.from(changed)) {
        const s = stages.find(x => x.id === id)!
        const { error } = await supabase.from('project_stage_history')
          .update({ status: s.status, planned_date: s.planned_date, actual_date: s.actual_date, notes: s.notes }).eq('id', id)
        if (error) throw error
      }
      if (canTrack) {
        const { error } = await supabase.from('projects')
          .update({ status: p!.status, start_date: p!.start_date, target_commissioning: p!.target_commissioning, notes: p!.notes }).eq('id', p!.id)
        if (error) throw error
      }
      say('Saved'); await load()
    } catch (e) { say((e as { message?: string }).message ?? 'Could not save.', false) }
    finally { setSaving(false) }
  }

  async function appoint(officer: string) {
    const { error } = await supabase.from('projects').update({ admin_officer_id: officer || null }).eq('id', p!.id)
    if (error) return say(error.message, false)
    if (officer) await supabase.from('notifications').insert({ user_id: officer, type: 'project', title: 'You are the administrative officer for a job card',
      message: `${p!.job_number ?? p!.project_number} · ${p!.customer_name ?? ''}`, link: `/staff/projects/${p!.id}` })
    say(officer ? 'Officer appointed' : 'Officer removed'); load()
  }

  async function markPaid(pay: Payment) {
    const ref = window.prompt(`Payment reference for “${pay.milestone_name}” (UPI / NEFT / cheque no.):`)
    if (ref === null) return
    const { error } = await supabase.from('project_payments').update({ status: 'paid', paid_date: today, reference_number: ref || null }).eq('id', pay.id)
    if (error) return say(error.message, false)
    say('Payment recorded'); load()
  }

  let phase = ''
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 print:border-0">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/staff/projects" className="p-2 hover:bg-slate-100 rounded-lg print:hidden" aria-label="Back to projects"><ArrowLeft size={18} /></Link>
          <div><p className="text-xs text-slate-400 font-mono">{p.project_number}</p>
            <h1 className="font-bold text-slate-900">{p.job_number ?? 'Project'} · {p.customer_name}</h1>
            {p.legacy_ref && <p className="text-xs text-slate-500">Old job card: {p.legacy_ref}</p>}</div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100">{PROJECT_STATUS[p.status] ?? p.status}</span>
          {ceo && !p.job_number && !p.quotation_id && <span className="ml-auto"><DeleteProjectButton id={p.id} label={`${p.project_number} · ${p.customer_name ?? p.name}`} /></span>}
          <button onClick={() => window.print()} className={`${ceo && !p.job_number && !p.quotation_id ? "" : "ml-auto "}flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 print:hidden`}><Printer size={13} /> Print job card</button>
        </div>
      </div>

      {msg && <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white flex gap-2 ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}{msg.t}</div>}

      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">
        {!p.job_number && isManager(me.role) && (
          <div className={`${CARD} p-5 border-amber-200 print:hidden`}>
            <h2 className="font-semibold text-sm text-amber-900">This project has no numbered job card yet</h2>
            <p className="text-xs text-slate-500 mb-4">It was started before the CRM or without a quotation. Fill in what you know and the CRM issues the job card, marks the milestones already finished and records the payment received so far.</p>
            <OngoingJobCardForm project={p} role={me.role} onDone={() => { say('Job card created'); load() }} />
          </div>
        )}
        <div className={`${CARD} p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm`}>
          <div><p className="text-xs text-slate-400">System</p><p className="font-semibold">{p.capacity_kwp ?? '—'} kW {p.project_type ?? ''}</p></div>
          <div><p className="text-xs text-slate-400">Order value (incl. GST)</p><p className="font-semibold">{inr(p.order_value)}</p></div>
          <div><p className="text-xs text-slate-400">Customer</p><p className="font-semibold">{p.customer_mobile ?? '—'}</p><p className="text-xs text-slate-500">{p.site_address}</p></div>
          <div><p className="text-xs text-slate-400">Region · subsidy</p><p className="font-semibold">{REGION_LABELS[p.region as 'puducherry'] ?? '—'} · {p.subsidy_job ? 'Subsidy job' : 'No subsidy'}</p>
            {p.quotation_id && <Link href={`/staff/quotations/${p.quotation_id}`} className="text-xs text-green-700 hover:underline print:hidden">View quotation</Link>}</div>
          <div className="col-span-2 md:col-span-4">
            <div className="flex items-center gap-3"><div className="flex-1 max-w-md h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-green-600" style={{ width: `${prog.pct}%` }} /></div>
              <b>{prog.pct}%</b><span className="text-xs text-slate-500">{prog.done} of {prog.total} milestones{prog.overdue ? <span className="text-red-600"> · {prog.overdue} overdue</span> : null}</span></div>
          </div>
        </div>

        <div className={`${CARD} p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`}>
          <label className="block"><span className="text-xs font-medium text-slate-600">Administrative officer (appointed by CEO)</span>
            <select className={INPUT} disabled={!ceo} value={p.admin_officer_id ?? ''} onChange={e => appoint(e.target.value)}>
              <option value="">— not appointed —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Project status</span>
            <select className={INPUT} disabled={!canTrack} value={p.status} onChange={e => { setP({ ...p, status: e.target.value }); setChanged(c => new Set(c).add('project')) }}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Order date</span>
            <input type="date" className={INPUT} disabled={!canTrack} value={p.start_date ?? ''} onChange={e => { setP({ ...p, start_date: e.target.value || null }); setChanged(c => new Set(c).add('project')) }} /></label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Target commissioning</span>
            <input type="date" className={INPUT} disabled={!canTrack} value={p.target_commissioning ?? ''} onChange={e => { setP({ ...p, target_commissioning: e.target.value || null }); setChanged(c => new Set(c).add('project')) }} /></label>
          {!p.admin_officer_id && <p className="sm:col-span-2 lg:col-span-4 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">No administrative officer yet — {ceo ? 'appoint one above.' : 'the CEO appoints one.'}</p>}
        </div>

        <div className={CARD}>
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Cradle-to-grave milestones</h2>
            <p className="text-xs text-slate-500">From order to end of life. Planned dates are suggested from the order date — change them to the real schedule.{!canTrack ? ' Only the appointed officer and managers can update.' : ''}</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Milestone', 'Status', 'Planned', 'Actual', 'Note'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {stages.map(s => {
                  const late = !['completed', 'skipped'].includes(s.status) && !!s.planned_date && s.planned_date < today
                  const head = s.phase && s.phase !== phase ? <tr key={s.id + 'h'} className="bg-green-50"><td colSpan={5} className="px-3 py-1.5 text-xs font-bold text-green-800">{(phase = s.phase)}</td></tr> : null
                  return [head, (
                    <tr key={s.id} className={`border-t border-slate-50 ${s.status === 'skipped' ? 'text-slate-400' : ''} ${late ? 'bg-red-50/40' : ''}`}>
                      <td className="px-3 py-2">{s.stage_name}{late && <span className="ml-2 text-[10px] font-bold text-red-600">OVERDUE</span>}
                        {s.updated_by_name && <p className="text-[10px] text-slate-400">{s.updated_by_name}</p>}</td>
                      <td className="px-3 py-2 w-36"><select className={INPUT} disabled={!canTrack} value={s.status} onChange={e => editStage(s.id, 'status', e.target.value)} aria-label="Status">
                        {Object.entries(STAGE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td className="px-3 py-2 w-36"><input type="date" className={INPUT} disabled={!canTrack} value={s.planned_date ?? ''} onChange={e => editStage(s.id, 'planned_date', e.target.value)} aria-label="Planned date" /></td>
                      <td className="px-3 py-2 w-36"><input type="date" className={INPUT} disabled={!canTrack} value={s.actual_date ?? ''} onChange={e => editStage(s.id, 'actual_date', e.target.value)} aria-label="Actual date" /></td>
                      <td className="px-3 py-2"><input className={INPUT} disabled={!canTrack} value={s.notes ?? ''} maxLength={300} onChange={e => editStage(s.id, 'notes', e.target.value)} aria-label="Note" /></td>
                    </tr>)]
                })}
              </tbody>
            </table>
          </div>
          {canTrack && <div className="px-5 py-4 border-t border-slate-100 flex justify-end print:hidden">
            <button onClick={saveAll} disabled={saving || changed.size === 0} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin inline mr-1" />}Save {changed.size ? `(${changed.size})` : ''}</button></div>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={CARD}>
            <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Payment schedule</h2></div>
            <ul className="divide-y divide-slate-50 text-sm">
              {payments.map(x => (
                <li key={x.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1"><p className="font-medium">{x.milestone_name}</p>
                    <p className="text-xs text-slate-500">{x.status === 'paid' ? `Paid ${x.paid_date ?? ''}${x.reference_number ? ' · ' + x.reference_number : ''}` : 'Pending'}</p></div>
                  <b>{inr(x.amount)}</b>
                  {isManager(me.role) && x.status !== 'paid' && <button onClick={() => markPaid(x)} className="text-xs font-semibold text-green-700 hover:underline print:hidden">Mark paid</button>}
                </li>
              ))}
            </ul>
          </div>
          <div className={CARD}>
            <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-sm">Field job cards (team)</h2>
              <p className="text-xs text-slate-500">Created when a team member is assigned to the project. Materials, manpower, expenses and tests are recorded there.</p></div>
            <ul className="divide-y divide-slate-50 text-sm">
              {team.length === 0 ? <li className="px-5 py-4 text-slate-400">No team assigned yet (All Projects → assign employees).</li> : team.map(t => (
                <li key={t.id} className="px-5 py-3 flex justify-between"><Link href={`/staff/job-cards/${t.id}`} className="text-green-700 hover:underline font-mono text-xs">{t.job_card_number}</Link>
                  <span>{t.profiles?.full_name ?? '—'}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
