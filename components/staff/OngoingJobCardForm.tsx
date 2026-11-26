'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { STAGES, inr, type Role } from '@/lib/workflow'

// Gives an ongoing project its numbered job card (GSS/JC/<FY>/<n>), starting from where the work is now.
// project: an existing project without a job card, or undefined to enter a new ongoing project.

interface ExistingProject {
  id: string; customer_name: string | null; customer_mobile: string | null; site_address: string | null; capacity_kwp: number | null
  project_type: string | null; region: string | null; subsidy_job: boolean; order_value: number | null; start_date: string | null
  target_commissioning: string | null
}

const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white'
function Field({ label, children, wide, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}
    {hint && <span className="text-[11px] text-slate-400">{hint}</span>}</label>
}

export default function OngoingJobCardForm({ project, role, onDone }: { project?: ExistingProject; role: Role; onDone?: () => void }) {
  const supabase = createClient()
  const router = useRouter()
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [f, setF] = useState({
    customer_name: project?.customer_name ?? '', customer_mobile: project?.customer_mobile ?? '', site_address: project?.site_address ?? '',
    capacity_kwp: project?.capacity_kwp != null ? String(project.capacity_kwp) : '', project_type: project?.project_type ?? 'residential',
    region: project?.region ?? 'puducherry', subsidy_job: project?.subsidy_job ?? false,
    order_value: project?.order_value != null ? String(project.order_value) : '', received: '',
    start_date: project?.start_date ?? '', target_commissioning: project?.target_commissioning ?? '',
    current_stage: 'order_confirmed', admin_officer_id: '', legacy_ref: '', notes: '',
  })
  const set = (k: keyof typeof f, v: string | boolean) => setF(x => ({ ...x, [k]: v }))
  const ceo = role === 'admin'

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').eq('status', 'active').order('full_name').then(({ data }) => setStaff(data ?? []))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stages = STAGES.filter(s => f.subsidy_job || !s.subsidy)
  const curIdx = stages.findIndex(s => s.code === f.current_stage)
  const balance = (Number(f.order_value) || 0) - (Number(f.received) || 0)
  const summary = useMemo(() => curIdx <= 0 ? 'Starts at the first milestone.'
    : `${curIdx} milestone${curIdx > 1 ? 's' : ''} marked done (up to “${stages[curIdx - 1].name}”); “${stages[curIdx].name}” in progress.`, [curIdx, stages])

  const save = async () => {
    setErr('')
    if (!project && !f.customer_name.trim()) { setErr('Enter the customer name.'); return }
    if (Number(f.received) > Number(f.order_value) && Number(f.order_value) > 0) { setErr('Amount received is more than the order value.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('create_job_card_for_ongoing', { p_project: project?.id ?? null, p_details: f })
      if (error) throw new Error(/create_job_card_for_ongoing|schema cache/i.test(error.message)
        ? 'The database update for ongoing job cards has not been run yet (supabase/job_card_ongoing_v1.sql).' : error.message)
      const r = data as { project_id: string; job_number: string }
      if (onDone) onDone()
      else router.push(`/staff/projects/${r.project_id}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not create the job card.') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!project && <Field label="Customer name *"><input className={INPUT} value={f.customer_name} onChange={e => set('customer_name', e.target.value)} /></Field>}
        <Field label="Customer mobile"><input className={INPUT} inputMode="tel" value={f.customer_mobile} onChange={e => set('customer_mobile', e.target.value)} /></Field>
        <Field label="Site address" wide={!!project}><input className={INPUT} value={f.site_address} onChange={e => set('site_address', e.target.value)} /></Field>
        <Field label="System size (kW)"><input className={INPUT} type="number" min="0" step="0.01" value={f.capacity_kwp} onChange={e => set('capacity_kwp', e.target.value)} /></Field>
        <Field label="Type"><select className={INPUT} value={f.project_type} onChange={e => set('project_type', e.target.value)}>
          {[['residential', 'Residential'], ['commercial', 'Commercial'], ['industrial', 'Industrial'], ['hybrid', 'Hybrid'], ['solar_pump', 'Solar pump'], ['street_light', 'Street light']]
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Electricity connection in"><select className={INPUT} value={f.region} onChange={e => set('region', e.target.value)}>
          <option value="puducherry">Puducherry</option><option value="tamilnadu">Tamil Nadu</option></select></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:pt-6">
          <input type="checkbox" checked={f.subsidy_job} onChange={e => set('subsidy_job', e.target.checked)} /> PM Surya Ghar subsidy job</label>
        <Field label="Order date"><input className={INPUT} type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
        <Field label="Target commissioning"><input className={INPUT} type="date" value={f.target_commissioning} onChange={e => set('target_commissioning', e.target.value)} /></Field>
        <Field label="Order value (₹, incl. GST)"><input className={INPUT} type="number" min="0" value={f.order_value} onChange={e => set('order_value', e.target.value)} /></Field>
        <Field label="Already received (₹)" hint={Number(f.order_value) > 0 ? `Balance due: ${inr(Math.max(balance, 0))}` : undefined}>
          <input className={INPUT} type="number" min="0" value={f.received} onChange={e => set('received', e.target.value)} /></Field>
        <Field label="Where is the work now? *" wide hint={summary}>
          <select className={INPUT} value={f.current_stage} onChange={e => set('current_stage', e.target.value)}>
            {stages.map((s, i) => <option key={s.code} value={s.code}>{i + 1}. {s.name} — {s.phase}</option>)}</select></Field>
        {ceo && <Field label="Administrative officer"><select className={INPUT} value={f.admin_officer_id} onChange={e => set('admin_officer_id', e.target.value)}>
          <option value="">— appoint later —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>}
        <Field label="Old / paper job card no. (if any)"><input className={INPUT} value={f.legacy_ref} maxLength={60} onChange={e => set('legacy_ref', e.target.value)} placeholder="Kept for reference" /></Field>
        {!project && <Field label="Notes" wide><textarea className={INPUT} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>}
      </div>
      {err && <p className="text-sm bg-red-50 text-red-700 border border-red-100 rounded-lg p-3">{err}</p>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500">A new number is issued in the same series as other job cards (GSS/JC/…). Milestone dates and payments can be corrected afterwards.</p>
        <button onClick={save} disabled={busy} className="px-5 py-2.5 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-800 disabled:opacity-50 flex items-center gap-2">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />} Create job card</button>
      </div>
    </div>
  )
}
