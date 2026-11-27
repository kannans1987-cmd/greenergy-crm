'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle, Phone, Flame, Snowflake } from 'lucide-react'
import Header from '@/components/staff/Header'
import { JOBS, ROLE_LABELS, TEMP_NEXT_DAYS, daysFromToday, STATUS_LABELS, type Role } from '@/lib/workflow'

// Quick form for enquiries that come by phone, walk-in, referral or WhatsApp.
// Saving gives the enquiry its number (GSS-QT-<year>-<n>) and puts it in the Quotations list.

interface Person { id: string; full_name: string; role: Role }
interface Match { id: string; quotation_number: string; customer_name: string; status: string; created_at: string; job_number: string | null }

const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white'
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3'
const SOURCES = [['phone', '📞 Phone call'], ['walk_in', '🚶 Walk-in'], ['referral', '🤝 Referral'], ['social_media', '💬 WhatsApp / social'], ['other', 'Other']] as const

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}</label>
}

const EMPTY = {
  customer_name: '', mobile: '', city: '', address: '', email: '', region: 'puducherry',
  consumer_type: 'domestic', solar_type: 'ongrid', required_capacity_kw: '', avg_monthly_bill: '',
  source: 'phone', notes: '', priority: 'normal', referral_code: '',
  lead_temperature: '', lead_note: '', next_follow_up_date: daysFromToday(1),
  assigned_engineer_id: '', assigned_sales_id: '', follow_up_manager_id: '', site_visit_at: '',
}

