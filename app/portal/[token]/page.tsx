'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle, Clock, XCircle, AlertCircle, Phone,
  Mail, User, Zap, Sun, TrendingDown, IndianRupee, FileText
} from 'lucide-react'

/* ── Types ────────────────────────────────────────────────────── */
interface Quotation {
  id: string
  quotation_number: string
  customer_name: string
  mobile: string
  email?: string
  address?: string
  city?: string
  consumer_type: string
  solar_type: string
  status: string
  recommended_capacity_kw?: number
  admin_capacity_kw?: number
  estimated_monthly_savings?: number
  estimated_yearly_savings?: number
  estimated_payback_years?: number
  estimated_25yr_savings?: number
  subsidy_applicable?: number
  admin_total_cost?: number
  total_cost_before_subsidy?: number
  admin_subsidy?: number
  admin_net_cost?: number
  net_cost_after_subsidy?: number
  rejection_reason?: string
  more_info_request?: string
  approved_at?: string
  created_at: string
  assigned_sales?: { full_name: string; phone?: string; email?: string } | null
  admin_system_cost?: number
  admin_gst_amount?: number
  central_subsidy?: number
  state_subsidy?: number
  state_subsidy_name?: string
  valid_until?: string
  revision?: number
  job_number?: string
  accepted_by_name?: string
  accepted_via?: string
  customer_response_at?: string
  panel_brand?: string
  panel_wp?: number
  panel_count?: number
  inverter_label?: string
  system_phase?: number
  panel_mix?: { type: string; brand: string; wp: number; count: number; kwp: number }[] | null
  dcr_kw?: number | null
  battery_label?: string
  battery_qty?: number
}
interface LineItem    { description: string; quantity: number; unit: string; unit_price: number }
interface HistoryItem { to_status: string; changed_by_name?: string; remarks?: string; created_at: string }
interface StageItem   { stage_name: string; status: string; completed_at?: string }
interface PaymentItem { milestone_name: string; amount: number; status: string; paid_date?: string }

/* ── Helpers ──────────────────────────────────────────────────── */
const STATUS_LABEL: Record<string, string> = {
  new: 'Received', sales_review: 'Under Review', site_visit_scheduled: 'Site Visit Scheduled',
  site_visit_done: 'Site Visit Done', technical_review: 'Technical Review',
  drafted: 'Quotation Drafted', owner_approval_pending: 'Pending Approval',
  approved: 'Approved', sent_to_customer: 'Quotation Sent',
  customer_accepted: 'Accepted', advance_pending: 'Advance Pending',
  project_created: 'Project Started', more_info_requested: 'More Info Needed',
  rejected: 'Rejected', cancelled: 'Cancelled',
}

const CUSTOMER_STAGES = [
  { key: 'new',                  label: 'Request Received' },
  { key: 'site_visit_done',      label: 'Site Visit Done' },
  { key: 'approved',             label: 'Quotation Approved' },
  { key: 'customer_accepted',    label: 'You Accepted' },
  { key: 'project_created',      label: 'Project Started' },
]

