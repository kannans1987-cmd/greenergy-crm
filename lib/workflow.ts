// Sales & project workflow — labels, screen permissions and subsidy maths.
// The database enforces the same rules (supabase/workflow_v2.sql); this file
// only decides which buttons to show and works out suggested figures.

export type Role = 'admin' | 'task_manager' | 'employee'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'CEO',
  task_manager: 'Admin manager',
  employee: 'Staff',
}

export const STATUS_LABELS: Record<string, string> = {
  new:                    'New enquiry',
  sales_review:           'Sales review',
  site_details_pending:   'Site details pending',
  site_visit_scheduled:   'Site visit scheduled',
  site_visit_done:        'Site visit done',
  technical_review:       'Technical review',
  drafted:                'Draft',
  more_info_requested:    'More info requested',
  owner_approval_pending: 'Waiting for CEO approval',
  approved:               'Approved — ready to share',
  sent_to_customer:       'With customer',
  customer_accepted:      'Accepted by customer',
  advance_pending:        'Advance pending',
  project_created:        'Job card created',
  rejected:               'Rejected',
  cancelled:              'Lost / cancelled',
}

export const STATUS_COLORS: Record<string, string> = {
  new:                    'bg-amber-100 text-amber-700',
  sales_review:           'bg-blue-100 text-blue-700',
  site_details_pending:   'bg-blue-100 text-blue-700',
  site_visit_scheduled:   'bg-indigo-100 text-indigo-700',
  site_visit_done:        'bg-indigo-100 text-indigo-700',
  technical_review:       'bg-blue-100 text-blue-700',
  drafted:                'bg-slate-100 text-slate-700',
  more_info_requested:    'bg-orange-100 text-orange-700',
  owner_approval_pending: 'bg-purple-100 text-purple-700',
  approved:               'bg-green-100 text-green-700',
  sent_to_customer:       'bg-green-100 text-green-700',
  customer_accepted:      'bg-emerald-100 text-emerald-800',
  advance_pending:        'bg-emerald-100 text-emerald-800',
  project_created:        'bg-emerald-600 text-white',
  rejected:               'bg-red-100 text-red-700',
  cancelled:              'bg-red-100 text-red-700',
}

export const EDITABLE = ['new', 'sales_review', 'site_details_pending', 'site_visit_scheduled', 'site_visit_done',
  'technical_review', 'drafted', 'more_info_requested']
export const WITH_CUSTOMER = ['sent_to_customer', 'customer_accepted', 'advance_pending']

export const isEditable = (status: string) => EDITABLE.includes(status)
// Still being worked on: hot / cold and follow-ups apply
export const CLOSED = ['project_created', 'cancelled', 'rejected']
export const isOpen = (status: string) => !CLOSED.includes(status)
export const isManager = (role?: string | null) => role === 'admin' || role === 'task_manager'

// Before the visit: the site-visit person can schedule and record it
export const PRE_VISIT = ['new', 'sales_review', 'site_details_pending', 'site_visit_scheduled']

// The three jobs the CEO / admin manager hands out on each enquiry
export const JOBS = [
  { key: 'assigned_engineer_id', label: 'Site visit & customer meeting', short: 'Site visit' },
  { key: 'assigned_sales_id',    label: 'Prepares the quotation',        short: 'Quotation' },
  { key: 'follow_up_manager_id', label: 'Follows up with the customer',  short: 'Follow-up' },
] as const

// The steps shown on every quotation
export const FLOW = [
  { key: 'visit',   label: 'Site visit' },
  { key: 'prepare', label: 'Quotation' },
  { key: 'ceo',     label: 'CEO approval' },
  { key: 'share',   label: 'Shared with customer' },
  { key: 'follow',  label: 'Follow-up · hot / cold' },
  { key: 'accept',  label: 'Customer accepts' },
  { key: 'job',     label: 'Numbered job card' },
  { key: 'track',   label: 'Milestones' },
] as const

export function flowStep(status: string): number {
  if (PRE_VISIT.includes(status)) return 0
  if (isEditable(status)) return 1
  return ({ owner_approval_pending: 2, approved: 3, sent_to_customer: 4, customer_accepted: 5, advance_pending: 5,
            project_created: 6, rejected: 2, cancelled: 4 } as Record<string, number>)[status] ?? 0
}

