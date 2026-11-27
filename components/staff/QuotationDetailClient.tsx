'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, CheckCircle, AlertTriangle, Loader2, Zap, Send, Phone, MessageSquare,
  History, User, FileText, Download, Copy, ExternalLink, RotateCcw, XCircle, ClipboardCheck,
  Trash2, MapPin, CalendarClock,
} from 'lucide-react'
import {
  STATUS_LABELS, STATUS_COLORS, FLOW, flowStep, availableActions, convertBlocker, buildPrice, inr,
  REGION_LABELS, GST_NOTE, whatsappLink, suggestNextFollowUp, followUpState, isEditable, ROLE_LABELS, type Role,
  JOBS, PRE_VISIT, isManager,
} from '@/lib/workflow'
import { getBestFix, mapLink } from '@/lib/geo'
import CostingTable, { type Costing } from '@/components/staff/CostingTable'
import HotColdPicker from '@/components/staff/HotColdPicker'
import QuotationChangeRequests, { type ChangeRequest } from '@/components/staff/QuotationChangeRequests'
import PriceInput from '@/components/staff/PriceInput'
import PanelInverterPicker, { type PickerValue } from '@/components/staff/PanelInverterPicker'
import type { PriceMode } from '@/lib/workflow'
import { LOST_REASONS, lostLabel, hoursAgo, groupLink } from '@/lib/growth'
import { canAllocate, allocatable, personTitle, type AllocationLevel } from '@/lib/allocation'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Person { id: string; full_name: string; phone?: string | null; email?: string | null }
interface LineItem { id?: string; description: string; quantity: number; unit_price: number; category?: string | null }
interface History { id: string; from_status: string | null; to_status: string; changed_by_name: string | null; created_at: string; remarks: string | null }
interface Comment { id: string; content: string; is_internal: boolean; author_name: string | null; created_at: string }
interface FollowUp { id: string; contact_type: string; notes: string; temperature: string | null; next_follow_up_date: string | null; created_by_name: string | null; created_at: string }

interface Q {
  id: string; quotation_number: string; status: string; priority: string; revision: number
  customer_name: string; mobile: string; email: string | null; address: string | null; city: string | null; source: string | null
  consumer_type: string | null; solar_type: string | null; region: string | null; panel_type: string | null
  sanctioned_load_kw: number | null; eb_consumer_number: string | null; avg_monthly_bill: number | null; avg_monthly_units: number | null
  roof_type: string | null; available_roof_area_sqft: number | null; current_phase: string | null
  loan_required: boolean | null; subsidy_required: boolean | null; site_visit_required: boolean | null
  recommended_capacity_kw: number | null; required_capacity_kw: number | null
  admin_capacity_kw: number | null; price_per_kw: number | null; discount: number | null
  admin_system_cost: number | null; admin_gst_amount: number | null; admin_total_cost: number | null
  admin_subsidy: number | null; admin_net_cost: number | null; central_subsidy: number | null; state_subsidy: number | null; state_subsidy_name: string | null
  total_cost_before_subsidy: number | null; net_cost_after_subsidy: number | null
  lead_temperature: string | null; next_follow_up_date: string | null; follow_up_count: number
  lead_temperature_note?: string | null; lead_temperature_at?: string | null
  valid_until: string | null; admin_remarks: string | null; rejection_reason: string | null; more_info_request: string | null; lost_reason: string | null
  approved_by_name: string | null; approved_at: string | null; sent_to_customer_at: string | null
  accepted_by_name: string | null; accepted_via: string | null; accepted_note: string | null; customer_response_at: string | null
  portal_token: string; project_id: string | null; job_number: string | null
  assigned_sales_id: string | null; assigned_engineer_id: string | null; follow_up_manager_id: string | null
  assigned_sales: Person | null; assigned_engineer: Person | null; follow_up_manager: Person | null
  eb_bill_url: string | null; roof_photo_url: string | null; notes: string | null; created_at: string
  site_visit_at: string | null; site_visit_done_at: string | null; site_visit_notes: string | null
  site_visit_lat: number | null; site_visit_lng: number | null
  line_items: LineItem[]; status_history: History[]; comments: Comment[]; follow_ups: FollowUp[]
  panel_brand: string | null; panel_wp: number | null; panel_count: number | null; inverter_brand: string | null; inverter_label: string | null
  system_phase: number | null; battery_label: string | null; battery_qty: number | null; priced_from_list: boolean; price_list_month: string | null
  costing: { data: Costing; catalogue_version: number | null; updated_at: string } | null
  lost_reason_code?: string | null; first_contact_at?: string | null; monthly_bill_range?: string | null; pincode?: string | null
  auto_approved?: boolean
  auto_rule?: { eligible: boolean; enabled: boolean; reasons: string[]; margin_pct?: number; discount_pct?: number } | null
  group?: { name: string; code: string; area: string | null; members: number; discount_pct: number; next?: { homes: number; discount_pct: number } } | null
  referrer?: { customer_name: string | null; job_number: string | null; referral_code: string | null } | null
  me: { id: string; full_name: string; role: Role; phone: string | null; quotation_access?: boolean; quotation_view?: boolean; allocation_level?: AllocationLevel }
  change_requests?: ChangeRequest[]
  dcr_kw?: number | null
  panel_mix?: { type: string; brand: string; wp: number; count: number; kwp: number }[] | null
  panel_brand_nondcr?: string | null
  inverter_phase?: string | null
}


// ─── STYLE HELPERS ───────────────────────────────────────────────────────────

const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none bg-white disabled:bg-slate-50 disabled:text-slate-500'
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden'
const CARD_HDR = 'px-5 py-4 border-b border-slate-100 flex items-center gap-2'
const BTN = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 transition'
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtDay = (s: string | null) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const CONTACT_ICON: Record<string, string> = { call: '📞', whatsapp: '💬', visit: '🏠', email: '✉️', note: '📝' }