function fmt(n?: number) {
  if (n == null) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function isCompleted(qStatus: string, stageKey: string) {
  const order = ['new','sales_review','site_visit_scheduled','site_visit_done',
    'technical_review','drafted','owner_approval_pending','approved',
    'sent_to_customer','customer_accepted','advance_pending','project_created']
  const idx = order.indexOf(qStatus)
  return idx >= order.indexOf(stageKey)
}

/* ── Component ────────────────────────────────────────────────── */
export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>()
  const [data,    setData]    = useState<{
    quotation: Quotation; lineItems: LineItem[]; history: HistoryItem[];
    projectStages: StageItem[]; payments: PaymentItem[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [acc, setAcc] = useState({ name: '', note: '', agree: false, busy: false, err: '' })

  async function accept(e: React.FormEvent) {
    e.preventDefault()
    setAcc(a => ({ ...a, busy: true, err: '' }))
    const r = await fetch('/api/portal/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: acc.name, note: acc.note, agree: acc.agree }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setAcc(a => ({ ...a, busy: false, err: d.error ?? 'Could not record your acceptance. Please try again.' })); return }
    setAcc(a => ({ ...a, busy: false }))
    const fresh = await fetch(`/api/portal?token=${token}`).then(x => x.json()).catch(() => null)
    if (fresh && !fresh.error) setData(fresh)
  }

  useEffect(() => {
    if (!token) return
    fetch(`/api/portal?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setData(d); setLoading(false)
      })
      .catch(() => { setError('Failed to load. Please try again.'); setLoading(false) })
  }, [token])

  /* ── Loading ──────────────────────────────────────────────── */
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading your quotation…</p>
      </div>
    </div>
  )

  /* ── Error ────────────────────────────────────────────────── */
  if (error || !data) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-slate-900 mb-2">Quotation Not Found</h2>
        <p className="text-slate-500 text-sm mb-6">{error || 'Invalid link.'}</p>
        <Link href="/portal" className="text-green-600 font-semibold text-sm hover:underline">← Check your mobile number</Link>
      </div>
    </div>
  )

  const { quotation, lineItems, history, projectStages, payments } = data
  const capacity  = quotation.admin_capacity_kw ?? quotation.recommended_capacity_kw
  const totalCost = quotation.admin_total_cost   ?? quotation.total_cost_before_subsidy
  const central   = quotation.central_subsidy    ?? quotation.admin_subsidy ?? quotation.subsidy_applicable ?? 0
  const stateAid  = quotation.state_subsidy      ?? 0
  const today     = new Date().toISOString().slice(0, 10)
  const expired   = !!quotation.valid_until && quotation.valid_until < today
  const netCost   = quotation.admin_net_cost     ?? quotation.net_cost_after_subsidy
  const isRejected = quotation.status === 'rejected'
  const hasProject = !!quotation.job_number

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-slate-900 via-green-950 to-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Greenergy" className="h-10 bg-white rounded-lg px-2 py-1 object-contain" />
            <div>
              <p className="text-xs text-green-400 font-semibold tracking-widest uppercase">greENERGY Solar Solutions</p>
              <p className="text-[10px] text-slate-400">Pondicherry • Since 2011 • MNRE Certified</p>
            </div>
          </div>
          <h1 className="text-xl font-bold">Your Solar Quotation</h1>
          <p className="text-slate-300 text-sm mt-0.5">
            {quotation.quotation_number}{quotation.revision && quotation.revision > 1 ? ` (rev ${quotation.revision})` : ''} &nbsp;·&nbsp; {quotation.customer_name}
            {quotation.job_number && <><br />Job card {quotation.job_number}</>}
            {quotation.valid_until && !hasProject && <><br />Valid until {new Date(quotation.valid_until + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</>}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm">
            {isRejected
              ? <XCircle size={14} className="text-red-400" />
              : <CheckCircle size={14} className="text-green-400" />
            }
            <span>{STATUS_LABEL[quotation.status] ?? quotation.status}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ── Rejected notice ─────────────────────────────── */}
        {isRejected && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
            <XCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-semibold text-red-800 text-sm">Quotation Not Approved</p>
              <p className="text-red-600 text-sm mt-1">{quotation.rejection_reason ?? 'Please contact us for details.'}</p>
            </div>
          </div>
        )}

        {/* ── More info requested ─────────────────────────── */}
        {quotation.status === 'more_info_requested' && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3">
            <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-semibold text-orange-800 text-sm">Additional Information Needed</p>
              <p className="text-orange-600 text-sm mt-1">{quotation.more_info_request}</p>
              <p className="text-orange-600 text-sm mt-1">Please call us at <strong>+91 99432 56109</strong> to provide this information.</p>
            </div>
          </div>
        )}

        {/* ── Progress tracker ────────────────────────────── */}
        {!isRejected && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 text-sm mb-4">Quotation Progress</h2>
            <div className="flex items-start">
              {CUSTOMER_STAGES.map((stage, i) => {
                const done    = isCompleted(quotation.status, stage.key)
                const current = quotation.status === stage.key ||
                  (i > 0 && isCompleted(quotation.status, CUSTOMER_STAGES[i-1].key) && !isCompleted(quotation.status, stage.key))
                return (
                  <div key={stage.key} className="flex flex-col items-center flex-1">
                    <div className="flex items-center w-full">
                      {i > 0 && <div className={`flex-1 h-1 ${done ? 'bg-green-500' : 'bg-slate-200'}`} />}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2
                        ${done    ? 'bg-green-500 border-green-500 text-white' :
                          current ? 'bg-white border-green-500 text-green-500' :
                                    'bg-white border-slate-200 text-slate-400'}`}>
                        {done ? <CheckCircle size={14} /> : <span className="text-xs font-bold">{i+1}</span>}
                      </div>
                      {i < CUSTOMER_STAGES.length - 1 && <div className={`flex-1 h-1 ${isCompleted(quotation.status, CUSTOMER_STAGES[i+1].key) ? 'bg-green-500' : 'bg-slate-200'}`} />}
                    </div>
                    <p className="text-[10px] text-center mt-1.5 text-slate-600 font-medium leading-tight px-0.5">{stage.label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── System estimate ─────────────────────────────── */}
        {capacity && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 text-sm mb-4">System Estimate</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-orange-50 rounded-xl p-3 text-center">
                <Sun size={18} className="text-orange-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-orange-600">{capacity} kW</p>
                <p className="text-[10px] text-slate-500">System Size</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <Zap size={18} className="text-green-600 mx-auto mb-1" />
                <p className="text-lg font-bold text-green-700">{fmt(quotation.estimated_monthly_savings)}</p>
                <p className="text-[10px] text-slate-500">Monthly Savings</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <TrendingDown size={18} className="text-blue-600 mx-auto mb-1" />
                <p className="text-lg font-bold text-blue-700">{quotation.estimated_payback_years != null ? `${quotation.estimated_payback_years.toFixed(1)} yrs` : '—'}</p>
                <p className="text-[10px] text-slate-500">Payback Period</p>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 text-center">
                <IndianRupee size={18} className="text-purple-600 mx-auto mb-1" />
                <p className="text-lg font-bold text-purple-700">{fmt(quotation.estimated_25yr_savings)}</p>
                <p className="text-[10px] text-slate-500">25-yr Savings</p>
              </div>
            </div>

            {quotation.panel_count ? (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">What you get</p>
                {quotation.panel_mix?.length ? quotation.panel_mix.map((m, i) => (
                  <p key={i}>Solar panels: <b>{m.count} × {m.brand} {m.wp} Wp</b> {m.type === 'DCR' ? 'DCR (made in India, subsidy eligible)' : 'Non-DCR'}</p>
                )) : <p>Solar panels: <b>{quotation.panel_count} × {quotation.panel_brand} {quotation.panel_wp} Wp</b></p>}
                {quotation.panel_mix?.length && quotation.dcr_kw ? <p className='text-xs text-slate-500'>Subsidy is worked out on the {quotation.dcr_kw} kW of DCR panels.</p> : null}
                {quotation.inverter_label && <p>Inverter: <b>{quotation.inverter_label}</b>{quotation.system_phase ? ` (${quotation.system_phase}-phase)` : ''}</p>}
                {quotation.battery_label && <p>Battery: <b>{quotation.battery_qty} × {quotation.battery_label}</b></p>}
                <p className="text-xs text-slate-500">Includes mounting structure, DC/AC cabling, ACDB/DCDB, earthing, lightning arrester, installation and net-meter application support.</p>
              </div>
            ) : null}

            {/* Cost breakup */}
            {(totalCost || netCost) && (
              <div className="mt-4 border-t border-slate-100 pt-4 space-y-2">
                {quotation.admin_system_cost != null && <div className="flex justify-between text-sm"><span className="text-slate-500">System (before GST)</span><span>{fmt(quotation.admin_system_cost)}</span></div>}
                {quotation.admin_gst_amount != null && <div className="flex justify-between text-sm"><span className="text-slate-500">GST 8.9%</span><span>{fmt(quotation.admin_gst_amount)}</span></div>}
                {totalCost != null && <div className="flex justify-between text-sm font-bold"><span>Total payable to Greenergy (incl. GST)</span><span>{fmt(totalCost)}</span></div>}
                {central > 0 && <div className="flex justify-between text-sm text-green-700"><span>PM Surya Ghar central subsidy — credited later</span><span className="font-semibold">{fmt(central)}</span></div>}
                {stateAid > 0 && <div className="flex justify-between text-sm text-green-700"><span>{quotation.state_subsidy_name ?? 'State subsidy'} — credited later</span><span className="font-semibold">{fmt(stateAid)}</span></div>}
                {(central > 0 || stateAid > 0) && netCost != null && <div className="flex justify-between text-sm font-bold border-t border-slate-100 pt-2"><span>Your effective cost after subsidies</span><span className="text-orange-600">{fmt(netCost)}</span></div>}
                {(central > 0 || stateAid > 0) && <p className="text-[11px] text-slate-400">Subsidies are not deducted from the price. After installation, government verification and approval they are credited directly to your bank account; timing is decided by the government.</p>}
              </div>
            )}

            {/* Line items */}
            {lineItems.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Price Breakdown</p>
                <div className="space-y-1">
                  {lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between text-xs text-slate-600">
                      <span>{li.description} {li.quantity > 1 ? `× ${li.quantity} ${li.unit}` : ''}</span>
                      <span className="font-medium">₹{(li.quantity * li.unit_price).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Accept ───────────────────────────────────────── */}
        {quotation.status === 'sent_to_customer' && !expired && (
          <form onSubmit={accept} className="bg-white rounded-xl border-2 border-green-200 shadow-sm p-5 space-y-3">
            <h2 className="font-semibold text-slate-900">Accept this quotation</h2>
            <p className="text-xs text-slate-500">Accepting tells our team to go ahead with the site visit and order confirmation. No payment is taken online.</p>
            <label className="block text-sm"><span className="font-medium text-slate-700">Your full name</span>
              <input required minLength={2} maxLength={80} value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} autoComplete="name"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
            <label className="block text-sm"><span className="font-medium text-slate-700">Message for us (optional)</span>
              <textarea maxLength={500} rows={2} value={acc.note} onChange={e => setAcc({ ...acc, note: e.target.value })} placeholder="e.g. Please call after 6 pm"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2" /></label>
            <label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" required checked={acc.agree} onChange={e => setAcc({ ...acc, agree: e.target.checked })} className="mt-1" />
              I accept quotation {quotation.quotation_number} for {fmt(totalCost)} (incl. GST).</label>
            {acc.err && <p role="alert" className="text-sm text-red-600">{acc.err}</p>}
            <button disabled={acc.busy} className="bg-green-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-green-700 disabled:opacity-50">{acc.busy ? 'Saving…' : 'Accept quotation'}</button>
          </form>
        )}
        {quotation.status === 'sent_to_customer' && expired && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">This quotation&apos;s validity has ended. Please call +91 99432 56109 for an updated quotation.</div>
        )}
        {['customer_accepted', 'advance_pending', 'project_created'].includes(quotation.status) && quotation.accepted_by_name && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 flex gap-2"><CheckCircle size={16} className="shrink-0 mt-0.5" />
            <span>Thank you — accepted by {quotation.accepted_by_name}{quotation.customer_response_at ? ' on ' + new Date(quotation.customer_response_at).toLocaleDateString('en-IN') : ''}. Our team will contact you to confirm the order.</span></div>
        )}

        {/* ── Project stages (if converted) ───────────────── */}
        {hasProject && projectStages.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 text-sm mb-4">Installation Progress</h2>
            <div className="space-y-2">
              {projectStages.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    s.status === 'completed' ? 'bg-green-100 text-green-600' :
                    s.status === 'in_progress' ? 'bg-blue-100 text-blue-600' :
                    'bg-slate-100 text-slate-400'
                  }`}>
                    {s.status === 'completed' ? <CheckCircle size={14} /> : <Clock size={14} />}
                  </div>
                  <div className="flex-1 flex justify-between">
                    <span className={`text-sm ${s.status === 'completed' ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>{s.stage_name}</span>
                    {s.completed_at && <span className="text-xs text-slate-400">{new Date(s.completed_at).toLocaleDateString('en-IN')}</span>}
                    {s.status === 'in_progress' && <span className="text-xs text-blue-600 font-medium">In Progress</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment milestones ───────────────────────────── */}
        {hasProject && payments.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 text-sm mb-4">Payment Status</h2>
            <div className="space-y-2">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{p.milestone_name}</p>
                    {p.paid_date && <p className="text-xs text-slate-400">Paid on {new Date(p.paid_date).toLocaleDateString('en-IN')}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{fmt(p.amount)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      p.status === 'paid'    ? 'bg-green-100 text-green-700' :
                      p.status === 'overdue' ? 'bg-red-100 text-red-700'    :
                                               'bg-amber-100 text-amber-700'
                    }`}>{p.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Status timeline ──────────────────────────────── */}
        {history.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 text-sm mb-4">Activity Timeline</h2>
            <div className="space-y-3">
              {history.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                    {i < history.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm font-medium text-slate-800">{STATUS_LABEL[h.to_status] ?? h.to_status}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(h.created_at).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Contact your sales rep ───────────────────────── */}
        {quotation.assigned_sales && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-5">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-2">Your Greenergy Contact</p>
            <p className="font-semibold text-slate-900">{quotation.assigned_sales.full_name}</p>
            {quotation.assigned_sales.phone && (
              <a href={`tel:${quotation.assigned_sales.phone}`} className="flex items-center gap-2 text-sm text-green-700 mt-1.5 hover:underline">
                <Phone size={13} /> {quotation.assigned_sales.phone}
              </a>
            )}
            {quotation.assigned_sales.email && (
              <a href={`mailto:${quotation.assigned_sales.email}`} className="flex items-center gap-2 text-sm text-green-700 mt-1 hover:underline">
                <Mail size={13} /> {quotation.assigned_sales.email}
              </a>
            )}
          </div>
        )}

        {/* ── General contact ─────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Need Help?</p>
            <p className="text-xs text-slate-500 mt-0.5">Our team is available Mon–Sat, 9am–6pm</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href="tel:+919943256109" className="flex items-center gap-2 bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-700 transition">
              <Phone size={14} /> Call Us
            </a>
            <a href="https://wa.me/919943256109" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-green-500 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-600 transition">
              <FileText size={14} /> WhatsApp
            </a>
          </div>
        </div>

        {/* ── Disclaimer ───────────────────────────────────── */}
        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          This is a preliminary estimate. Final quotation is subject to site inspection, technical feasibility,
          DISCOM/EB approval, stock availability, and management approval.
          Greenergy Solar Solutions — No.234, Lawspet Main Road, Pondicherry 605008.
        </p>

      </div>
    </div>
  )
}