export interface QuoteForRules {
  status: string
  assigned_sales_id: string | null
  assigned_engineer_id?: string | null
  follow_up_manager_id?: string | null
  lead_temperature?: string | null
  project_id?: string | null
}

// Which actions to offer this person at this stage (the database checks the same)
// quotationAccess: "Quotations: edit & delete" given by the CEO in User Management
export function availableActions(q: QuoteForRules, role: Role, uid: string, quotationAccess = false) {
  const boss     = isManager(role) || quotationAccess
  const preparer = boss || q.assigned_sales_id === uid
  const visitor  = q.assigned_engineer_id === uid
  const staffOk  = preparer || q.follow_up_manager_id === uid   // preparer or follow-up person
  const s = q.status
  return {
    edit:            preparer && isEditable(s),
    submit:          preparer && isEditable(s),
    visit:           (preparer || visitor) && PRE_VISIT.includes(s),
    schedule:        boss && PRE_VISIT.includes(s),
    approve:         role === 'admin' && s === 'owner_approval_pending',
    sendBack:        role === 'admin' && s === 'owner_approval_pending',
    reject:          role === 'admin' && s === 'owner_approval_pending',
    share:           staffOk && (s === 'approved' || s === 'sent_to_customer'),
    temperature:     (staffOk || visitor) && isOpen(s),
    followUp:        (staffOk || visitor) && s !== 'project_created',
    accept:          staffOk && s === 'sent_to_customer',
    lose:            (staffOk && WITH_CUSTOMER.includes(s)) || (isManager(role) && isEditable(s)),   // early: no response, not interested
    revise:          preparer && ['approved', ...WITH_CUSTOMER].includes(s),
    reopen:          isManager(role) && ['cancelled', 'rejected'].includes(s),
    convert:         isManager(role) && ['customer_accepted', 'advance_pending'].includes(s) && !q.project_id,
    reassign:        isManager(role) && s !== 'project_created',
    // Wrong or duplicate quotations; never once a job card exists (the database refuses too)
    remove:          (role === 'admin' || quotationAccess) && s !== 'project_created' && !q.project_id,
    // The CEO can save a draft and approve it in one step
    saveApprove:     role === 'admin' && isEditable(s),
  }
}

export function convertBlocker(q: QuoteForRules): string {
  if (!['customer_accepted', 'advance_pending'].includes(q.status)) return 'The customer must accept the quotation first.'
  if (q.lead_temperature !== 'hot') return 'Mark the quotation HOT before creating the job card.'
  return ''
}

// ─── Pricing & subsidy ──────────────────────────────────────────

// GST on solar systems from 22 Sep 2025: 70% supply at 5% + 30% service at 18% = 8.9% overall
export const GST_RATE = 0.089
export const GST_NOTE = 'GST 8.9% (70% supply at 5% + 30% installation at 18%)'

export type Region = 'puducherry' | 'tamilnadu'
export const REGION_LABELS: Record<Region, string> = { puducherry: 'Puducherry', tamilnadu: 'Tamil Nadu' }

// Checked 20 Nov 2026.
// Central PM Surya Ghar: ₹30,000/kW for the first 2 kW + ₹18,000 for the 3rd kW, max ₹78,000.
// Puducherry Government: ₹10,000/kW up to 3 kW (max ₹30,000), first 13,000 PM Surya Ghar beneficiaries.
// Tamil Nadu Government: ₹5,000 (1 kW), ₹10,000 (2 kW), ₹22,000 (3 kW+), paid by TEDA after the central subsidy.
export const SUBSIDY_CHECKED = '20 November 2026'
export function residentialSubsidy(region: Region | string | null | undefined, kw: number) {
  if (!Number.isFinite(kw) || kw <= 0 || kw > 10) return { central: 0, state: 0, total: 0, stateName: '' }
  const central = Math.round(Math.min(kw, 2) * 30000 + Math.max(0, Math.min(kw, 3) - 2) * 18000)
  let state = 0, stateName = ''
  if (region === 'puducherry') { state = Math.round(Math.min(kw, 3) * 10000); stateName = 'Puducherry state subsidy' }
  if (region === 'tamilnadu')  { state = Math.round(Math.min(kw, 2) * 5000 + Math.max(0, Math.min(kw, 3) - 2) * 12000); stateName = 'Tamil Nadu state subsidy' }
  return { central, state, total: central + state, stateName }
}

