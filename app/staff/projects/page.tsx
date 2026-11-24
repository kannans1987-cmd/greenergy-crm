import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { Briefcase, MapPin } from 'lucide-react'
import { milestoneProgress } from '@/lib/workflow'

interface ProjectItem {
  id: string; project_number: string; job_number: string | null; name: string; customer_name: string | null
  site_address: string | null; capacity_kwp: number | null; status: string; admin_officer_id: string | null
  target_commissioning: string | null; officer: { full_name: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Row-level security returns the projects this person may see: managers all;
  // others where they are the appointed officer, on the team, or made the sale.
  const { data } = await supabase
    .from('projects')
    .select('id, project_number, job_number, name, customer_name, site_address, capacity_kwp, status, admin_officer_id, target_commissioning, officer:admin_officer_id ( full_name )')
    .order('created_at', { ascending: false })
    .limit(300)
  const projects = (data ?? []) as unknown as ProjectItem[]

  const ids = projects.map(p => p.id)
  type StageRow = { project_id: string; status: string; planned_date: string | null; stage_name: string; sort_order: number }
  const { data: stages } = ids.length
    ? await supabase.from('project_stage_history').select('project_id, status, planned_date, stage_name, sort_order').in('project_id', ids)
    : { data: [] as StageRow[] }
  const byProject = new Map<string, StageRow[]>()
  for (const s of (stages ?? []) as StageRow[]) byProject.set(s.project_id, [...(byProject.get(s.project_id) ?? []), s])

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Projects & milestones" subtitle="Numbered job cards from accepted, hot quotations — tracked from order to end of life" />
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
        {projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-16 text-center">
            <Briefcase size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">No projects for you yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map(proj => {
              const st = (byProject.get(proj.id) ?? []).sort((a, b) => a.sort_order - b.sort_order)
              const prog = milestoneProgress(st)
              const next = st.find(s => !['completed', 'skipped'].includes(s.status))
              return (
                <Link key={proj.id} href={`/staff/projects/${proj.id}`} className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition p-5 block">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-xs text-slate-400 font-mono">{proj.job_number ?? proj.project_number}</p>
                      <h4 className="font-bold text-slate-900 text-sm mt-0.5">{proj.customer_name ?? proj.name}</h4>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[proj.status] ?? 'bg-slate-100 text-slate-600'}`}>{proj.status.replace('_', ' ')}</span>
                  </div>
                  {proj.site_address && <p className="text-xs text-slate-500 flex items-start gap-1 mb-2"><MapPin size={10} className="shrink-0 mt-0.5" /> {proj.site_address}</p>}
                  <p className="text-xs text-slate-600">{proj.capacity_kwp ? `⚡ ${proj.capacity_kwp} kW · ` : ''}Officer: {proj.officer?.full_name ?? <span className="text-amber-600">not appointed</span>}
                    {proj.admin_officer_id === user?.id ? ' (you)' : ''}</p>
                  {st.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2"><div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-green-600" style={{ width: `${prog.pct}%` }} /></div>
                        <span className="text-xs text-slate-500">{prog.done}/{prog.total}</span></div>
                      <p className="text-xs text-slate-500 mt-1">Next: {next?.stage_name ?? 'All done'}{prog.overdue ? <span className="text-red-600 font-semibold"> · {prog.overdue} overdue</span> : null}</p>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
