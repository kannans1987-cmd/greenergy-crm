'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { Calendar, Plus, Clock, CheckCircle, XCircle, AlertTriangle, FileText, Upload, ShieldAlert, Info } from 'lucide-react'

// Leave policy and two-level approval: Sr Admin Manager → CEO (supabase/leave_policy_v1.sql).
// The database works out paid / loss-of-pay days and enforces who decides what; this page explains it.
interface Leave {
  id: string; employee_id: string; type: string; from_date: string; to_date: string; reason: string; status: string
  created_at: string; approved_at: string | null
  days?: number | null; notice_days?: number | null; paid_days?: number | null; lop_days?: number | null; abrupt?: boolean | null
  genuine?: boolean | null; certificate_path?: string | null; sr_note?: string | null; sr_at?: string | null; ceo_note?: string | null
  termination_review?: boolean | null; explanation_accepted?: boolean | null; show_cause_at?: string | null
  employee: { full_name: string } | null; sr: { full_name: string } | null
}
interface Me { id: string; role: string; full_name: string; allocation_level?: string | null }
interface Rules { notice_days: number; casual_paid_days: number; casual_paid_days_genuine: number; termination_days: number; sick_backdate_days: number; week_off: number[] }
const DEFAULT_RULES: Rules = { notice_days: 5, casual_paid_days: 1, casual_paid_days_genuine: 2, termination_days: 10, sick_backdate_days: 7, week_off: [0] }

const TYPE_LABEL: Record<string, string> = { casual: 'Casual leave', sick: 'Sick leave', earned: 'Earned leave', absence: 'Absent without intimation' }
const STATUS: Record<string, [string, string]> = {
  pending:     ['With the Sr Admin Manager', 'bg-amber-100 text-amber-800'],
  sr_approved: ['With the CEO', 'bg-blue-100 text-blue-800'],
  approved:    ['Approved', 'bg-green-100 text-green-700'],
  rejected:    ['Rejected', 'bg-red-100 text-red-700'],
  cancelled:   ['Withdrawn', 'bg-slate-100 text-slate-500'],
}
const INPUT = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500'
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const SELECT = '*,employee:employee_id(full_name),sr:sr_by(full_name)'
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const dmy = (s: string) => format(new Date(s + 'T00:00:00'), 'dd MMM')

function workingDays(from: string, to: string, off: number[]) {
  let n = 0
  for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1)) if (!off.includes(d.getDay())) n++
  return n
}