export function subsidyEligible(consumerType?: string | null, solarType?: string | null, panelType?: string | null) {
  return consumerType === 'domestic' && (solarType === 'ongrid' || solarType === 'not_sure' || !solarType) && ['DCR', 'Mixed'].includes(panelType ?? 'DCR')
}

// GST-inclusive figures → the ₹/kW before GST that the quotation stores
export type PriceMode = 'per_kw' | 'per_kw_incl' | 'total_incl'
export const PRICE_MODES: [PriceMode, string][] = [['per_kw', '₹ per kW, before GST'], ['per_kw_incl', '₹ per kW, including GST'], ['total_incl', 'Total payable, including GST']]
export function perKwFromEntry(mode: PriceMode, value: number, kw: number, extras = 0, discount = 0) {
  if (!(value > 0) || !(kw > 0)) return 0
  if (mode === 'per_kw') return value
  if (mode === 'per_kw_incl') return Math.round(value / (1 + GST_RATE) * 100) / 100
  return Math.round(((value / (1 + GST_RATE)) - extras + discount) / kw * 100) / 100
}
// A ₹/kW far outside the normal range is usually a total typed into the per-kW box
export function perKwWarning(ppk: number, kw: number) {
  if (!(ppk > 0)) return ''
  if (ppk > 150000) return `₹${Math.round(ppk).toLocaleString('en-IN')} per kW × ${kw} kW is ₹${Math.round(ppk * kw).toLocaleString('en-IN')} before GST. If you typed the total, choose “Total payable, including GST”.`
  if (ppk < 20000) return `₹${Math.round(ppk).toLocaleString('en-IN')} per kW is very low. Check the figure and the way it is entered.`
  return ''
}

// Price build-up: kW × ₹/kW (before GST) + extras − discount, then GST
// The price can be given as ₹/kW before GST (pricePerKw), or EXACTLY as typed including GST
// (entryMode 'per_kw_incl' or 'total_incl' with entryValue): then the total is that figure and the
// before-GST amount and GST are worked backwards from it, so the customer pays what was entered.
export function buildPrice(input: { kw: number; pricePerKw: number; extras?: number; discount?: number;
  region?: string | null; consumerType?: string | null; solarType?: string | null; panelType?: string | null; dcrKw?: number | null
  entryMode?: string | null; entryValue?: number | null }) {
  const extras = input.extras ?? 0, discount = input.discount ?? 0
  const v = Number(input.entryValue)
  let system: number, gst: number, total: number, pricePerKw = input.pricePerKw
  if ((input.entryMode === 'total_incl' || input.entryMode === 'per_kw_incl') && v > 0 && input.kw > 0) {
    total = input.entryMode === 'total_incl' ? Math.round(v) : Math.round(v * input.kw + (extras - discount) * (1 + GST_RATE))
    system = Math.round(total / (1 + GST_RATE))
    gst = total - system
    pricePerKw = Math.round((system - extras + discount) / input.kw * 100) / 100
  } else {
    system = Math.round(input.kw * input.pricePerKw + extras - discount)
    gst = Math.round(system * GST_RATE)
    total = system + gst
  }
  // Mixed panels: the subsidy is worked out on the DCR part only (the whole system must still be a home system up to 10 kW)
  const subsidyKw = input.panelType === 'Mixed' ? Math.min(Number(input.dcrKw) || 0, input.kw) : input.kw
  const aid = subsidyEligible(input.consumerType, input.solarType, input.panelType) && input.kw <= 10 && subsidyKw > 0
    ? residentialSubsidy(input.region, subsidyKw) : { central: 0, state: 0, total: 0, stateName: '' }
  return { system, gst, total, pricePerKw, central: aid.central, state: aid.state, stateName: aid.stateName, subsidy: aid.total, net: total - aid.total }
}

// ─── Follow-ups & sharing ───────────────────────────────────────