export default function PhoneEnquiryPage() {
  const [f, setF] = useState({ ...EMPTY })
  const [people, setPeople] = useState<Person[]>([])
  const [role, setRole] = useState<Role | null>(null)
  const [delegate, setDelegate] = useState(false)
  const [viewer, setViewer] = useState(false)
  const blocked = role === 'employee' && !delegate && !viewer
  const [matches, setMatches] = useState<Match[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: string; quotation_number: string; name: string; warning: string } | null>(null)
  const set = (k: keyof typeof EMPTY, v: string) => setF(x => ({ ...x, [k]: v }))

  useEffect(() => {
    fetch('/api/profiles').then(r => r.ok ? r.json() : { profiles: [] }).then(d => setPeople(d.profiles ?? [])).catch(() => {})
    fetch('/api/profiles?me=1').then(r => r.ok ? r.json() : null).then(d => { setRole(d?.me?.role ?? 'employee'); setDelegate(!!d?.me?.quotation_access); setViewer(!!d?.me?.quotation_view || !!d?.me?.allocation_level) }).catch(() => {})
  }, [])

  // Warn when this mobile number already has an enquiry
  useEffect(() => {
    const m = f.mobile.replace(/\D/g, '')
    if (m.length < 10) { setMatches([]); return }
    const t = setTimeout(() => {
      fetch(`/api/quotations/enquiry?mobile=${encodeURIComponent(m)}`).then(r => r.ok ? r.json() : { matches: [] })
        .then(d => setMatches(d.matches ?? [])).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [f.mobile])

  const setTemp = (t: string) => setF(x => ({ ...x, lead_temperature: x.lead_temperature === t ? '' : t,
    next_follow_up_date: x.lead_temperature === t ? x.next_follow_up_date : daysFromToday(TEMP_NEXT_DAYS[t] ?? 1) }))

  const save = async () => {
    setError('')
    if (!f.customer_name.trim()) { setError('Enter the customer’s name.'); return }
    if (f.mobile.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit mobile number.'); return }
    if (matches.length && !window.confirm(`This mobile number already has ${matches.length} enquir${matches.length > 1 ? 'ies' : 'y'} (${matches.map(m => m.quotation_number).join(', ')}). Log a new one anyway?`)) return
    setSaving(true)
    try {
      const r = await fetch('/api/quotations/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, site_visit_at: f.site_visit_at ? new Date(f.site_visit_at).toISOString() : null }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Could not save.')
      setDone({ id: d.id, quotation_number: d.quotation_number, name: f.customer_name.trim(), warning: d.warning ?? '' })
      window.scrollTo({ top: 0 })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setSaving(false) }
  }

  const sorted = [...people].sort((a, b) => Number(b.role === 'task_manager') - Number(a.role === 'task_manager') || a.full_name.localeCompare(b.full_name))

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Log an enquiry" subtitle="Phone call, walk-in, referral or WhatsApp — gets a number and goes into Quotations" />
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
        <Link href="/staff/quotations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Quotations</Link>

        {blocked && (
          <p className="text-sm bg-amber-50 text-amber-800 border border-amber-100 rounded-lg p-3">Only the CEO, the admin manager, or staff the CEO gave quotation access (User Management → Quotations) can log enquiries here.</p>
        )}

        {done ? (
          <div className={`${CARD} text-center`}>
            <CheckCircle size={40} className="text-green-500 mx-auto" />
            <p className="text-lg font-bold text-slate-900">Enquiry {done.quotation_number}</p>
            <p className="text-sm text-slate-600">{done.name} is now in the Quotations list{f.assigned_engineer_id || f.assigned_sales_id || f.follow_up_manager_id ? ' and the people you chose have been notified' : ' under “Not allocated”'}.</p>
            {done.warning && <p className="text-xs text-amber-700">{done.warning}</p>}
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              <Link href={`/staff/quotations/${done.id}`} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">Open {done.quotation_number}</Link>
              <button onClick={() => { setDone(null); setF({ ...EMPTY, next_follow_up_date: daysFromToday(1) }); setMatches([]) }}
                className="px-4 py-2 border border-slate-200 text-sm font-semibold rounded-lg hover:bg-slate-50">Log another enquiry</button>
            </div>
          </div>
        ) : (<>
          <div className={CARD}>
            <p className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Phone size={15} className="text-green-600" /> Customer</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name *"><input className={INPUT} value={f.customer_name} onChange={e => set('customer_name', e.target.value)} autoFocus /></Field>
              <Field label="Mobile *"><input className={INPUT} value={f.mobile} onChange={e => set('mobile', e.target.value)} inputMode="tel" placeholder="10-digit number" /></Field>
              {matches.length > 0 && (
                <div className="sm:col-span-2 text-xs bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-amber-800">
                  <AlertTriangle size={13} className="inline mr-1" />This number is already in the CRM:{' '}
                  {matches.map((m, i) => <span key={m.id}>{i ? ', ' : ''}<Link className="underline font-semibold" href={`/staff/quotations/${m.id}`} target="_blank">{m.job_number ?? m.quotation_number}</Link> {m.customer_name} ({STATUS_LABELS[m.status] ?? m.status})</span>)}.
                  {' '}Open it instead if it is the same enquiry.
                </div>
              )}
              <Field label="Town / area"><input className={INPUT} value={f.city} onChange={e => set('city', e.target.value)} placeholder="e.g. Lawspet" /></Field>
              <Field label="Electricity connection in"><select className={INPUT} value={f.region} onChange={e => set('region', e.target.value)}>
                <option value="puducherry">Puducherry</option><option value="tamilnadu">Tamil Nadu</option></select></Field>
              <Field label="Address (if given)" wide><input className={INPUT} value={f.address} onChange={e => set('address', e.target.value)} /></Field>
            </div>
          </div>

          <div className={CARD}>
            <p className="text-sm font-semibold text-slate-800">What they want</p>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map(([k, label]) => (
                <button key={k} type="button" onClick={() => set('source', k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${f.source === k ? 'bg-green-600 border-green-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
            {f.source === 'referral' && (
              <Field label="Referral code of the customer who sent them (optional, e.g. GK7M4Q)">
                <input className={INPUT} value={f.referral_code} maxLength={12} onChange={e => set('referral_code', e.target.value.toUpperCase())}
                  placeholder="On the referrer's commissioning report or ask them" />
              </Field>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Customer type"><select className={INPUT} value={f.consumer_type} onChange={e => set('consumer_type', e.target.value)}>
                {['domestic', 'commercial', 'industrial', 'institution', 'agricultural'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></Field>
              <Field label="System"><select className={INPUT} value={f.solar_type} onChange={e => set('solar_type', e.target.value)}>
                <option value="ongrid">On-grid</option><option value="hybrid">Hybrid</option><option value="offgrid">Off-grid</option><option value="solar_pump">Solar pump</option><option value="not_sure">Not sure</option></select></Field>
              <Field label="Size (kW, approx.)"><input className={INPUT} type="number" min="0" step="0.5" value={f.required_capacity_kw} onChange={e => set('required_capacity_kw', e.target.value)} /></Field>
              <Field label="Bill / month (₹)"><input className={INPUT} type="number" min="0" value={f.avg_monthly_bill} onChange={e => set('avg_monthly_bill', e.target.value)} /></Field>
            </div>
            <Field label="What the customer said"><textarea className={INPUT} rows={3} maxLength={2000} value={f.notes} onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Saw our board at Lawspet. 2-storey house, wants subsidy, asked for a visit on Saturday morning." /></Field>
          </div>

          <div className={CARD}>
            <p className="text-sm font-semibold text-slate-800">Lead & follow-up</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setTemp('hot')} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border ${f.lead_temperature === 'hot' ? 'bg-orange-500 border-orange-500 text-white' : 'border-orange-200 text-orange-600'}`}><Flame size={13} /> Hot</button>
              <button type="button" onClick={() => setTemp('cold')} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border ${f.lead_temperature === 'cold' ? 'bg-sky-500 border-sky-500 text-white' : 'border-sky-200 text-sky-600'}`}><Snowflake size={13} /> Cold</button>
              <span className="text-xs text-slate-400">{f.lead_temperature ? '' : 'Not set — you can mark it later'}</span>
              <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">Call back on
                <input type="date" className="border border-slate-200 rounded-lg px-2 py-1 text-sm" value={f.next_follow_up_date} onChange={e => set('next_follow_up_date', e.target.value)} /></label>
            </div>
            {f.lead_temperature && <input className={INPUT} maxLength={300} value={f.lead_note} onChange={e => set('lead_note', e.target.value)}
              placeholder={f.lead_temperature === 'hot' ? 'Why hot? e.g. wants it this month' : 'Why cold? e.g. only asking prices'} />}
          </div>

          <div className={CARD}>
            <p className="text-sm font-semibold text-slate-800">Give the work to <span className="font-normal text-slate-400">(optional — you can do it later)</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {JOBS.map(j => (
                <Field key={j.key} label={j.label}>
                  <select className={INPUT} value={f[j.key]} onChange={e => set(j.key, e.target.value)}>
                    <option value="">— later —</option>
                    {sorted.map(p => <option key={p.id} value={p.id}>{p.full_name} · {ROLE_LABELS[p.role] ?? p.role}</option>)}
                  </select>
                </Field>
              ))}
              <Field label="Site visit date & time"><input className={INPUT} type="datetime-local" value={f.site_visit_at} onChange={e => set('site_visit_at', e.target.value)} /></Field>
            </div>
          </div>

          {error && <p className="text-sm bg-red-50 text-red-700 border border-red-100 rounded-lg p-3">{error}</p>}
          <div className="flex justify-end gap-2 pb-6">
            <Link href="/staff/quotations" className="px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</Link>
            <button onClick={save} disabled={saving || blocked}
              className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin inline mr-1" />}Save enquiry &amp; give number</button>
          </div>
        </>)}
      </div>
    </div>
  )
}
