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
export const isManager = (role?: string | null) => role === 'admin' || role === 'task_manager'

// The seven steps shown on every quotation
export const FLOW = [
  { key: 'prepare', label: 'Quotation' },
  { key: 'ceo',     label: 'CEO approval' },
  { key: 'share',   label: 'Customer + admin manager' },
  { key: 'follow',  label: 'Follow-up · hot / cold' },
  { key: 'accept',  label: 'Customer accepts' },
  { key: 'job',     label: 'Numbered job card' },
  { key: 'track',   label: 'Milestones' },
] as const

export function flowStep(status: string): number {
  if (isEditable(status)) return 0
  return ({ owner_approval_pending: 1, approved: 2, sent_to_customer: 3, customer_accepted: 4, advance_pending: 4,
            project_created: 5, rejected: 1, cancelled: 3 } as Record<string, number>)[status] ?? 0
}

export interface QuoteForRules {
  status: string
  assigned_sales_id: string | null
  follow_up_manager_id?: string | null
  lead_temperature?: string | null
  project_id?: string | null
}

// Which actions to offer this person at this stage
// quotationAccess: "Quotations: edit & delete" given by the CEO in User Management
export function availableActions(q: QuoteForRules, role: Role, uid: string, quotationAccess = false) {
  const own = q.assigned_sales_id === uid || q.follow_up_manager_id === uid
  const staffOk = isManager(role) || own || quotationAccess
  const s = q.status
  return {
    edit:            staffOk && isEditable(s),
    submit:          staffOk && isEditable(s),
    approve:         role === 'admin' && s === 'owner_approval_pending',
    sendBack:        role === 'admin' && s === 'owner_approval_pending',
    reject:          role === 'admin' && s === 'owner_approval_pending',
    share:           staffOk && (s === 'approved' || s === 'sent_to_customer'),
    temperature:     staffOk && WITH_CUSTOMER.includes(s),
    followUp:        staffOk && s !== 'project_created',
    accept:          staffOk && s === 'sent_to_customer',
    lose:            staffOk && WITH_CUSTOMER.includes(s),
    revise:          staffOk && ['approved', ...WITH_CUSTOMER].includes(s),
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
  return consumerType === 'domestic' && (solarType === 'ongrid' || solarType === 'not_sure' || !solarType) && (panelType ?? 'DCR') === 'DCR'
}

// Price build-up: kW × ₹/kW (before GST) + extras − discount, then GST
export function buildPrice(input: { kw: number; pricePerKw: number; extras?: number; discount?: number;
  region?: string | null; consumerType?: string | null; solarType?: string | null; panelType?: string | null }) {
  const system = Math.round(input.kw * input.pricePerKw + (input.extras ?? 0) - (input.discount ?? 0))
  const gst = Math.round(system * GST_RATE)
  const total = system + gst
  const aid = subsidyEligible(input.consumerType, input.solarType, input.panelType)
    ? residentialSubsidy(input.region, input.kw) : { central: 0, state: 0, total: 0, stateName: '' }
  return { system, gst, total, central: aid.central, state: aid.state, stateName: aid.stateName, subsidy: aid.total, net: total - aid.total }
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
  if (!nextDate || !WITH_CUSTOMER.includes(status)) return ''
  const t = todayIso()
  return nextDate < t ? 'overdue' : nextDate === t ? 'today' : 'later'
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