export const FOLLOW_UP_DAYS = [1, 3, 7, 14, 30]
export function suggestNextFollowUp(sentAt: string | null, done: number): string {
  const d = sentAt ? new Date(sentAt) : new Date()
  d.setDate(d.getDate() + FOLLOW_UP_DAYS[Math.min(done, FOLLOW_UP_DAYS.length - 1)])
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const x = d < tomorrow ? tomorrow : d   // never suggest a date in the past
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function followUpState(nextDate: string | null | undefined, status: string): '' | 'overdue' | 'today' | 'later' {
  if (!nextDate || !isOpen(status)) return ''
  const t = todayIso()
  return nextDate < t ? 'overdue' : nextDate === t ? 'today' : 'later'
}

// Suggested next contact after marking a lead: hot = tomorrow, cold = in a week
export const TEMP_NEXT_DAYS: Record<string, number> = { hot: 1, cold: 7 }
export function daysFromToday(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function whatsappLink(phone: string | null | undefined, text: string) {
  let p = String(phone ?? '').replace(/\D/g, '')
  if (p.length === 10) p = '91' + p
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export const inr = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN'))

// ─── Milestones ─────────────────────────────────────────────────

export const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Not started', in_progress: 'In progress', completed: 'Done', blocked: 'Blocked', skipped: 'Not applicable',
}

export function milestoneProgress(stages: { status: string; planned_date: string | null }[]) {
  const live = stages.filter(s => s.status !== 'skipped')
  const done = live.filter(s => s.status === 'completed').length
  const t = todayIso()
  const overdue = live.filter(s => s.status !== 'completed' && s.planned_date && s.planned_date < t).length
  return { done, total: live.length, pct: live.length ? Math.round(done / live.length * 100) : 0, overdue }
}

// Milestone stages (same codes and order as project_stage_template() in the database),
// used to say how far an ongoing project has already got
export const STAGES: { code: string; name: string; phase: string; subsidy?: boolean }[] = [
  { code: 'order_confirmed',      name: 'Order confirmed, advance received',              phase: 'Order & approvals' },
  { code: 'site_survey',          name: 'Detailed site survey & shadow analysis',         phase: 'Order & approvals' },
  { code: 'design',               name: 'Engineering design & BOM frozen',                phase: 'Order & approvals' },
  { code: 'pmsg_application',     name: 'PM Surya Ghar application',                      phase: 'Order & approvals', subsidy: true },
  { code: 'discom_application',   name: 'DISCOM feasibility / metering application',      phase: 'Order & approvals' },
  { code: 'material_procurement', name: 'Materials ordered',                              phase: 'Procurement & installation' },
  { code: 'material_delivery',    name: 'Materials delivered at site',                    phase: 'Procurement & installation' },
  { code: 'structure_work',       name: 'Mounting structure erected',                     phase: 'Procurement & installation' },
  { code: 'panel_installation',   name: 'Panels installed',                               phase: 'Procurement & installation' },
  { code: 'inverter_electrical',  name: 'Inverter, cabling, earthing & LA',               phase: 'Procurement & installation' },
  { code: 'testing',              name: 'Pre-commissioning tests',                        phase: 'Procurement & installation' },
  { code: 'discom_inspection',    name: 'Work completion report & DISCOM inspection',     phase: 'Grid connection' },
  { code: 'net_meter_sync',       name: 'Net meter installed & grid synchronised',        phase: 'Grid connection' },
  { code: 'commissioning',        name: 'Commissioning certificate issued',               phase: 'Grid connection' },
  { code: 'subsidy_claim',        name: 'Subsidy claim submitted',                        phase: 'Subsidy', subsidy: true },
  { code: 'central_subsidy',      name: 'Central subsidy credited',                       phase: 'Subsidy', subsidy: true },
  { code: 'state_subsidy',        name: 'State subsidy claimed & credited',               phase: 'Subsidy', subsidy: true },
  { code: 'final_payment',        name: 'Final payment received',                         phase: 'Handover' },
  { code: 'handover',             name: 'Handover to customer',                           phase: 'Handover' },
  { code: 'warranty_registration', name: 'Warranties registered',                         phase: 'Handover' },
  { code: 'first_service',        name: 'First maintenance visit',                        phase: 'Service life' },
  { code: 'maintenance_contract', name: 'Maintenance contract running',                   phase: 'Service life' },
  { code: 'end_of_life',          name: 'Decommissioning / recycling',                    phase: 'End of life' },
]