// ISO time → value for <input type="datetime-local"> in the phone's own time zone
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fmtWhen = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>{children}</label>
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function QuotationDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [q, setQ] = useState<Q | null>(null)
  const [staff, setStaff] = useState<(Person & { role: string; allocation_level?: AllocationLevel })[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [items, setItems] = useState<LineItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [fu, setFu] = useState({ contact_type: 'call', notes: '', temperature: '', next: '' })
  const [comment, setComment] = useState({ text: '', internal: false })
  const [visit, setVisit] = useState<Record<string, string>>({})
  const [gpsMsg, setGpsMsg] = useState('')
  const [lost, setLost] = useState<{ open: boolean; code: string; note: string }>({ open: false, code: '', note: '' })
  const [opts, setOpts] = useState<{ available: boolean; panelBrands?: { DCR: string[]; NonDCR: string[] }; inverterBrands?: { ongrid: string[]; hybrid: string[] } } | null>(null)
  useEffect(() => { fetch('/api/pricing/options').then(r => r.ok ? r.json() : null).then(setOpts).catch(() => {}) }, [])

  const show = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4500) }

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetch(`/api/quotations/${id}`), fetch('/api/profiles')])
      const data = await r.json()
      if (!r.ok) { setLoadError(data.error ?? 'Could not load the quotation.'); return }
      setQ(data)
      setItems((data.line_items ?? []).map((x: LineItem) => ({ ...x })))
      setForm({
        customer_name: data.customer_name ?? '', mobile: data.mobile ?? '', email: data.email ?? '', address: data.address ?? '',
        city: data.city ?? '', eb_consumer_number: data.eb_consumer_number ?? '', region: data.region ?? 'puducherry',
        consumer_type: data.consumer_type ?? 'domestic', solar_type: data.solar_type ?? 'ongrid', panel_type: data.panel_type ?? 'DCR',
        admin_capacity_kw: String(data.admin_capacity_kw ?? data.recommended_capacity_kw ?? ''), price_per_kw: String(data.price_per_kw ?? ''),
        discount: String(data.discount ?? 0), valid_until: data.valid_until ?? '', priority: data.priority ?? 'normal',
        assigned_sales_id: data.assigned_sales_id ?? '', assigned_engineer_id: data.assigned_engineer_id ?? '',
        follow_up_manager_id: data.follow_up_manager_id ?? '',
        site_visit_at: data.site_visit_at ? toLocalInput(data.site_visit_at) : '',
        panel_brand: data.panel_type === 'Mixed' ? (data.panel_mix?.find((m: { type: string }) => m.type === 'DCR')?.brand ?? '') : (data.panel_brand ?? ''),
        inverter_brand: data.inverter_brand ?? '', battery_qty: String(data.battery_qty ?? 1),
        dcr_kw: data.dcr_kw != null ? String(data.dcr_kw) : '', panel_brand_nondcr: data.panel_brand_nondcr ?? '', inverter_phase: data.inverter_phase ?? '',
        panel_wp: data.panel_type === 'Mixed' ? String(data.panel_mix?.find((m: { type: string }) => m.type === 'DCR')?.wp ?? '') : String(data.panel_wp ?? ''),
        panel_wp_nondcr: String(data.panel_wp_nondcr ?? data.panel_mix?.find((m: { type: string }) => m.type === 'NonDCR')?.wp ?? ''),
        dcr_panel_qty: String(data.dcr_panel_qty ?? ''), nondcr_panel_qty: String(data.nondcr_panel_qty ?? ''),
        inverter_choice: data.inverter_choice ?? '', inverter_qty: String(data.inverter_qty ?? ''),
        price_mode: data.price_mode ?? 'per_kw', price_entry: data.price_entry != null ? String(data.price_entry) : '',
      })
      setVisit({
        notes: '', roof_type: data.roof_type ?? '', current_phase: data.current_phase ?? '',
        available_roof_area_sqft: String(data.available_roof_area_sqft ?? ''), sanctioned_load_kw: String(data.sanctioned_load_kw ?? ''),
        avg_monthly_units: String(data.avg_monthly_units ?? ''), avg_monthly_bill: String(data.avg_monthly_bill ?? ''),
        eb_consumer_number: data.eb_consumer_number ?? '',
      })
      setDirty(false)
      setFu(f => ({ ...f, next: suggestNextFollowUp(data.sent_to_customer_at, data.follow_up_count ?? 0) }))
      if (s.ok) setStaff((await s.json()).profiles ?? [])
    } catch {
      setLoadError('Could not load the quotation. Check your connection.')
    } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }

  const preview = useMemo(() => {
    const kw = Number(form.admin_capacity_kw), ppk = Number(form.price_per_kw)
    if (!(kw > 0 && (ppk > 0 || Number(form.price_entry) > 0))) return null
    const extras = items.reduce((n, x) => n + (Number(x.quantity) || 1) * (Number(x.unit_price) || 0), 0)
    return buildPrice({ kw, pricePerKw: ppk, extras, discount: Number(form.discount) || 0, region: form.region,
      consumerType: form.consumer_type, solarType: form.solar_type, panelType: form.panel_type, dcrKw: Number(form.dcr_kw) || null,
      entryMode: form.price_mode, entryValue: Number(form.price_entry) || null })
  }, [form, items])

  // ── API helpers ─────────────────────────────────────────────
  async function call(path: string, method: string, body: unknown, key: string, okMsg: string) {
    setBusy(key)
    try {
      const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? 'Something went wrong.')
      show(okMsg); await load(); return data
    } catch (e) { show(e instanceof Error ? e.message : 'Something went wrong.', false); return null }
    finally { setBusy(null) }
  }
  const act = (action: string, extra: Record<string, unknown> = {}, okMsg = 'Updated') =>
    call(`/api/quotations/${id}/approve`, 'POST', { action, ...extra }, action, okMsg)
  const askAct = (action: string, question: string, okMsg: string, extra: Record<string, unknown> = {}) => {
    const r = window.prompt(question); if (r === null) return
    if (!r.trim()) { show('Please add a short note.', false); return }
    return act(action, { remarks: r.trim(), ...extra }, okMsg)
  }

  async function saveEdits(thenSubmit = false, reprice = false, thenApprove = false) {
    const body: Record<string, unknown> = {
      ...(reprice ? { reprice: true, capacity_kw: Number(form.admin_capacity_kw) || null, panel_brand: form.panel_brand || null,
                      panel_wp: Number(form.panel_wp) || null, inverter_brand: form.inverter_brand || null, battery_qty: Number(form.battery_qty) || null } : {}),
      // Panels / inverter chosen by hand and the price as typed (quotation_panels_v1.sql): only once the database has these columns
      ...(q && 'price_mode' in q ? {
          inverter_phase: form.inverter_phase || null, inverter_choice: form.inverter_choice || null, inverter_qty: Number(form.inverter_qty) || null,
          dcr_panel_qty: form.panel_type !== 'NonDCR' ? Number(form.dcr_panel_qty) || null : null,
          nondcr_panel_qty: form.panel_type !== 'DCR' ? Number(form.nondcr_panel_qty) || null : null,
          panel_brand_nondcr: form.panel_type === 'Mixed' ? form.panel_brand_nondcr || null : null,
          panel_wp_nondcr: form.panel_type === 'Mixed' ? Number(form.panel_wp_nondcr) || null : null,
          ...(reprice ? {} : { price_mode: form.price_mode, price_entry: Number(form.price_entry) || null }),
        } : {}),
      customer_name: form.customer_name, mobile: form.mobile, email: form.email, address: form.address, city: form.city,
      eb_consumer_number: form.eb_consumer_number, region: form.region, consumer_type: form.consumer_type,
      solar_type: form.solar_type, panel_type: form.panel_type, admin_capacity_kw: Number(form.admin_capacity_kw) || null,
      price_per_kw: Number(form.price_per_kw) || null, discount: Number(form.discount) || 0, valid_until: form.valid_until || null,
      line_items: items,
    }
    const ok = await call(`/api/quotations/${id}`, 'PATCH', body, reprice ? 'reprice' : 'save', reprice ? 'Re-priced from the price list' : 'Quotation saved')
    if (ok && thenSubmit) await submitForApproval()
    if (ok && thenApprove) {
      const sub = await act('submit', {}, 'Submitted')
      if (sub) await act('approve', { remarks: 'Edited and approved by the CEO' }, 'Saved and approved')
    }
  }

  async function submitForApproval() {
    const r = await act('submit', {}, 'Submitted')
    if (r?.auto_approved) show('Approved automatically — inside the CEO’s rules. Share it with the customer.')
    else if (r) show('Submitted for CEO approval' + (r.auto_reasons?.length ? ' (needs the CEO: ' + r.auto_reasons.join('; ') + ')' : ''))
  }

  async function markLost() {
    if (!lost.code) { show('Choose why the customer did not go ahead.', false); return }
    if (!lost.note.trim()) { show('Add a short note (who they chose, what price, when to try again…).', false); return }
    const r = await act('lose', { code: lost.code, remarks: lost.note.trim() }, 'Marked lost')
    if (r) setLost({ open: false, code: '', note: '' })
  }

  // People: who does the visit, the quotation and the follow-up; plus the visit date
  async function savePeople() {
    if (!q) return
    const r = await call(`/api/quotations/${id}`, 'PATCH', { assigned_sales_id: form.assigned_sales_id, follow_up_manager_id: form.follow_up_manager_id,
      assigned_engineer_id: form.assigned_engineer_id }, 'assign', 'Work allocated — each person has been notified')
    const before = q.site_visit_at ? toLocalInput(q.site_visit_at) : ''
    if (r && form.site_visit_at && form.site_visit_at !== before && PRE_VISIT.includes(q.status)) {
      await act('schedule_visit', { site_visit_at: new Date(form.site_visit_at).toISOString() }, 'Work allocated and site visit planned')
    }
  }

  // Site visit report, with the phone's GPS as proof of the visit
  async function recordVisit() {
    if (!visit.notes?.trim()) { show('Write what you saw and what the customer wants.', false); return }
    setBusy('visit'); setGpsMsg('Getting your GPS location… stand still for a few seconds.')
    let lat: number | null = null, lng: number | null = null
    try { const fix = await getBestFix(); lat = fix.latitude; lng = fix.longitude }
    catch (e) {
      if (!window.confirm(`${e instanceof Error ? e.message : 'No location.'}

Save the visit without GPS? The CEO will see that the location is missing.`)) { setBusy(null); setGpsMsg(''); return }
    }
    setGpsMsg(''); setBusy(null)
    await act('visit_done', { remarks: visit.notes.trim(), details: visit, lat, lng }, 'Site visit recorded — the quotation preparer has been notified')
  }

  async function removeQuotation() {
    if (!q) return
    const reason = window.prompt(`Delete quotation ${q.quotation_number} for ${q.customer_name}?

This cannot be undone. Its follow-ups, comments and uploaded files are deleted too.

Reason (e.g. duplicate, test, wrong customer):`)
    if (reason === null) return
    if (!reason.trim()) { show('Please give a short reason for deleting.', false); return }
    setBusy('remove')
    try {
      const r = await fetch(`/api/quotations/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? 'Could not delete.')
      router.push('/staff/quotations'); router.refresh()
    } catch (e) { show(e instanceof Error ? e.message : 'Could not delete.', false); setBusy(null) }
  }

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!q) return (
    <div className="flex items-center justify-center h-screen text-center p-6">
      <div><AlertTriangle size={36} className="mx-auto mb-3 text-slate-300" /><p className="text-slate-600">{loadError}</p>
        <Link href="/staff/quotations" className="text-green-600 text-sm mt-3 inline-block hover:underline">Back to quotations</Link></div>
    </div>
  )

  const me = q.me
  const can = availableActions(q, me.role, me.id, !!me.quotation_access)
  // Sr / Jr Admin Managers allocate the work too (Jr: not to a Sr Admin Manager); the database checks it
  const canReassign = can.reassign || (canAllocate(me.role, me.allocation_level) && q.status !== 'project_created')
  const step = flowStep(q.status)
  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal/${q.portal_token}` : ''
  const shared = ['sent_to_customer', 'customer_accepted', 'advance_pending', 'project_created'].includes(q.status)
  const fuState = followUpState(q.next_follow_up_date, q.status)
  const why = convertBlocker(q)
  const kw = q.admin_capacity_kw ?? q.recommended_capacity_kw
  const total = q.admin_total_cost ?? q.total_cost_before_subsidy
  const custMsg = `Dear ${q.customer_name}, thank you for considering Greenergy Solar Solutions. Your solar quotation ${q.quotation_number} (${kw ?? ''} kW, ${inr(total)} incl. GST) is ready: ${portalUrl}\nYou can view, print and accept it online. For any questions call +91 99432 56109.`
  const mgrMsg = `Follow-up: quotation ${q.quotation_number} for ${q.customer_name} (${q.mobile}), ${kw ?? ''} kW, ${inr(total)}. ${typeof window !== 'undefined' ? window.location.href : ''}`
  // Admin managers first in the lists (the usual follow-up people), then everyone else
  const people = [...staff].sort((a, b) => Number(b.role === 'task_manager' || !!b.allocation_level) - Number(a.role === 'task_manager' || !!a.allocation_level) || a.full_name.localeCompare(b.full_name))
  const givable = new Set(allocatable(people, me.role, me.allocation_level).map(p => p.id))
  const personOf: Record<string, Person | null> = { assigned_engineer_id: q.assigned_engineer, assigned_sales_id: q.assigned_sales, follow_up_manager_id: q.follow_up_manager }
  const workMsg = (job: string) => `Hi, you have been given work in the Greenergy CRM: ${job} for ${q.customer_name} (${q.mobile}${q.city ? ', ' + q.city : ''}), ${q.quotation_number}${job.startsWith('Site') && q.site_visit_at ? ', visit on ' + fmtWhen(q.site_visit_at) : ''}. ${typeof window !== 'undefined' ? window.location.href : ''}`

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* TOP BAR */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/staff/quotations" className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Back to quotations"><ArrowLeft size={18} /></Link>
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-mono">{q.quotation_number}{q.revision > 1 ? ` · rev ${q.revision}` : ''}</p>
            <h1 className="text-sm font-bold text-slate-900 truncate">{q.customer_name}</h1>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${STATUS_COLORS[q.status] ?? 'bg-slate-100'}`}>{STATUS_LABELS[q.status] ?? q.status}</span>
          {q.lead_temperature && (
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${q.lead_temperature === 'hot' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}`}>
              {q.lead_temperature === 'hot' ? '🔥 HOT' : '❄ COLD'}
            </span>
          )}
          {q.job_number && q.project_id && (
            <Link href={`/staff/projects/${q.project_id}`} className={`${BTN} ml-auto bg-emerald-600 text-white hover:bg-emerald-700`}>
              <Zap size={13} /> Job card {q.job_number}
            </Link>
          )}
        </div>
      </div>

      {toast && (
        <div role="status" className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 max-w-sm ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}{toast.msg}
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">
        {/* FLOW + ACTIONS */}
        <div className={`${CARD} p-5 space-y-4`}>
          <ol className="flex flex-wrap gap-1.5 text-[11px] font-medium" aria-label="Workflow">
            {FLOW.map((f, i) => (
              <li key={f.key} className={`px-2.5 py-1 rounded-full ${i === step ? 'bg-green-700 text-white' : i < step ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {i + 1}. {f.label}
              </li>
            ))}
          </ol>

          {q.status === 'drafted' && q.admin_remarks && <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2"><b>CEO note:</b> {q.admin_remarks}</p>}
          {q.status === 'rejected' && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2"><b>Rejected:</b> {q.rejection_reason}</p>}
          {q.status === 'more_info_requested' && <p className="text-sm bg-orange-50 text-orange-700 rounded-lg px-3 py-2"><b>More information needed:</b> {q.more_info_request}</p>}
          {q.status === 'cancelled' && (q.lost_reason || q.lost_reason_code) && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2"><b>Lost{q.lost_reason_code ? ` — ${lostLabel(q.lost_reason_code)}` : ''}:</b> {q.lost_reason}</p>}
          {!q.first_contact_at && 'first_contact_at' in q && PRE_VISIT.includes(q.status) && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
              <span><b>Not contacted yet</b> — the enquiry came {hoursAgo(q.created_at)} ago. Leads called within the hour are far more likely to buy.</span>
              <a href={`tel:${q.mobile}`} className="ml-auto px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold">Call {q.mobile}</a>
              <span className="w-full text-xs text-red-700">After the call, log it under Follow-ups (or plan the site visit). That clears this alert.</span>
            </div>
          )}
          {(q.referrer || q.group) && (
            <div className="flex flex-wrap gap-2 text-xs">
              {q.referrer && <span className="px-2.5 py-1 rounded-full bg-violet-100 text-violet-800 font-semibold">🤝 Referred by {q.referrer.customer_name ?? 'a customer'}{q.referrer.job_number ? ` (${q.referrer.job_number})` : ''}: reward due if this becomes a job</span>}
              {q.group && <span className="px-2.5 py-1 rounded-full bg-teal-100 text-teal-800 font-semibold">🏘 {q.group.name}: {q.group.members} home{q.group.members === 1 ? '' : 's'}
                {q.group.discount_pct ? ` · group discount ${q.group.discount_pct}% reached` : ''}{q.group.next ? ` · ${q.group.next.homes - q.group.members} more for ${q.group.next.discount_pct}%` : ''}</span>}
              {q.group && <a className="text-teal-700 hover:underline self-center" target="_blank" rel="noopener noreferrer"
                href={whatsappLink(q.mobile, `Invite your neighbours to join "${q.group.name}". The more homes join, the bigger the discount for everyone: ${groupLink(q.group.code)}`)}>WhatsApp the group link to the customer</a>}
            </div>
          )}
          {lost.open && (
            <div className="border border-red-200 bg-red-50/50 rounded-lg p-3 space-y-2">
              <p className="text-sm font-semibold text-red-800">Why did the customer not go ahead?</p>
              <div className="flex flex-wrap gap-1.5">
                {LOST_REASONS.map(r => (
                  <button key={r.code} type="button" onClick={() => setLost({ ...lost, code: r.code })}
                    className={`px-2.5 py-1 rounded-full text-xs border ${lost.code === r.code ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-200 text-slate-700'}`}>{r.label}</button>
                ))}
              </div>
              <textarea className={INPUT} rows={2} maxLength={1000} value={lost.note} onChange={e => setLost({ ...lost, note: e.target.value })}
                placeholder="e.g. Chose XYZ Solar at ₹52,000/kW; may revisit after Pongal" />
              <div className="flex gap-2 justify-end">
                <button className="px-3 py-1.5 text-xs text-slate-600" onClick={() => setLost({ open: false, code: '', note: '' })}>Cancel</button>
                <button className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-semibold disabled:opacity-50" disabled={!!busy} onClick={markLost}>Mark lost</button>
              </div>
              <p className="text-[11px] text-slate-500">These reasons feed the lost-deals chart in Sales insights, so the weekly review can fix the top reason.</p>
            </div>
          )}
          {can.submit && q.auto_rule?.enabled && (
            <p className={`text-xs rounded-lg px-3 py-2 ${q.auto_rule.eligible ? 'bg-green-50 text-green-800' : 'bg-slate-50 text-slate-600'}`}>
              {q.auto_rule.eligible ? '✓ Inside the CEO’s auto-approval rules: it is approved as soon as it is submitted.'
                : 'Needs the CEO’s approval: ' + q.auto_rule.reasons.join('; ') + '.'}
              {q.auto_rule.margin_pct != null && <span className="text-slate-500"> (margin {q.auto_rule.margin_pct}%, discount {q.auto_rule.discount_pct}%)</span>}
            </p>
          )}
          {q.auto_approved && q.approved_at && <p className="text-xs bg-green-50 text-green-800 rounded-lg px-3 py-2">Approved automatically inside the CEO’s rules on {fmtDate(q.approved_at)}.</p>}
          {q.accepted_by_name || q.accepted_note ? (
            <p className="text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">
              <b>Customer accepted {q.accepted_via === 'portal' ? 'online' : '(recorded by staff)'}:</b> {q.accepted_by_name ?? ''} {q.accepted_note ? `— “${q.accepted_note}”` : ''} · {fmtDate(q.customer_response_at)}
            </p>
          ) : null}
          {fuState && (
            <p className={`text-sm rounded-lg px-3 py-2 ${fuState === 'overdue' ? 'bg-red-50 text-red-700' : fuState === 'today' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
              Next follow-up: <b>{fmtDay(q.next_follow_up_date)}</b>{fuState === 'overdue' ? ' — overdue' : fuState === 'today' ? ' — today' : ''} · {q.follow_up_count} follow-up{q.follow_up_count === 1 ? '' : 's'} so far
            </p>
          )}

          {/* Hot / cold: any stage, so follow-ups can be prioritised from the first enquiry */}
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 pt-1">Lead:</span>
            <HotColdPicker id={q.id} value={q.lead_temperature} note={q.lead_temperature_note} since={q.lead_temperature_at}
              canSet={can.temperature} onDone={() => { show('Hot / cold saved'); load() }} />
          </div>

          <div className="flex flex-wrap gap-2">
            {can.submit && <button className={`${BTN} bg-purple-600 text-white hover:bg-purple-700`} disabled={!!busy}
              onClick={() => (dirty ? saveEdits(true) : submitForApproval())}>
              {busy === 'submit' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit for CEO approval</button>}
            {can.approve && <button className={`${BTN} bg-green-600 text-white hover:bg-green-700`} disabled={!!busy}
              onClick={() => { const r = window.prompt('Approval note (optional):', ''); if (r !== null) act('approve', { remarks: r }, 'Approved') }}>
              <CheckCircle size={12} /> Approve</button>}
            {can.sendBack && <button className={`${BTN} bg-amber-500 text-white hover:bg-amber-600`} disabled={!!busy}
              onClick={() => askAct('send_back', 'What should be changed?', 'Sent back for changes')}><RotateCcw size={12} /> Send back</button>}
            {can.reject && <button className={`${BTN} bg-red-600 text-white hover:bg-red-700`} disabled={!!busy}
              onClick={() => askAct('reject', 'Reason for rejecting:', 'Rejected')}><XCircle size={12} /> Reject</button>}
            {can.share && <button className={`${BTN} bg-orange-500 text-white hover:bg-orange-600`} disabled={!!busy || (!q.follow_up_manager_id && q.status === 'approved')}
              title={!q.follow_up_manager_id ? 'Choose who follows up with the customer first (Work allocation)' : ''}
              onClick={() => act('share', {}, 'Shared — send the link using the buttons below')}>
              <Send size={12} /> {q.status === 'sent_to_customer' ? 'Re-share link' : 'Share with customer'}</button>}
            {can.accept && <button className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!!busy}
              onClick={() => { const r = window.prompt('How did the customer accept? (signed copy, WhatsApp message…)'); if (r && r.trim()) act('accept', { remarks: r.trim(), mark_hot: window.confirm('Also mark this quotation HOT? (needed for the job card)') }, 'Acceptance recorded') }}>
              <ClipboardCheck size={12} /> Customer accepted</button>}
            {can.convert && <button className={`${BTN} bg-emerald-700 text-white hover:bg-emerald-800`} disabled={!!busy || !!why} title={why}
              onClick={async () => { if (!window.confirm(`Create the numbered job card for ${q.customer_name}? The quotation is then locked.`)) return
                const r = await call(`/api/quotations/${id}/convert`, 'POST', {}, 'convert', 'Job card created'); if (r?.project_id) router.push(`/staff/projects/${r.project_id}`) }}>
              {busy === 'convert' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Create numbered job card</button>}
            {can.convert && why && <span className="text-xs text-slate-500 self-center">{why}</span>}
            {can.revise && <button className={`${BTN} bg-slate-100 text-slate-700 hover:bg-slate-200`} disabled={!!busy}
              onClick={() => { if (window.confirm('Revise this quotation? It returns to draft, the customer link stops working and the CEO must approve it again.')) act('revise', {}, 'Revision started') }}>
              <RotateCcw size={12} /> Revise</button>}
            {can.lose && <button className={`${BTN} bg-red-50 text-red-700 hover:bg-red-100`} disabled={!!busy}
              onClick={() => setLost({ open: true, code: '', note: '' })}>Mark lost</button>}
            {can.reopen && <button className={`${BTN} bg-slate-100 text-slate-700`} disabled={!!busy} onClick={() => act('reopen', {}, 'Reopened')}>Reopen</button>}
            {can.remove && <button className={`${BTN} ml-auto bg-white text-red-600 border border-red-200 hover:bg-red-50`} disabled={!!busy} onClick={removeQuotation}
              title="Delete a wrong, test or duplicate quotation">
              {busy === 'remove' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete quotation</button>}
          </div>
        </div>

        {/* "View all" staff ask the CEO for changes; the CEO approves or rejects here */}
        <QuotationChangeRequests quotationId={q.id} current={q as unknown as Record<string, unknown>} requests={q.change_requests ?? []}
          meId={me.id} isCeo={me.role === 'admin'} notify={show} onDone={load}
          canRequest={!!me.quotation_view && !can.edit && !isManager(me.role) && !me.quotation_access && q.status !== 'project_created'} />

        <div className="flex flex-col lg:flex-row gap-5">
          {/* LEFT */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Site visit */}
            <div className={CARD}>
              <div className={CARD_HDR}><MapPin size={16} className="text-indigo-600" /><h3 className="font-semibold text-sm">Site visit &amp; customer meeting</h3>
                <span className="ml-auto text-xs text-slate-500">{q.assigned_engineer ? q.assigned_engineer.full_name : 'Not given to anyone yet'}</span></div>
              <div className="p-5 space-y-3 text-sm">
                {q.site_visit_done_at ? (
                  <div className="bg-indigo-50 rounded-lg p-3 space-y-1">
                    <p className="font-semibold text-indigo-900">Visit done · {fmtWhen(q.site_visit_done_at)}</p>
                    {q.site_visit_notes && <p className="text-slate-700 whitespace-pre-line">{q.site_visit_notes}</p>}
                    <p className="text-xs text-slate-500">
                      {[q.roof_type && `Roof: ${q.roof_type.toUpperCase().replace('_', ' ')}`, q.available_roof_area_sqft && `${q.available_roof_area_sqft} sq ft`,
                        q.current_phase && `${q.current_phase} phase`, q.sanctioned_load_kw && `load ${q.sanctioned_load_kw} kW`,
                        q.avg_monthly_units && `${q.avg_monthly_units} units/month`].filter(Boolean).join(' · ')}
                    </p>
                    {q.site_visit_lat != null && q.site_visit_lng != null
                      ? <a className="text-xs text-green-700 hover:underline" target="_blank" rel="noopener noreferrer" href={mapLink(q.site_visit_lat, q.site_visit_lng)}>📍 Where the visit was recorded</a>
                      : <p className="text-xs text-amber-700">⚠ Recorded without GPS</p>}
                  </div>
                ) : (
                  <p className="text-slate-600">
                    {q.site_visit_at ? <>Planned for <b>{fmtWhen(q.site_visit_at)}</b>.</> : 'No visit date yet.'}{' '}
                    {q.address ? <>Address: {q.address}{q.city ? `, ${q.city}` : ''}. </> : null}
                    <a className="text-green-700 hover:underline" href={`tel:${q.mobile}`}>Call {q.mobile}</a>
                  </p>
                )}
                {can.visit && (
                  <div className="border-t border-slate-100 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-slate-600">Record the visit (do this at the site — your GPS location is saved)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Roof"><select className={INPUT} value={visit.roof_type} onChange={e => setVisit({ ...visit, roof_type: e.target.value })}>
                        <option value="">—</option><option value="rcc">RCC / concrete</option><option value="sheet">Metal sheet</option><option value="ground_mount">Ground</option><option value="other">Other</option></select></Field>
                      <Field label="Shadow-free area (sq ft)"><input className={INPUT} type="number" min="0" value={visit.available_roof_area_sqft} onChange={e => setVisit({ ...visit, available_roof_area_sqft: e.target.value })} /></Field>
                      <Field label="Supply"><select className={INPUT} value={visit.current_phase} onChange={e => setVisit({ ...visit, current_phase: e.target.value })}>
                        <option value="">—</option><option value="single">Single phase</option><option value="three">Three phase</option></select></Field>
                      <Field label="Sanctioned load (kW)"><input className={INPUT} type="number" min="0" step="0.1" value={visit.sanctioned_load_kw} onChange={e => setVisit({ ...visit, sanctioned_load_kw: e.target.value })} /></Field>
                      <Field label="Units per month"><input className={INPUT} type="number" min="0" value={visit.avg_monthly_units} onChange={e => setVisit({ ...visit, avg_monthly_units: e.target.value })} /></Field>
                      <Field label="Bill per month (₹)"><input className={INPUT} type="number" min="0" value={visit.avg_monthly_bill} onChange={e => setVisit({ ...visit, avg_monthly_bill: e.target.value })} /></Field>
                      <div className="col-span-2 sm:col-span-3"><Field label="EB consumer no."><input className={INPUT} value={visit.eb_consumer_number} onChange={e => setVisit({ ...visit, eb_consumer_number: e.target.value })} /></Field></div>
                    </div>
                    <Field label="What you saw & what the customer wants *"><textarea className={INPUT} rows={3} maxLength={1000} value={visit.notes}
                      placeholder="e.g. 2-storey house, RCC roof facing south, water tank on the east side. Wants 3 kW with subsidy, budget ₹2 lakh, decision with son next week."
                      onChange={e => setVisit({ ...visit, notes: e.target.value })} /></Field>
                    {gpsMsg && <p className="text-xs text-blue-700">{gpsMsg}</p>}
                    <button className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50" disabled={!!busy} onClick={recordVisit}>
                      {busy === 'visit' || busy === 'visit_done' ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <CalendarClock size={14} className="inline mr-1" />}Site visit done</button>
                  </div>
                )}
              </div>
            </div>

            {/* Customer & system (editable while a draft) */}
            <div className={CARD}>
              <div className={CARD_HDR}><User size={16} className="text-green-600" /><h3 className="font-semibold text-sm">Customer &amp; system</h3>
                {!can.edit && <span className="ml-auto text-xs text-slate-400">{me.quotation_view && !isManager(me.role) && !me.quotation_access ? 'View only · use “Request a change” above' : isEditable(q.status) ? 'Read only for you' : 'Locked after CEO approval — use Revise to change'}</span>}</div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer name"><input className={INPUT} disabled={!can.edit} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} /></Field>
                <Field label="Mobile"><input className={INPUT} disabled={!can.edit} value={form.mobile} onChange={e => set('mobile', e.target.value)} inputMode="tel" /></Field>
                <Field label="Email"><input className={INPUT} disabled={!can.edit} value={form.email} onChange={e => set('email', e.target.value)} type="email" /></Field>
                <Field label="Town / city"><input className={INPUT} disabled={!can.edit} value={form.city} onChange={e => set('city', e.target.value)} /></Field>
                <div className="sm:col-span-2"><Field label="Site address"><input className={INPUT} disabled={!can.edit} value={form.address} onChange={e => set('address', e.target.value)} /></Field></div>
                <Field label="Electricity connection in"><select className={INPUT} disabled={!can.edit} value={form.region} onChange={e => set('region', e.target.value)}>
                  {Object.entries(REGION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="EB consumer no."><input className={INPUT} disabled={!can.edit} value={form.eb_consumer_number} onChange={e => set('eb_consumer_number', e.target.value)} /></Field>
                <Field label="Consumer type"><select className={INPUT} disabled={!can.edit} value={form.consumer_type} onChange={e => set('consumer_type', e.target.value)}>
                  {['domestic', 'commercial', 'industrial', 'institution', 'agricultural'].map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></Field>
                <Field label="System type"><select className={INPUT} disabled={!can.edit} value={form.solar_type} onChange={e => set('solar_type', e.target.value)}>
                  {[['ongrid', 'On-grid'], ['hybrid', 'Hybrid'], ['offgrid', 'Off-grid'], ['solar_pump', 'Solar pump']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                {!(can.edit && opts?.available) && (
                  <Field label="Panels"><select className={INPUT} disabled={!can.edit} value={form.panel_type} onChange={e => set('panel_type', e.target.value)}>
                    <option value="DCR">DCR (subsidy eligible)</option><option value="NonDCR">Non-DCR</option>
                    {(form.consumer_type === 'domestic' || form.panel_type === 'Mixed') && <option value="Mixed">Mixed: DCR + Non-DCR</option>}</select></Field>
                )}
                <Field label={Number(form.dcr_panel_qty) > 0 || Number(form.nondcr_panel_qty) > 0 ? 'Size (kW) — set by the number of panels' : 'Size (kW)'}>
                  <input className={INPUT} disabled={!can.edit || Number(form.dcr_panel_qty) > 0 || Number(form.nondcr_panel_qty) > 0} type="number" min="0.5" step="0.01"
                    value={form.admin_capacity_kw} onChange={e => set('admin_capacity_kw', e.target.value)} /></Field>
                <div className="sm:col-span-2">
                  <PriceInput label="Price" kw={Number(form.admin_capacity_kw) || 0} disabled={!can.edit}
                    value={{ ppk: Number(form.price_per_kw) || 0, mode: (form.price_mode || 'per_kw') as PriceMode, entry: Number(form.price_entry) || null }}
                    extras={items.reduce((n, x) => n + (Number(x.quantity) || 1) * (Number(x.unit_price) || 0), 0)} discount={Number(form.discount) || 0}
                    price={{ region: form.region, consumerType: form.consumer_type, solarType: form.solar_type, panelType: form.panel_type, dcrKw: Number(form.dcr_kw) || null }}
                    onChange={v => { setForm(x => ({ ...x, price_per_kw: v.ppk ? String(v.ppk) : '', price_mode: v.mode, price_entry: v.entry ? String(v.entry) : '' })); setDirty(true) }} />
                  {!('price_mode' in q) && form.price_mode !== 'per_kw' && <p className="text-[11px] text-amber-700 mt-1">Until the CEO runs the latest database update, a price typed incl. GST is saved as ₹/kW and the total can differ by a rupee.</p>}
                </div>
                <Field label="Discount (₹, before GST)"><input className={INPUT} disabled={!can.edit} type="number" min="0" value={form.discount} onChange={e => set('discount', e.target.value)} /></Field>
                <Field label="Valid until"><input className={INPUT} disabled={!can.edit} type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} /></Field>
              </div>

              <div className="px-5 pb-4">
                <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                  {q.panel_mix?.length ? q.panel_mix.map((m, i) => <p key={i}><b>{m.count} × {m.brand} {m.wp} Wp</b> {m.type === 'DCR' ? 'DCR' : 'Non-DCR'} panels ({m.kwp} kW)</p>)
                    : q.panel_count ? <p><b>{q.panel_count} × {q.panel_brand} {q.panel_wp} Wp</b> {q.panel_type === 'NonDCR' ? 'Non-DCR' : 'DCR'} panels</p> : <p className="text-slate-500">Components not chosen from the price list yet.</p>}
                  {q.panel_type === 'Mixed' && q.dcr_kw ? <p className="text-xs text-green-700">Subsidy worked out on the {q.dcr_kw} kW of DCR panels.</p> : null}
                  {q.inverter_label && <p>Inverter: <b>{q.inverter_label}</b>{q.system_phase ? ` (${q.system_phase}-phase)` : ''}</p>}
                  {q.battery_label && <p>Battery: <b>{q.battery_qty} × {q.battery_label}</b></p>}
                  {q.priced_from_list && <p className="text-xs text-slate-500">Priced from the {q.price_list_month ?? ''} supplier price list{q.price_per_kw ? ` · ${inr(q.price_per_kw)}/kW before GST` : ''}</p>}
                </div>
                {can.edit && opts?.available && (
                  <div className="mt-4 border border-slate-100 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-semibold text-slate-600">Panels &amp; inverter <span className="font-normal text-slate-400">— choose, then press “Re-price” to update the parts and the list price</span></p>
                    {!('price_mode' in q) && <p className="text-xs text-amber-700">Choosing panel numbers, mixed panels and the inverter model needs the latest database update (quotation_panels_v1.sql). Ask the CEO to run it.</p>}
                    <PanelInverterPicker opts={opts} v={form as unknown as PickerValue} set={(k, val) => set(k, val)} />
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="px-3 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50" disabled={!!busy} onClick={() => saveEdits(false, true)}>
                        {busy === 'reprice' && <Loader2 size={12} className="animate-spin inline mr-1" />}Re-price from price list</button>
                      <span className="text-[11px] text-slate-500">Uses the list price. To quote your own figure, type it in “Price” afterwards and save.</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5">
                <p className="text-xs font-semibold text-slate-600 mb-2">Extra items <span className="font-normal text-slate-400">(elevated structure, extra cable, civil work — before GST)</span></p>
                {items.map((x, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input className={`${INPUT} flex-[3]`} disabled={!can.edit} value={x.description} placeholder="Item"
                      onChange={e => { const n = [...items]; n[i] = { ...x, description: e.target.value }; setItems(n); setDirty(true) }} />
                    <input className={`${INPUT} flex-1`} disabled={!can.edit} type="number" value={x.quantity} aria-label="Quantity"
                      onChange={e => { const n = [...items]; n[i] = { ...x, quantity: Number(e.target.value) }; setItems(n); setDirty(true) }} />
                    <input className={`${INPUT} flex-[1.5]`} disabled={!can.edit} type="number" value={x.unit_price} aria-label="Unit price"
                      onChange={e => { const n = [...items]; n[i] = { ...x, unit_price: Number(e.target.value) }; setItems(n); setDirty(true) }} />
                    {can.edit && <button className="px-2 text-slate-400 hover:text-red-600" aria-label="Remove item" onClick={() => { setItems(items.filter((_, j) => j !== i)); setDirty(true) }}>✕</button>}
                  </div>
                ))}
                {can.edit && <button className="text-xs font-semibold text-green-700 hover:underline" onClick={() => { setItems([...items, { description: '', quantity: 1, unit_price: 0 }]); setDirty(true) }}>+ Add item</button>}
                {can.edit && (
                  <div className="flex justify-end gap-2 mt-4">
                    <button className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50" disabled={!dirty || !!busy} onClick={() => saveEdits(false)}>
                      {busy === 'save' && <Loader2 size={14} className="animate-spin inline mr-1" />}Save changes</button>
                    {can.saveApprove && <button className="px-4 py-2 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-800 disabled:opacity-50" disabled={!!busy}
                      title="Save your changes and approve the quotation in one step"
                      onClick={() => { if (window.confirm('Save the changes and approve this quotation now?')) saveEdits(false, false, true) }}>
                      Save &amp; approve</button>}
                  </div>
                )}
              </div>
            </div>

            {/* Share */}
            {shared && (
              <div className={CARD}>
                <div className={CARD_HDR}><Send size={16} className="text-orange-500" /><h3 className="font-semibold text-sm">Customer link &amp; sharing</h3></div>
                <div className="p-5 space-y-3">
                  <div className="flex gap-2">
                    <input className={INPUT} readOnly value={portalUrl} aria-label="Customer link" />
                    <button className="px-3 bg-slate-100 rounded-lg text-xs font-semibold" onClick={() => { navigator.clipboard?.writeText(portalUrl); show('Link copied') }}><Copy size={14} /></button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a className={`${BTN} bg-green-600 text-white`} target="_blank" rel="noopener noreferrer" href={whatsappLink(q.mobile, custMsg)}><MessageSquare size={12} /> WhatsApp customer</a>
                    {q.email && <a className={`${BTN} bg-slate-100 text-slate-700`} href={`mailto:${q.email}?subject=${encodeURIComponent('Your Greenergy solar quotation ' + q.quotation_number)}&body=${encodeURIComponent(custMsg)}`}>Email customer</a>}
                    <a className={`${BTN} bg-green-600 text-white`} target="_blank" rel="noopener noreferrer" href={whatsappLink(q.follow_up_manager?.phone, mgrMsg)}>
                      <MessageSquare size={12} /> WhatsApp follow-up person{q.follow_up_manager ? ` (${q.follow_up_manager.full_name})` : ''}</a>
                    <a className={`${BTN} bg-slate-100 text-slate-700`} target="_blank" rel="noopener noreferrer" href={portalUrl}><ExternalLink size={12} /> Customer view</a>
                  </div>
                  <p className="text-xs text-slate-400">The follow-up person also gets an in-app notification. The customer can view, print and accept on the link.</p>
                </div>
              </div>
            )}

            {/* Follow-ups */}
            <div className={CARD}>
              <div className={CARD_HDR}><Phone size={16} className="text-blue-600" /><h3 className="font-semibold text-sm">Follow-ups</h3>
                <span className="ml-auto text-xs text-slate-400">Suggested rhythm: day 1, 3, 7, 14, 30 after sharing</span></div>
              {can.followUp && (
                <div className="p-5 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Contact"><select className={INPUT} value={fu.contact_type} onChange={e => setFu({ ...fu, contact_type: e.target.value })}>
                    <option value="call">Phone call</option><option value="whatsapp">WhatsApp</option><option value="visit">Site visit</option><option value="email">Email</option><option value="note">Note</option></select></Field>
                  <Field label="Customer is now"><select className={INPUT} value={fu.temperature} onChange={e => setFu({ ...fu, temperature: e.target.value })} disabled={!can.temperature}>
                    <option value="">— no change —</option><option value="hot">🔥 Hot</option><option value="cold">❄ Cold</option></select></Field>
                  <Field label="Next follow-up"><input className={INPUT} type="date" value={fu.next} onChange={e => setFu({ ...fu, next: e.target.value })} /></Field>
                  <div className="sm:col-span-3"><Field label="What happened?"><textarea className={INPUT} rows={2} value={fu.notes} maxLength={2000}
                    placeholder="e.g. Comparing with another quote; wants a site visit on Saturday" onChange={e => setFu({ ...fu, notes: e.target.value })} /></Field></div>
                  <div className="sm:col-span-3 flex justify-end">
                    <button className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={!fu.notes.trim() || !!busy}
                      onClick={async () => { const r = await call(`/api/quotations/${id}/follow-up`, 'POST',
                        { contact_type: fu.contact_type, notes: fu.notes, temperature: fu.temperature || null, next_follow_up_date: fu.next || null }, 'fu', 'Follow-up logged')
                        if (r) setFu(f => ({ ...f, notes: '', temperature: '' })) }}>Log follow-up</button>
                  </div>
                </div>
              )}
              <ul className="divide-y divide-slate-50">
                {q.follow_ups.length === 0 ? <li className="text-center py-6 text-slate-400 text-sm">No follow-ups yet</li> : q.follow_ups.map(f => (
                  <li key={f.id} className="px-5 py-3 text-sm">
                    <p className="text-slate-700">{CONTACT_ICON[f.contact_type] ?? '•'} {f.notes}{f.temperature ? <b className={f.temperature === 'hot' ? ' text-orange-600' : ' text-sky-600'}> · {f.temperature.toUpperCase()}</b> : null}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{f.created_by_name} · {fmtDate(f.created_at)}{f.next_follow_up_date ? ` · next ${fmtDay(f.next_follow_up_date)}` : ''}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Comments */}
            <div className={CARD}>
              <div className={CARD_HDR}><MessageSquare size={16} className="text-slate-500" /><h3 className="font-semibold text-sm">Comments</h3></div>
              <div className="p-5 border-b border-slate-100 space-y-2">
                <textarea className={INPUT} rows={2} value={comment.text} onChange={e => setComment({ ...comment, text: e.target.value })} placeholder="Add a comment…" />
                <div className="flex items-center justify-between">
                  {me.role !== 'employee' ? <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={comment.internal} onChange={e => setComment({ ...comment, internal: e.target.checked })} /> Managers only</label> : <span />}
                  <button className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={!comment.text.trim() || !!busy}
                    onClick={async () => { const r = await call(`/api/quotations/${id}/comment`, 'POST', { content: comment.text, is_internal: comment.internal }, 'comment', 'Comment added'); if (r) setComment({ text: '', internal: false }) }}>Post</button>
                </div>
              </div>
              <ul className="divide-y divide-slate-50">
                {q.comments.map(c => (
                  <li key={c.id} className={`px-5 py-3 ${c.is_internal ? 'bg-amber-50' : ''}`}>
                    <p className="text-xs font-semibold text-slate-700">{c.author_name}{c.is_internal && <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 rounded-full">MANAGERS</span>}<span className="font-normal text-slate-400 ml-2">{fmtDate(c.created_at)}</span></p>
                    <p className="text-sm text-slate-700 whitespace-pre-line">{c.content}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* RIGHT */}
          <div className="lg:w-80 xl:w-96 space-y-5 shrink-0">
            <div className={CARD}>
              <div className={CARD_HDR}><FileText size={16} className="text-purple-600" /><h3 className="font-semibold text-sm">Price</h3>
                {dirty && <span className="ml-auto text-[10px] font-semibold text-amber-600">UNSAVED PREVIEW</span>}</div>
              <dl className="p-5 text-sm space-y-1.5">
                {(() => {
                  const p = dirty && preview ? preview : {
                    system: q.admin_system_cost, gst: q.admin_gst_amount, total: q.admin_total_cost ?? q.total_cost_before_subsidy,
                    central: q.central_subsidy ?? q.admin_subsidy ?? 0, state: q.state_subsidy ?? 0, stateName: q.state_subsidy_name ?? 'State subsidy',
                    net: q.admin_net_cost ?? q.net_cost_after_subsidy,
                  }
                  return <>
                    <div className="flex justify-between"><dt className="text-slate-500">System (before GST)</dt><dd>{inr(p.system)}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500" title={GST_NOTE}>GST 8.9%</dt><dd>{inr(p.gst)}</dd></div>
                    <div className="flex justify-between font-bold border-t pt-1.5"><dt>Total payable</dt><dd>{inr(p.total)}</dd></div>
                    {!!p.central && <div className="flex justify-between text-green-700"><dt>Central subsidy (later)</dt><dd>{inr(p.central)}</dd></div>}
                    {!!p.state && <div className="flex justify-between text-green-700"><dt>{p.stateName || 'State subsidy'} (later)</dt><dd>{inr(p.state)}</dd></div>}
                    {!!(p.central || p.state) && <div className="flex justify-between font-semibold"><dt>Effective cost</dt><dd>{inr(p.net)}</dd></div>}
                  </>
                })()}
              </dl>
              {q.approved_by_name && <p className="px-5 pb-4 text-xs text-slate-500">Approved by {q.approved_by_name} on {fmtDate(q.approved_at)}</p>}
              {q.costing && <div className="px-5 pb-5"><CostingTable costing={q.costing.data} preGstSold={q.admin_system_cost} total={q.admin_total_cost} /></div>}
            </div>

            <div className={CARD}>
              <div className={CARD_HDR}><User size={16} className="text-green-600" /><h3 className="font-semibold text-sm">Work allocation</h3></div>
              <div className="p-5 space-y-3">
                {JOBS.map(j => {
                  const p = personOf[j.key]
                  return (
                    <div key={j.key}>
                      <Field label={j.label}>
                        <select className={INPUT} disabled={!canReassign} value={form[j.key]} onChange={e => set(j.key, e.target.value)}>
                          <option value="">— not given to anyone —</option>
                          {people.filter(s => !canReassign || givable.has(s.id) || s.id === form[j.key]).map(s => (
                            <option key={s.id} value={s.id} disabled={canReassign && !givable.has(s.id)}>
                              {s.full_name} · {personTitle(s, ROLE_LABELS)}{canReassign && !givable.has(s.id) ? ' (only the Sr Admin Manager or CEO can change this)' : ''}</option>))}
                        </select>
                      </Field>
                      {p && p.id !== me.id && (
                        <a className="text-[11px] text-green-700 hover:underline" target="_blank" rel="noopener noreferrer"
                          href={whatsappLink(p.phone ?? staff.find(x => x.id === p.id)?.phone, workMsg(j.label))}>WhatsApp {p.full_name.split(' ')[0]} about this</a>
                      )}
                    </div>
                  )
                })}
                {PRE_VISIT.includes(q.status) && (
                  <Field label="Site visit date & time">
                    <input className={INPUT} type="datetime-local" disabled={!canReassign} value={form.site_visit_at} onChange={e => set('site_visit_at', e.target.value)} />
                  </Field>
                )}
                {canReassign && <button className="w-full py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={!!busy}
                  onClick={savePeople}>{busy === 'assign' || busy === 'schedule_visit' ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}Save &amp; notify</button>}
                <p className="text-[11px] text-slate-400">Any staff member can do any job, and one person can do several. Each person gets a notification and sees it under Quotations → My work. Only the CEO approves.</p>
              </div>
            </div>

            <div className={CARD}>
              <div className={CARD_HDR}><History size={16} className="text-slate-500" /><h3 className="font-semibold text-sm">History</h3></div>
              <ol className="p-5 space-y-3">
                {q.status_history.map(h => (
                  <li key={h.id} className="text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[h.to_status] ?? 'bg-slate-100'}`}>{STATUS_LABELS[h.to_status] ?? h.to_status}</span>
                    <p className="text-slate-600 mt-1">{h.remarks}</p>
                    <p className="text-slate-400">{h.changed_by_name ?? 'System'} · {fmtDate(h.created_at)}</p>
                  </li>
                ))}
              </ol>
            </div>

            {(q.eb_bill_url || q.roof_photo_url) && (
              <div className={CARD}>
                <div className={CARD_HDR}><Download size={16} className="text-slate-500" /><h3 className="font-semibold text-sm">Customer documents</h3></div>
                <div className="p-5 space-y-2 text-sm">
                  {q.eb_bill_url && <a className="block text-green-700 hover:underline" href={q.eb_bill_url} target="_blank" rel="noopener noreferrer">Electricity bill</a>}
                  {q.roof_photo_url && <a className="block text-green-700 hover:underline" href={q.roof_photo_url} target="_blank" rel="noopener noreferrer">Roof photo</a>}
                </div>
              </div>
            )}
            {(q.monthly_bill_range || q.pincode) && <div className={`${CARD} p-5 text-sm`}><p className="font-semibold mb-1">From the enquiry form</p>
              {q.monthly_bill_range && <p className="text-slate-600">Monthly bill: <b>{q.monthly_bill_range}</b></p>}
              {q.pincode && <p className="text-slate-600">PIN code: <b>{q.pincode}</b></p>}</div>}
            {q.notes && <div className={`${CARD} p-5 text-sm`}><p className="font-semibold mb-1">Customer notes</p><p className="text-slate-600 whitespace-pre-line">{q.notes}</p></div>}
          </div>
        </div>
      </div>
    </div>
  )
}
