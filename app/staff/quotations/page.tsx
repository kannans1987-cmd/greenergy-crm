import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { Plus, Phone, LayoutGrid } from 'lucide-react'
import HotColdPicker from '@/components/staff/HotColdPicker'
import { STATUS_LABELS, STATUS_COLORS, WITH_CUSTOMER, followUpState, inr, todayIso, EDITABLE, PRE_VISIT, isOpen } from '@/lib/workflow'

interface Row {
  id: string; quotation_number: string; customer_name: string; mobile: string; city: string | null
  status: string; lead_temperature: string | null; next_follow_up_date: string | null; job_number: string | null
  admin_capacity_kw: number | null; recommended_capacity_kw: number | null; admin_total_cost: number | null; total_cost_before_subsidy: number | null
  created_at: string; updated_at: string; assigned_sales: { full_name: string } | null; follow_up_manager: { full_name: string } | null
  assigned_engineer: { full_name: string } | null
  assigned_sales_id: string | null; assigned_engineer_id: string | null; follow_up_manager_id: string | null
  site_visit_at: string | null; site_visit_done_at: string | null
  lead_temperature_at?: string | null; lead_temperature_note?: string | null
  source: string | null
}

const SOURCE_TAG: Record<string, string> = { website: '🌐 Website', phone: '📞 Phone', walk_in: '🚶 Walk-in', referral: '🤝 Referral', social_media: '💬 WhatsApp', other: '' }

// Hot first, then cold, then not set
const HEAT: Record<string, number> = { hot: 0, cold: 2 }
const heat = (r: Row) => HEAT[r.lead_temperature ?? ''] ?? 1

const first = (p: { full_name: string } | null) => p?.full_name.split(' ')[0] ?? '—'