export default function LeavePage() {
  const supabase = createClient()
  const [me, setMe] = useState<Me | null>(null)
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES)
  const [leaves, setLeaves] = useState<Leave[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'mine' | 'decide' | 'all' | 'absences' | 'month'>('mine')
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const say = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 6000) }

  const ceo = me?.role === 'admin'
  const first = me?.role === 'task_manager' || (me?.role === 'employee' && me?.allocation_level === 'senior')
  const reviewer = ceo || first

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: prof }, { data: st }, { data: ls }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('business_settings').select('data').eq('key', 'leave').maybeSingle(),
      supabase.from('leaves').select(SELECT).order('from_date', { ascending: false }).limit(500),
    ])
    setMe(prof as Me)
    if (st?.data) setRules({ ...DEFAULT_RULES, ...st.data })
    setLeaves((ls as unknown as Leave[]) ?? [])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (reviewer) setTab('decide') }, [reviewer])

  const mine = leaves.filter(l => l.employee_id === me?.id)
  const toDecide = leaves.filter(l => l.employee_id !== me?.id && (ceo ? ['pending', 'sr_approved'].includes(l.status) : first && l.status === 'pending'))
  const reviews = leaves.filter(l => l.termination_review)

  // ── Apply ──
  const [form, setForm] = useState({ type: 'casual', from: '', to: '', reason: '' })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const today = iso(new Date())
  const preview = useMemo(() => {
    if (!form.from || !form.to || form.to < form.from) return null
    const days = workingDays(form.from, form.to, rules.week_off)
    const notice = Math.round((new Date(form.from + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
    if (form.type === 'sick') return { days, notice, abrupt: false, paid: file ? days : 0, paidIfGenuine: file ? days : 0 }
    const abrupt = notice < rules.notice_days
    return { days, notice, abrupt, paid: abrupt ? 0 : Math.min(days, rules.casual_paid_days), paidIfGenuine: abrupt ? 0 : Math.min(days, rules.casual_paid_days_genuine) }
  }, [form, rules, file, today])

  const upload = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) throw new Error('The certificate must be under 5 MB (a phone photo is fine).')
    const path = `${me!.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9.]/g, '_').slice(-60)}`
    const { error } = await supabase.storage.from('leave-documents').upload(path, f, { contentType: f.type || undefined })
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Certificate upload needs the latest database update (leave_policy_v1.sql).' : error.message)
    return path
  }

  const apply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!me) return
    setBusy(true)
    try {
      const certificate_path = form.type === 'sick' && file ? await upload(file) : null
      const { error } = await supabase.from('leaves').insert({
        employee_id: me.id, type: form.type, from_date: form.from, to_date: form.to, reason: form.reason.trim(), status: 'pending',
        ...(certificate_path ? { certificate_path } : {}),
      })
      if (error) throw new Error(error.message)
      say('Leave applied. The Sr Admin Manager approves first, then the CEO.')
      setForm({ type: 'casual', from: '', to: '', reason: '' }); setFile(null); setShowForm(false)
      load()
    } catch (err) { say(err instanceof Error ? err.message : 'Could not apply.', false) }
    finally { setBusy(false) }
  }
  const [showForm, setShowForm] = useState(false)

  // ── Applicant actions ──
  const attach = async (l: Leave, f: File) => {
    try {
      const path = await upload(f)
      const { error } = await supabase.from('leaves').update({ certificate_path: path }).eq('id', l.id)
      if (error) throw new Error(error.message)
      say('Certificate attached — the sick days are now paid.'); load()
    } catch (err) { say(err instanceof Error ? err.message : 'Could not attach.', false) }
  }
  const withdraw = async (l: Leave) => {
    if (!window.confirm('Withdraw this leave application?')) return
    const { error } = await supabase.from('leaves').update({ status: 'cancelled' }).eq('id', l.id)
    if (error) say(error.message, false); else { say('Withdrawn'); load() }
  }
  const openCert = async (l: Leave) => {
    const { data, error } = await supabase.storage.from('leave-documents').createSignedUrl(l.certificate_path!, 120)
    if (error || !data) say(error?.message ?? 'Could not open the certificate.', false); else window.open(data.signedUrl, '_blank', 'noopener')
  }

  // ── Reviewer actions ──
  const decide = async (l: Leave, approve: boolean, genuine: boolean, note: string, explained: boolean) => {
    const upd: Record<string, unknown> = ceo
      ? { status: approve ? 'approved' : 'rejected', genuine, ceo_note: note || null, ...(explained ? { explanation_accepted: true } : {}) }
      : { status: approve ? 'sr_approved' : 'rejected', genuine, sr_note: note || null }
    const { error } = await supabase.from('leaves').update(upd).eq('id', l.id)
    if (error) say(error.message, false)
    else { say(approve ? (ceo ? 'Approved — they have been told' : 'Approved at the first level — sent to the CEO') : 'Rejected — they have been told'); load() }
  }
  const review = async (l: Leave, what: 'explained' | 'show_cause') => {
    const note = what === 'explained' ? window.prompt('What explanation did you accept? (e.g. hospital discharge summary seen)') : null
    if (what === 'explained' && !note?.trim()) return
    const { error } = await supabase.from('leaves').update(what === 'explained' ? { explanation_accepted: true, ceo_note: note!.trim() } : { show_cause_at: new Date().toISOString() }).eq('id', l.id)
    if (error) say(error.message, false); else { say(what === 'explained' ? 'Explanation accepted — the review is closed (the days stay unpaid)' : 'Show-cause notice recorded'); load() }
  }

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>

  const tabs: [typeof tab, string, number?][] = [
    ['mine', 'My leave'],
    ...(reviewer ? [['decide', 'To approve', toDecide.length], ['all', 'All leave'], ['absences', 'Absences'], ['month', 'Month summary']] as [typeof tab, string, number?][] : []),
  ]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Leave" subtitle={reviewer ? (ceo ? 'Final approval, absences and loss of pay' : 'First-level approval, then the CEO') : 'Apply for leave and follow it'} />
      {msg && <div role="status" className={`fixed top-16 right-4 z-50 max-w-sm px-4 py-3 rounded-xl shadow-xl text-sm text-white ${msg.ok ? 'bg-green-600' : 'bg-red-600'}`}>{msg.t}</div>}
      <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">

        {reviewer && reviews.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
            <p className="font-semibold text-red-800 text-sm flex items-center gap-2"><ShieldAlert size={16} /> Termination review</p>
            <p className="text-xs text-red-700">Absent without intimation for more than {rules.termination_days} days. Ask for a written explanation. If none is acceptable, issue a show-cause notice and follow due process before any decision.</p>
            {reviews.map(l => (
              <div key={l.id} className="bg-white rounded-lg border border-red-100 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                <span><b>{l.employee?.full_name}</b> · {dmy(l.from_date)} – {dmy(l.to_date)} · {l.reason}</span>
                {l.show_cause_at && <span className="text-xs text-red-700">show-cause issued {format(new Date(l.show_cause_at), 'dd MMM')}</span>}
                {ceo && <span className="ml-auto flex gap-2">
                  {!l.show_cause_at && <button onClick={() => review(l, 'show_cause')} className="px-2.5 py-1 text-xs rounded-lg bg-red-600 text-white font-semibold">Show-cause notice issued</button>}
                  <button onClick={() => review(l, 'explained')} className="px-2.5 py-1 text-xs rounded-lg bg-white border border-slate-200 font-semibold">Explanation accepted</button>
                </span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-100 shadow-sm overflow-x-auto">
            {tabs.map(([k, label, n]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {label}{n ? <span className="ml-1 px-1.5 rounded-full bg-red-500 text-white text-[10px]">{n}</span> : null}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowForm(!showForm); setTab('mine') }} className="ml-auto flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700"><Plus size={16} /> Apply for leave</button>
        </div>

        <Policy rules={rules} />

        {showForm && (
          <form onSubmit={apply} className={`${CARD} p-5 space-y-3`}>
            <h3 className="font-semibold text-sm flex items-center gap-2"><Calendar size={16} className="text-green-600" /> Apply for leave</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block"><span className="text-xs text-slate-500 mb-1 block">Type</span>
                <select className={INPUT} value={form.type} onChange={e => { setForm({ ...form, type: e.target.value }); setFile(null) }}>
                  <option value="casual">Casual leave</option><option value="sick">Sick leave</option></select></label>
              <label className="block"><span className="text-xs text-slate-500 mb-1 block">First day</span>
                <input type="date" required className={INPUT} value={form.from}
                  min={form.type === 'sick' ? iso(new Date(Date.now() - rules.sick_backdate_days * 86400000)) : today}
                  onChange={e => setForm({ ...form, from: e.target.value, to: form.to && form.to >= e.target.value ? form.to : e.target.value })} /></label>
              <label className="block"><span className="text-xs text-slate-500 mb-1 block">Last day</span>
                <input type="date" required className={INPUT} value={form.to} min={form.from || today} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
            </div>
            <textarea required rows={2} className={INPUT} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
              placeholder={form.type === 'sick' ? 'e.g. Viral fever, advised rest by the doctor' : 'e.g. Sister’s wedding in Chennai'} />
            {form.type === 'sick' && (
              <label className="block"><span className="text-xs text-slate-500 mb-1 block">Medical certificate (photo or PDF) — needed for paid sick leave; you can also attach it later</span>
                <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></label>
            )}
            {preview && (
              <div className={`rounded-lg px-3 py-2 text-sm ${preview.paid === preview.days ? 'bg-green-50 text-green-800' : preview.paid === 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                <b>{preview.days} working day{preview.days === 1 ? '' : 's'}</b>
                {form.type === 'casual' && <> · applied {preview.notice} day{preview.notice === 1 ? '' : 's'} before</>}
                {' → '}
                {form.type === 'sick'
                  ? (file ? <>all paid (certificate attached)</> : <>loss of pay unless you attach a medical certificate</>)
                  : preview.abrupt
                    ? <>less than {rules.notice_days} days’ notice: <b>all {preview.days} day(s) loss of pay</b></>
                    : <>{preview.paid} paid{preview.paidIfGenuine > preview.paid ? ` (up to ${preview.paidIfGenuine} if the reason is accepted as genuine)` : ''}, {preview.days - preview.paidIfGenuine > 0 ? `at least ${preview.days - preview.paidIfGenuine} loss of pay` : 'no loss of pay'}</>}
                {preview.days > rules.termination_days && <span className="block text-xs mt-1">More than {rules.termination_days} days: the CEO needs a proper explanation before approving.</span>}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={busy || !preview || preview.days === 0} className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg font-semibold disabled:opacity-50">{busy ? 'Applying…' : 'Apply'}</button>
            </div>
          </form>
        )}

        {tab === 'mine' && <List items={mine} me={me} rules={rules} empty="You have not applied for leave yet." onAttach={attach} onWithdraw={withdraw} onCert={openCert} />}
        {tab === 'decide' && <List items={toDecide} me={me} rules={rules} empty="Nothing waiting for you." decider={{ ceo: !!ceo, decide }} onCert={openCert} />}
        {tab === 'all' && <List items={leaves} me={me} rules={rules} empty="No leave yet." showName onCert={openCert} />}
        {tab === 'absences' && reviewer && <Absences supabase={supabase} onDone={load} say={say} />}
        {tab === 'month' && reviewer && <Month supabase={supabase} />}
      </div>
    </div>
  )
}

function Policy({ rules }: { rules: Rules }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`${CARD} px-4 py-3 text-sm`}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 font-semibold text-slate-700"><Info size={15} className="text-green-600" /> Leave rules</button>
      {open && (
        <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600 text-[13px]">
          <li><b>Casual leave</b> applied at least {rules.notice_days} days before: {rules.casual_paid_days} day paid; up to {rules.casual_paid_days_genuine} days paid if the reason is accepted as genuine. From day {rules.casual_paid_days_genuine + 1} onwards: loss of pay.</li>
          <li><b>Abrupt casual leave</b> (less than {rules.notice_days} days’ notice) and <b>absence without intimation</b>: loss of pay for every day.</li>
          <li><b>Sick leave</b> is paid only with a medical certificate. It can be applied up to {rules.sick_backdate_days} days after it started; attach the certificate as soon as you have it.</li>
          <li><b>More than {rules.termination_days} days</b> away without a proper explanation starts the termination process (written explanation, then a show-cause notice).</li>
          <li><b>Approval:</b> the Sr Admin Manager approves first, then the CEO gives the final approval. Weekly offs are not counted.</li>
        </ul>
      )}
    </div>
  )
}

function List({ items, me, rules, empty, showName, decider, onAttach, onWithdraw, onCert }: {
  items: Leave[]; me: Me | null; rules: Rules; empty: string; showName?: boolean
  decider?: { ceo: boolean; decide: (l: Leave, approve: boolean, genuine: boolean, note: string, explained: boolean) => void }
  onAttach?: (l: Leave, f: File) => void; onWithdraw?: (l: Leave) => void; onCert: (l: Leave) => void
}) {
  if (!items.length) return <div className={`${CARD} p-10 text-center text-sm text-slate-400`}><Calendar size={36} className="mx-auto mb-2 text-slate-200" />{empty}</div>
  return <div className="space-y-3">{items.map(l => <LeaveCard key={l.id} l={l} me={me} rules={rules} showName={showName || !!decider} decider={decider} onAttach={onAttach} onWithdraw={onWithdraw} onCert={onCert} />)}</div>
}

function LeaveCard({ l, me, rules, showName, decider, onAttach, onWithdraw, onCert }: {
  l: Leave; me: Me | null; rules: Rules; showName?: boolean
  decider?: { ceo: boolean; decide: (l: Leave, approve: boolean, genuine: boolean, note: string, explained: boolean) => void }
  onAttach?: (l: Leave, f: File) => void; onWithdraw?: (l: Leave) => void; onCert: (l: Leave) => void
}) {
  const [genuine, setGenuine] = useState(!!l.genuine)
  const [note, setNote] = useState('')
  const [explained, setExplained] = useState(!!l.explanation_accepted)
  const [s, cls] = STATUS[l.status] ?? [l.status, 'bg-slate-100']
  const days = l.days ?? workingDays(l.from_date, l.to_date, rules.week_off)
  const long = days > rules.termination_days && !(l.type === 'sick' && l.certificate_path)
  const mineOpen = l.employee_id === me?.id && ['pending', 'sr_approved'].includes(l.status)
  const waitingSr = decider?.ceo && l.status === 'pending'
  return (
    <div className={`${CARD} p-4 space-y-2`}>
      <div className="flex items-start gap-3 flex-wrap">
        {l.status === 'approved' ? <CheckCircle size={18} className="text-green-500 mt-0.5" /> : l.status === 'rejected' ? <XCircle size={18} className="text-red-400 mt-0.5" /> : l.type === 'absence' ? <AlertTriangle size={18} className="text-red-500 mt-0.5" /> : <Clock size={18} className="text-amber-500 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{showName && l.employee ? `${l.employee.full_name} · ` : ''}{TYPE_LABEL[l.type] ?? l.type}
            <span className={`ml-2 align-middle text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.type === 'absence' ? 'bg-red-100 text-red-700' : cls}`}>{l.type === 'absence' ? 'Recorded' : s}</span></p>
          <p className="text-xs text-slate-500">{dmy(l.from_date)}{l.to_date !== l.from_date ? ` – ${dmy(l.to_date)}` : ''} · {days} day{days === 1 ? '' : 's'}
            {l.notice_days != null && l.type !== 'absence' && <> · applied {l.notice_days} day{Math.abs(l.notice_days) === 1 ? '' : 's'} {l.notice_days >= 0 ? 'before' : 'after it started'}</>}</p>
        </div>
        {l.paid_days != null && <p className="text-xs text-right"><span className="text-green-700 font-semibold">{l.paid_days} paid</span>{' · '}<span className={Number(l.lop_days) > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>{l.lop_days} loss of pay</span>
          {l.abrupt && <span className="block text-[10px] text-red-600">less than {rules.notice_days} days’ notice</span>}
          {l.genuine && !l.abrupt && l.type !== 'sick' && <span className="block text-[10px] text-slate-500">reason accepted as genuine</span>}</p>}
      </div>
      <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{l.reason}</p>
      {l.type === 'sick' && (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {l.certificate_path ? <button onClick={() => onCert(l)} className="flex items-center gap-1 text-green-700 hover:underline"><FileText size={13} /> Medical certificate</button>
            : <span className="text-red-600">No medical certificate — the days are loss of pay until one is attached.</span>}
          {onAttach && l.employee_id === me?.id && ['pending', 'sr_approved', 'approved'].includes(l.status) && (
            <label className="flex items-center gap-1 text-slate-600 cursor-pointer hover:text-slate-900"><Upload size={13} /> {l.certificate_path ? 'Replace' : 'Attach'} certificate
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => e.target.files?.[0] && onAttach(l, e.target.files[0])} /></label>
          )}
        </div>
      )}
      {(l.sr_note || l.ceo_note) && (
        <div className="text-xs text-slate-600 space-y-0.5">
          {l.sr_note && <p><b>Sr Admin Manager{l.sr ? ` (${l.sr.full_name})` : ''}:</b> {l.sr_note}</p>}
          {l.ceo_note && <p><b>CEO:</b> {l.ceo_note}</p>}
        </div>
      )}
      {mineOpen && onWithdraw && <button onClick={() => onWithdraw(l)} className="text-xs text-slate-500 hover:text-red-600">Withdraw</button>}

      {decider && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          {waitingSr && <p className="text-xs text-amber-700">Waiting for the Sr Admin Manager. You can reject it now; you approve after the Sr Admin Manager (unless it is their own leave or there is none).</p>}
          {l.type === 'casual' && !l.abrupt && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={genuine} onChange={e => setGenuine(e.target.checked)} className="accent-green-600" />
            Reason is genuine — pay up to {rules.casual_paid_days_genuine} days</label>}
          {decider.ceo && long && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={explained} onChange={e => setExplained(e.target.checked)} className="accent-green-600" />
            Proper explanation received for more than {rules.termination_days} days (write it in the note)</label>}
          <input className={INPUT} value={note} onChange={e => setNote(e.target.value)} placeholder={decider.ceo ? 'Note (needed to reject or to accept an explanation)' : 'Note for the CEO (needed to reject)'} />
          <div className="flex gap-2">
            <button onClick={() => decider.decide(l, true, genuine, note.trim(), explained)} className="flex-1 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700">
              {decider.ceo ? 'Approve (final)' : 'Approve → send to CEO'}</button>
            <button onClick={() => decider.decide(l, false, genuine, note.trim(), false)} className="flex-1 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600">Reject</button>
          </div>
        </div>
      )}
    </div>
  )
}

type SB = ReturnType<typeof createClient>

// Working days with no clock-in and no leave: confirm and record as absence (loss of pay)
function Absences({ supabase, onDone, say }: { supabase: SB; onDone: () => void; say: (t: string, ok?: boolean) => void }) {
  const [rows, setRows] = useState<{ employee_id: string; full_name: string; day: string }[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('unexplained_absences', { p_days: 14 })
    if (error) setErr(/unexplained_absences|Could not find/i.test(error.message) ? 'This needs the latest database update (leave_policy_v1.sql).' : error.message)
    else setRows(data ?? [])
  }, [supabase])
  useEffect(() => { load() }, [load])

  // Group each person's consecutive days into one absence
  const groups = useMemo(() => {
    const out: { employee_id: string; full_name: string; from: string; to: string; n: number }[] = []
    for (const r of rows ?? []) {
      const g = out[out.length - 1]
      const next = g && g.employee_id === r.employee_id && (new Date(r.day).getTime() - new Date(g.to).getTime()) / 86400000 <= 2
      if (next) { g.to = r.day; g.n++ } else out.push({ employee_id: r.employee_id, full_name: r.full_name, from: r.day, to: r.day, n: 1 })
    }
    return out
  }, [rows])

  const record = async (g: (typeof groups)[number]) => {
    const reason = window.prompt(`Record ${g.full_name} as absent without intimation, ${dmy(g.from)}${g.to !== g.from ? ' – ' + dmy(g.to) : ''}? It is loss of pay and they are told.\n\nWhat happened? (e.g. did not come, phone switched off)`)
    if (!reason?.trim()) return
    const { error } = await supabase.from('leaves').insert({ employee_id: g.employee_id, type: 'absence', from_date: g.from, to_date: g.to, reason: reason.trim(), status: 'approved' })
    if (error) say(error.message, false); else { say('Absence recorded'); load(); onDone() }
  }

  if (err) return <p className="text-sm text-amber-700">{err}</p>
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>
  return (
    <div className={`${CARD} divide-y divide-slate-50`}>
      <p className="px-4 py-3 text-xs text-slate-500">Working days in the last 14 days with no clock-in and no leave. Check first (holiday, site work without clock-in, phone trouble) — record only real absences.</p>
      {groups.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">Everyone either clocked in or was on leave.</p> : groups.map(g => (
        <div key={g.employee_id + g.from} className="px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          <span><b>{g.full_name}</b> · {dmy(g.from)}{g.to !== g.from ? ` – ${dmy(g.to)}` : ''} · {g.n} day{g.n === 1 ? '' : 's'} without clock-in or leave</span>
          <button onClick={() => record(g)} className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white font-semibold">Record as absence (loss of pay)</button>
        </div>
      ))}
    </div>
  )
}

// Paid and loss-of-pay days per person for payroll
function Month({ supabase }: { supabase: SB }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [rows, setRows] = useState<{ full_name: string; casual_paid: number; sick_paid: number; lop: number; absences: number; pending: number }[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.rpc('leave_month_summary', { p_month: month + '-01' }).then(({ data, error }) => {
      if (error) setErr(/leave_month_summary|Could not find/i.test(error.message) ? 'This needs the latest database update (leave_policy_v1.sql).' : error.message)
      else { setErr(''); setRows(data ?? []) }
    })
  }, [month, supabase])
  return (
    <div className={CARD}>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100"><p className="text-sm font-semibold">Leave and loss of pay for payroll</p>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="ml-auto text-sm border border-slate-200 rounded-lg px-2 py-1" aria-label="Month" /></div>
      {err ? <p className="p-4 text-sm text-amber-700">{err}</p> : !rows ? <p className="p-4 text-sm text-slate-400">Loading…</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Name', 'Casual paid', 'Sick paid', 'Loss of pay', 'of which absent', 'Not yet decided'].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No leave this month.</td></tr> : rows.map(r => (
              <tr key={r.full_name}><td className="px-4 py-2 font-medium">{r.full_name}</td><td className="px-4 py-2 tabular-nums">{r.casual_paid}</td><td className="px-4 py-2 tabular-nums">{r.sick_paid}</td>
                <td className={`px-4 py-2 tabular-nums ${r.lop ? 'text-red-600 font-semibold' : ''}`}>{r.lop}</td><td className="px-4 py-2 tabular-nums">{r.absences}</td>
                <td className="px-4 py-2 tabular-nums text-amber-700">{r.pending || ''}</td></tr>))}
          </tbody>
        </table></div>
      )}
      <p className="px-4 py-2 text-[11px] text-slate-400">Days are working days (weekly off excluded). A leave’s paid days are its first days; the rest are loss of pay.</p>
    </div>
  )
}
