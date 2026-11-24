import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { STATUS_LABELS, STATUS_COLORS, WITH_CUSTOMER, followUpState, inr, todayIso, EDITABLE } from '@/lib/workflow'

interface Row {
  id: string; quotation_number: string; customer_name: string; mobile: string; city: string | null
  status: string; lead_temperature: string | null; next_follow_up_date: string | null; job_number: string | null
  admin_capacity_kw: number | null; recommended_capacity_kw: number | null; admin_total_cost: number | null; total_cost_before_subsidy: number | null
  created_at: string; updated_at: string; assigned_sales: { full_name: string } | null; follow_up_manager: { full_name: string } | null
}

const TABS = [
  { key: 'followups', label: 'Follow-ups due' },
  { key: 'approvals', label: 'Waiting for CEO' },
  { key: 'drafts',    label: 'Drafts & enquiries' },
  { key: 'hot',       label: 'Hot' },
  { key: 'cold',      label: 'Cold' },
  { key: 'accepted',  label: 'Accepted — ready for job card' },
  { key: 'all',       label: 'All' },
]

export default async function QuotationsPage({ searchParams }: { searchParams: { view?: string; q?: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').single()

  // Row-level security limits staff to their own quotations; managers see all
  const { data } = await supabase
    .from('quotation_requests')
    .select(`id, quotation_number, customer_name, mobile, city, status, lead_temperature, next_follow_up_date, job_number,
             admin_capacity_kw, recommended_capacity_kw, admin_total_cost, total_cost_before_subsidy, created_at, updated_at,
             assigned_sales:assigned_sales_id ( full_name ), follow_up_manager:follow_up_manager_id ( full_name )`)
    .order('updated_at', { ascending: false })
    .limit(500)
  const all = (data ?? []) as unknown as Row[]

  const t = todayIso()
  const lists: Record<string, Row[]> = {
    followups: all.filter(r => WITH_CUSTOMER.includes(r.status) && r.next_follow_up_date && r.next_follow_up_date <= t)
                  .sort((a, b) => String(a.next_follow_up_date).localeCompare(String(b.next_follow_up_date))),
    approvals: all.filter(r => r.status === 'owner_approval_pending'),
    drafts:    all.filter(r => EDITABLE.includes(r.status)),
    hot:       all.filter(r => r.lead_temperature === 'hot' && WITH_CUSTOMER.includes(r.status)),
    cold:      all.filter(r => r.lead_temperature === 'cold' && WITH_CUSTOMER.includes(r.status)),
    accepted:  all.filter(r => ['customer_accepted', 'advance_pending'].includes(r.status)),
    all,
  }
  const view = TABS.some(x => x.key === searchParams.view) ? searchParams.view! : (me?.role === 'admin' && lists.approvals.length ? 'approvals' : 'followups')
  const term = (searchParams.q ?? '').trim().toLowerCase()
  const rows = lists[view].filter(r => !term || [r.quotation_number, r.customer_name, r.mobile, r.city, r.job_number]
    .some(x => String(x ?? '').toLowerCase().includes(term)))

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Quotations" subtitle="Quotation → CEO approval → customer & admin manager → hot / cold → accepted → numbered job card" />
      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex-1 min-w-[200px]" action="/staff/quotations">
            <input type="hidden" name="view" value={view} />
            <input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search name, mobile, number, town…" aria-label="Search quotations"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
          </form>
          <Link href="/staff/quotations/new" className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">
            <Plus size={15} /> New quotation
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto bg-white border border-slate-100 rounded-xl p-1" aria-label="Quotation views">
          {TABS.filter(x => x.key !== 'approvals' || me?.role !== 'employee').map(tab => (
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
                <tr>{['Quotation', 'Customer', 'kW', 'Total', 'Stage', 'Hot / cold', 'Sales', 'Next follow-up'].map(h => <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(r => {
                  const f = followUpState(r.next_follow_up_date, r.status)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><Link href={`/staff/quotations/${r.id}`} className="font-mono text-xs font-semibold text-green-700 hover:underline">{r.job_number ?? r.quotation_number}</Link></td>
                      <td className="px-4 py-3"><p className="font-medium text-slate-800">{r.customer_name}</p><p className="text-xs text-slate-400">{r.mobile}{r.city ? ` · ${r.city}` : ''}</p></td>
                      <td className="px-4 py-3">{r.admin_capacity_kw ?? r.recommended_capacity_kw ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{inr(r.admin_total_cost ?? r.total_cost_before_subsidy)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_COLORS[r.status] ?? 'bg-slate-100'}`}>{STATUS_LABELS[r.status] ?? r.status}</span></td>
                      <td className="px-4 py-3">{r.lead_temperature ? <span className={`text-xs font-bold ${r.lead_temperature === 'hot' ? 'text-orange-600' : 'text-sky-600'}`}>{r.lead_temperature === 'hot' ? '🔥 Hot' : '❄ Cold'}</span> : '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.assigned_sales?.full_name ?? '—'}</td>
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
