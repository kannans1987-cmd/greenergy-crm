'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Printer, MessageSquare, Phone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { inr, todayIso, isManager, whatsappLink } from '@/lib/workflow'
import { SERVICE_KINDS, SERVICE_STATUS, SERVICE_STATUS_COLORS } from '@/lib/growth'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white disabled:bg-slate-50'

export default function ServiceJob({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [t, setT] = useState<Row | null>(null)
  const [sessions, setSessions] = useState<Row[]>([])
  const [staff, setStaff] = useState<Row[]>([])
  const [notes, setNotes] = useState('')
  const [edit, setEdit] = useState<Row>({})
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const say = (x: string, ok = true) => { setMsg({ t: x, ok }); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: prof }, { data: tk }, { data: at }, { data: ppl }] = await Promise.all([
      supabase.from('profiles').select('id, role').eq('id', user.id).single(),
      supabase.from('service_tickets').select('*, technician:assigned_to(full_name, phone), contract:contract_id(contract_number, plan)').eq('id', params.id).maybeSingle(),
      supabase.from('attendance').select('id, date, clock_in_time, clock_out_time, total_hours, clock_in_lat, clock_in_lng, profiles!attendance_employee_id_fkey(full_name)').eq('service_ticket_id', params.id).order('clock_in_time'),
      supabase.from('profiles').select('id, full_name').eq('status', 'active').neq('role', 'admin').order('full_name'),
    ])
    setMe(prof); setT(tk); setSessions(at ?? []); setStaff(ppl ?? [])
    if (tk) { setNotes(tk.resolution_notes ?? ''); setEdit({ assigned_to: tk.assigned_to ?? '', due_date: tk.due_date ?? '', scheduled_for: tk.scheduled_for ?? '',
      priority: tk.priority, chargeable: tk.chargeable, charge_amount: tk.charge_amount ?? 0 }) }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!t || !me) return <div className="p-10 text-center text-slate-500">Service job not found, or it is not given to you. <Link href="/staff/service" className="text-green-700 underline">Back</Link></div>

  const mgr = isManager(me.role)
  const mine = t.assigned_to === me.id
  const open = ['open', 'assigned', 'in_progress'].includes(t.status)
  const hours = sessions.reduce((s, a) => s + Number(a.total_hours ?? 0), 0)
  const update = async (u: Row, ok: string) => {
    const { error } = await supabase.from('service_tickets').update(u).eq('id', t.id)
    if (error) return say(error.message, false)
    say(ok); load()
  }
  const rpc = async (fn: string, args: Row, ok: string) => {
    const { error } = await supabase.rpc(fn, args)
    if (error) return say(error.message, false)
    say(ok); load()
  }
  const gross = Number(t.charge_amount) * (1 + Number(t.gst_pct) / 100)
  const onWay = `Hello ${t.customer_name}, this is ${t.technician?.full_name ?? 'the Greenergy service team'} from Greenergy Solar Solutions about your service request ${t.ticket_number}. ${t.scheduled_for ? 'We will visit on ' + new Date(t.scheduled_for + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '.' : 'We are on our way.'}`
  const doneMsg = `Hello ${t.customer_name}, your service request ${t.ticket_number} is complete: ${t.resolution_notes ?? ''}${t.chargeable ? ` Charges: ${inr(gross)} incl. GST.` : ''} Thank you for choosing Greenergy Solar Solutions.`

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/staff/service" className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Back to service"><ArrowLeft size={18} /></Link>
          <div><p className="text-xs text-slate-400 font-mono">{t.ticket_number}</p><h1 className="font-bold text-slate-900">{t.customer_name} · {SERVICE_KINDS[t.kind] ?? t.kind}</h1></div>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${SERVICE_STATUS_COLORS[t.status] ?? ''}`}>{SERVICE_STATUS[t.status]}</span>
          {t.invoice_number && <Link href={`/staff/service/invoice?type=ticket&id=${t.id}`} className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 flex items-center gap-1"><Printer size={13} /> Invoice {t.invoice_number}</Link>}
        </div>
      </div>
      {msg && <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.t}</div>}

      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-5">
        <div className={`${CARD} p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm`}>
          <div><p className="text-xs text-slate-400">Customer</p><p className="font-semibold">{t.customer_name}</p>
            {t.customer_mobile && <p className="flex gap-3 mt-1"><a href={`tel:${t.customer_mobile}`} className="text-green-700 flex items-center gap-1"><Phone size={13} />{t.customer_mobile}</a>
              <a target="_blank" rel="noopener noreferrer" className="text-green-700 flex items-center gap-1" href={whatsappLink(t.customer_mobile, open ? onWay : doneMsg)}><MessageSquare size={13} /> WhatsApp</a></p>}
            <p className="text-xs text-slate-500 mt-1">{t.site_address}</p></div>
          <div><p className="text-xs text-slate-400">Job</p><p className="whitespace-pre-line">{t.description}</p>
            {t.contract && <p className="text-xs text-slate-500 mt-1">Under AMC {t.contract.contract_number} ({t.contract.plan}): no charge for the visit</p>}
            {t.project_id && <Link href={`/staff/projects/${t.project_id}`} className="text-xs text-green-700 hover:underline">Installation job card</Link>}</div>
          <div><p className="text-xs text-slate-400">Technician · due</p><p className="font-semibold">{t.technician?.full_name ?? 'Not assigned'} · {t.due_date}</p>
            {t.scheduled_for && <p className="text-xs text-slate-500">Visit planned {t.scheduled_for}</p>}</div>
          <div><p className="text-xs text-slate-400">Time on site (from clock-ins on this job)</p><p className="font-semibold">{hours.toFixed(1)} h in {sessions.length} visit{sessions.length === 1 ? '' : 's'}</p>
            <p className="text-xs text-slate-500">{mine && open ? 'Clock in on Attendance and choose this job when you reach the site.' : ''}</p></div>
        </div>

        {(mine || mgr) && open && (
          <div className={`${CARD} p-5 space-y-3`}>
            <h2 className="font-semibold text-sm">Work done</h2>
            <textarea className={INPUT} rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="What you found and what you did, e.g. DC SPD failed, replaced; IR test 45 MΩ; inverter back online, 3.1 kW at 12:30" />
            <div className="flex flex-wrap gap-2">
              {t.status !== 'in_progress' && <button className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold" onClick={() => update({ status: 'in_progress', resolution_notes: notes || null }, 'Marked in progress')}>Started</button>}
              <button className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-semibold" onClick={() => {
                if (!notes.trim()) return say('Write what was done first.', false)
                update({ status: 'resolved', resolution_notes: notes.trim() }, 'Resolved. The admin manager has been told.') }}>Resolved</button>
              {notes !== (t.resolution_notes ?? '') && <button className="px-4 py-2 text-sm bg-slate-100 rounded-lg" onClick={() => update({ resolution_notes: notes }, 'Notes saved')}>Save notes</button>}
            </div>
          </div>
        )}
        {!open && t.resolution_notes && <div className={`${CARD} p-5 text-sm`}><p className="text-xs text-slate-400">Resolution</p><p className="whitespace-pre-line">{t.resolution_notes}</p></div>}

        {mgr && (
          <div className={`${CARD} p-5 space-y-3`}>
            <h2 className="font-semibold text-sm">Manage (CEO / admin manager)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block"><span className="text-xs text-slate-600">Technician</span><select className={INPUT} value={edit.assigned_to} onChange={e => setEdit({ ...edit, assigned_to: e.target.value })}>
                <option value="">— not assigned —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
              <label className="block"><span className="text-xs text-slate-600">Visit date</span><input type="date" className={INPUT} value={edit.scheduled_for} onChange={e => setEdit({ ...edit, scheduled_for: e.target.value })} /></label>
              <label className="block"><span className="text-xs text-slate-600">Due date</span><input type="date" className={INPUT} value={edit.due_date} onChange={e => setEdit({ ...edit, due_date: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!!t.invoice_number} checked={!!edit.chargeable} onChange={e => setEdit({ ...edit, chargeable: e.target.checked })} /> Chargeable</label>
              {edit.chargeable && <label className="block"><span className="text-xs text-slate-600">Charge (₹ before GST {t.gst_pct}%)</span><input type="number" min="0" disabled={!!t.invoice_number} className={INPUT} value={edit.charge_amount} onChange={e => setEdit({ ...edit, charge_amount: e.target.value })} /></label>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="px-4 py-2 text-sm bg-slate-800 text-white rounded-lg font-semibold" onClick={() => update({ assigned_to: edit.assigned_to || null, scheduled_for: edit.scheduled_for || null, due_date: edit.due_date || t.due_date,
                ...(t.invoice_number ? {} : { chargeable: !!edit.chargeable, charge_amount: Number(edit.charge_amount) || 0 }) }, 'Saved' + (edit.assigned_to && edit.assigned_to !== t.assigned_to ? ': technician told' : ''))}>Save</button>
              {t.status === 'resolved' && t.chargeable && !t.invoice_number && <button className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-semibold" onClick={() => rpc('issue_service_invoice', { p_kind: 'ticket', p_id: t.id }, 'Invoice number issued')}>Issue invoice ({inr(gross)})</button>}
              {t.invoice_number && !t.paid_at && <button className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-semibold" onClick={() => {
                const ref = window.prompt(`Payment of ${inr(gross)} received. Mode and reference (e.g. "UPI 4123…", "Cash"):`); if (ref === null) return
                const mode = /upi/i.test(ref) ? 'upi' : /neft|imps|rtgs/i.test(ref) ? 'neft' : /cheque|chq/i.test(ref) ? 'cheque' : /cash/i.test(ref) ? 'cash' : 'other'
                rpc('record_service_payment', { p_kind: 'ticket', p_id: t.id, p_mode: mode, p_ref: ref, p_date: todayIso() }, 'Payment recorded; job closed') }}>Record payment</button>}
              {t.status === 'resolved' && !t.chargeable && <button className="px-4 py-2 text-sm bg-slate-100 rounded-lg" onClick={() => update({ status: 'closed' }, 'Closed')}>Close job</button>}
              {open && <button className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg" onClick={() => { if (window.confirm('Cancel this service job?')) update({ status: 'cancelled' }, 'Cancelled') }}>Cancel job</button>}
            </div>
            {t.paid_at && <p className="text-xs text-green-700">Paid {t.paid_at} · {t.payment_mode} {t.payment_ref}</p>}
          </div>
        )}

        <div className={CARD}>
          <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm">Visits (clock-ins on this job)</h2></div>
          <ul className="divide-y divide-slate-50 text-sm">
            {sessions.length === 0 ? <li className="px-5 py-4 text-slate-400">No clock-ins on this job yet.</li> : sessions.map(a => (
              <li key={a.id} className="px-5 py-2 flex justify-between"><span>{a.profiles?.full_name} · {new Date(a.clock_in_time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                {a.clock_out_time ? ' → ' + new Date(a.clock_out_time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ' (still there)'}</span>
                <b>{a.total_hours != null ? `${Number(a.total_hours).toFixed(1)} h` : '…'}</b></li>))}
          </ul>
        </div>
      </div>
    </div>
  )
}