// What this person has to do on this quotation now
function myTask(r: Row, uid: string): string {
  if (r.assigned_engineer_id === uid && PRE_VISIT.includes(r.status)) return r.site_visit_at ? 'Site visit ' + new Date(r.site_visit_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Site visit'
  if (r.assigned_sales_id === uid && EDITABLE.includes(r.status)) return r.status === 'more_info_requested' ? 'Add the information asked' : 'Prepare quotation'
  if (r.follow_up_manager_id === uid && (r.status === 'approved' || WITH_CUSTOMER.includes(r.status))) return r.status === 'approved' ? 'Share with customer' : 'Follow up'
  if (r.assigned_sales_id === uid && r.status === 'approved') return 'Share with customer'
  return ''
}

const TABS = [
  { key: 'mine',      label: 'My work' },
  { key: 'unassigned', label: 'Not allocated' },
  { key: 'followups', label: 'Follow-ups due' },
  { key: 'approvals', label: 'Waiting for CEO' },
  { key: 'drafts',    label: 'Drafts & enquiries' },
  { key: 'hot',       label: '🔥 Hot' },
  { key: 'cold',      label: '❄ Cold' },
  { key: 'accepted',  label: 'Accepted — ready for job card' },
  { key: 'all',       label: 'All' },
]

export default async function QuotationsPage({ searchParams }: { searchParams: { view?: string; q?: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('*').eq('id', user?.id ?? '').single()

  // Row-level security limits staff to their own quotations; managers see all
  const COLS = `id, quotation_number, customer_name, mobile, city, source, status, lead_temperature, next_follow_up_date, job_number,
             admin_capacity_kw, recommended_capacity_kw, admin_total_cost, total_cost_before_subsidy, created_at, updated_at,
             assigned_sales_id, assigned_engineer_id, follow_up_manager_id, site_visit_at, site_visit_done_at, lead_temperature_at, lead_temperature_note,
             assigned_sales:assigned_sales_id ( full_name ), follow_up_manager:follow_up_manager_id ( full_name ),
             assigned_engineer:assigned_engineer_id ( full_name )`
  const run =(c: string) => supabase.from('quotation_requests').select(c).order('updated_at', { ascending: false }).limit(500)
  let { data, error } = await run(COLS)
  // Until supabase/quotation_allocation_v1.sql has been run, the site-visit columns do not exist yet
  if (error) ({ data, error } = await run(COLS.replace(' site_visit_at, site_visit_done_at, lead_temperature_at, lead_temperature_note,', '')))
  const all = (data ?? []) as unknown as Row[]

  const t = todayIso()
  const uid = user?.id ?? ''
  const isMgr = me?.role === 'admin' || me?.role === 'task_manager'
  // Sr / Jr Admin Managers allocate the work (allocation_levels_v1.sql)
  const allocator = isMgr || !!(me as { allocation_level?: string | null } | null)?.allocation_level
  const lists: Record<string, Row[]> = {
    mine:       all.filter(r => myTask(r, uid)),
    unassigned: all.filter(r => !['project_created', 'cancelled', 'rejected'].includes(r.status) && (!r.assigned_sales_id || !r.follow_up_manager_id)),
    // Every open lead with a follow-up date today or earlier, hot ones first
    followups: all.filter(r => isOpen(r.status) && r.next_follow_up_date && r.next_follow_up_date <= t)
                  .sort((a, b) => heat(a) - heat(b) || String(a.next_follow_up_date).localeCompare(String(b.next_follow_up_date))),
    approvals: all.filter(r => r.status === 'owner_approval_pending'),
    drafts:    all.filter(r => EDITABLE.includes(r.status)),
    hot:       all.filter(r => r.lead_temperature === 'hot' && isOpen(r.status)),
    cold:      all.filter(r => r.lead_temperature === 'cold' && isOpen(r.status)),
    accepted:  all.filter(r => ['customer_accepted', 'advance_pending'].includes(r.status)),
    all,
  }
  const view = TABS.some(x => x.key === searchParams.view) ? searchParams.view!
    : me?.role === 'admin' && lists.approvals.length ? 'approvals'
    : allocator && lists.unassigned.length ? 'unassigned'
    : lists.mine.length ? 'mine' : 'followups'
  const term = (searchParams.q ?? '').trim().toLowerCase()
  const delegate = !!(me as { quotation_access?: boolean } | null)?.quotation_access
  const viewer = !!(me as { quotation_view?: boolean } | null)?.quotation_view
  const canHeat = (r: Row) => isOpen(r.status) && (isMgr || delegate || [r.assigned_sales_id, r.assigned_engineer_id, r.follow_up_manager_id].includes(uid))
  const rows = lists[view].filter(r => !term || [r.quotation_number, r.customer_name, r.mobile, r.city, r.job_number]
    .some(x => String(x ?? '').toLowerCase().includes(term)))

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Quotations" subtitle="Enquiry → site visit → quotation → CEO approval → customer → follow-up (hot / cold) → accepted → job card" />
      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex-1 min-w-[200px]" action="/staff/quotations">
            <input type="hidden" name="view" value={view} />
            <input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search name, mobile, number, town…" aria-label="Search quotations"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
          </form>
          <Link href="/staff/quotations/board" className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50">
            <LayoutGrid size={15} /> Pipeline board
          </Link>
          {(isMgr || delegate || viewer || allocator) && (
            <Link href="/staff/quotations/enquiry" className="flex items-center gap-1.5 px-4 py-2 bg-white border border-green-600 text-green-700 text-sm font-semibold rounded-lg hover:bg-green-50">
              <Phone size={15} /> Log phone enquiry
            </Link>
          )}
          <Link href="/staff/quotations/new" className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">
            <Plus size={15} /> New quotation
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto bg-white border border-slate-100 rounded-xl p-1" aria-label="Quotation views">
          {TABS.filter(x => x.key === 'unassigned' ? allocator : x.key !== 'approvals' || isMgr).map(tab => (
            <Link key={tab.key} href={`/staff/quotations?view=${tab.key}`}
              className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${view === tab.key ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {tab.label} <span className={`ml-1 ${view === tab.key ? 'text-green-100' : 'text-slate-400'}`}>{lists[tab.key].length}</span>
            </Link>
          ))}
        </nav>

        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
          {rows.length === 0 ? <p className="text-center py-16 text-slate-400 text-sm">Nothing here.</p> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                <tr>{['Quotation', 'Customer', 'kW', 'Total', 'Stage', ...(view === 'mine' ? ['Your job'] : []), 'Hot / cold', 'Visit · Quote · Follow-up', 'Next follow-up'].map(h => <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(r => {
                  const f = followUpState(r.next_follow_up_date, r.status)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><Link href={`/staff/quotations/${r.id}`} className="font-mono text-xs font-semibold text-green-700 hover:underline">{r.job_number ?? r.quotation_number}</Link></td>
                      <td className="px-4 py-3"><p className="font-medium text-slate-800">{r.customer_name}</p><p className="text-xs text-slate-400">{r.mobile}{r.city ? ` · ${r.city}` : ''}{r.source && SOURCE_TAG[r.source] ? <span className="ml-1.5 text-slate-500">{SOURCE_TAG[r.source]}</span> : null}</p></td>
                      <td className="px-4 py-3">{r.admin_capacity_kw ?? r.recommended_capacity_kw ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{inr(r.admin_total_cost ?? r.total_cost_before_subsidy)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_COLORS[r.status] ?? 'bg-slate-100'}`}>{STATUS_LABELS[r.status] ?? r.status}</span></td>
                      {view === 'mine' && <td className="px-4 py-3 text-xs font-semibold text-indigo-700 whitespace-nowrap">{myTask(r, uid)}</td>}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <HotColdPicker id={r.id} value={r.lead_temperature} note={r.lead_temperature_note} since={r.lead_temperature_at} canSet={canHeat(r)} compact />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{first(r.assigned_engineer)}{r.site_visit_done_at ? ' ✓' : ''} · {first(r.assigned_sales)} · {first(r.follow_up_manager)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{f ? <span className={f === 'overdue' ? 'text-red-600 font-semibold' : f === 'today' ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                        {new Date(r.next_follow_up_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{f === 'overdue' ? ' · overdue' : f === 'today' ? ' · today' : ''}</span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
