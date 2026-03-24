import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { Briefcase, MapPin, Calendar } from 'lucide-react'

interface ProjectItem {
  id: string; project_number: string; name: string; customer_name: string | null
  site_address: string | null; project_type: string | null; capacity_kwp: number | null
  start_date: string | null; expected_completion: string | null; status: string
  role_in_project: string | null; assigned_date: string
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

export default async function MyProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: myProjects } = await supabase
    .from('project_employees')
    .select('role_in_project,assigned_date,projects(id,project_number,name,customer_name,site_address,project_type,capacity_kwp,start_date,expected_completion,status)')
    .eq('employee_id', user?.id ?? '')
    .order('assigned_date', { ascending: false })

  type ProjRow = { role_in_project: string | null; assigned_date: string; projects: Omit<ProjectItem,'role_in_project'|'assigned_date'> | null }
  const projects = ((myProjects ?? []) as unknown as ProjRow[]).map(r => ({ ...r.projects, role_in_project: r.role_in_project, assigned_date: r.assigned_date })) as ProjectItem[]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="My Projects" subtitle="Projects you are currently assigned to" />
      <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full">
        {projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-16 text-center">
            <Briefcase size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">You are not assigned to any projects yet.</p>
            <p className="text-slate-300 text-xs mt-1">Ask your manager to assign you to a project.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map(proj => (
              <div key={proj.id} className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs text-slate-400 font-mono">{proj.project_number}</p>
                    <h4 className="font-bold text-slate-900 text-sm mt-0.5">{proj.name}</h4>
                    {proj.role_in_project && (
                      <p className="text-xs text-green-600 mt-0.5">🔧 {proj.role_in_project}</p>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[proj.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {(proj.status).replace('_',' ')}
                  </span>
                </div>
                {proj.customer_name && <p className="text-xs text-slate-600 mb-1">👤 {proj.customer_name}</p>}
                {proj.site_address && (
                  <p className="text-xs text-slate-500 flex items-start gap-1 mb-2">
                    <MapPin size={10} className="shrink-0 mt-0.5" /> {proj.site_address}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-500">
                  {proj.capacity_kwp && <span>⚡ {proj.capacity_kwp} kWp</span>}
                  {proj.project_type && <span className="capitalize">{proj.project_type!.replace('_',' ')}</span>}
                </div>
                {(proj.start_date || proj.expected_completion) && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
                    <Calendar size={10} />
                    {proj.start_date && format(new Date(proj.start_date!), 'dd MMM yy')}
                    {proj.expected_completion && ` → ${format(new Date(proj.expected_completion!), 'dd MMM yy')}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
