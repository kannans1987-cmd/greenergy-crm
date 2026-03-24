import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { BarChart3, Clock, Users, CheckSquare, Briefcase, TrendingUp } from 'lucide-react'

interface AttendanceSummary {
  employee_id: string
  full_name: string
  designation: string | null
  total_days: number
  total_hours: number
  avg_hours_per_day: number
}

interface TaskSummary {
  employee_id: string
  full_name: string
  total: number
  completed: number
  pending: number
  in_progress: number
}

interface ProjectSummary {
  id: string
  name: string
  project_number: string
  status: string
  employee_count: number
  total_manhours: number
}

async function getReportData() {
  const supabase   = await createClient()
  const now        = new Date()
  const thisMonth  = { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') }
  const lastMonth  = {
    start: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'),
    end:   format(endOfMonth(subMonths(now, 1)),   'yyyy-MM-dd'),
  }

  const [
    { data: employees },
    { data: thisMonthAtt },
    { data: lastMonthAtt },
    { data: tasks },
    { data: projects },
    { data: jobCards },
  ] = await Promise.all([
    supabase.from('profiles').select('id,full_name,designation,role').eq('status','active').neq('role','admin'),
    supabase.from('attendance').select('employee_id,total_hours,date')
      .gte('date', thisMonth.start).lte('date', thisMonth.end).not('total_hours','is',null),
    supabase.from('attendance').select('employee_id,total_hours,date')
      .gte('date', lastMonth.start).lte('date', lastMonth.end).not('total_hours','is',null),
    supabase.from('tasks').select('assigned_to,status'),
    supabase.from('projects').select('id,name,project_number,status'),
    supabase.from('job_cards').select('project_id,employee_id,total_manhours,status'),
  ])

  type Emp = { id: string; full_name: string; designation: string | null }
  type AttRow = { employee_id: string; total_hours: number; date: string }
  type TaskRow = { assigned_to: string | null; status: string }
  type JcRow = { project_id: string; employee_id: string; total_manhours: number; status: string }
  type ProjRow = { id: string; name: string; project_number: string; status: string }

  // Attendance summaries
  const buildAttSummary = (attRows: AttRow[], emps: Emp[]): AttendanceSummary[] => {
    const map = new Map<string, { days: number; hours: number }>()
    for (const r of attRows) {
      const prev = map.get(r.employee_id) ?? { days: 0, hours: 0 }
      map.set(r.employee_id, { days: prev.days + 1, hours: prev.hours + r.total_hours })
    }
    return emps.map(e => {
      const s = map.get(e.id) ?? { days: 0, hours: 0 }
      return {
        employee_id:       e.id,
        full_name:         e.full_name,
        designation:       e.designation,
        total_days:        s.days,
        total_hours:       Math.round(s.hours * 10) / 10,
        avg_hours_per_day: s.days > 0 ? Math.round((s.hours / s.days) * 10) / 10 : 0,
      }
    }).sort((a, b) => b.total_hours - a.total_hours)
  }

  const thisMonthSummary = buildAttSummary(
    (thisMonthAtt ?? []) as AttRow[],
    (employees ?? []) as Emp[]
  )
  const lastMonthSummary = buildAttSummary(
    (lastMonthAtt ?? []) as AttRow[],
    (employees ?? []) as Emp[]
  )

  // Task summaries
  const taskSummary: TaskSummary[] = ((employees ?? []) as Emp[]).map(e => {
    const eTasks = ((tasks ?? []) as TaskRow[]).filter(t => t.assigned_to === e.id)
    return {
      employee_id: e.id,
      full_name:   e.full_name,
      total:       eTasks.length,
      completed:   eTasks.filter(t => t.status === 'completed').length,
      pending:     eTasks.filter(t => t.status === 'pending').length,
      in_progress: eTasks.filter(t => t.status === 'in_progress').length,
    }
  }).filter(e => e.total > 0).sort((a, b) => b.completed - a.completed)

  // Project summaries
  const projectSummary: ProjectSummary[] = ((projects ?? []) as ProjRow[]).map(p => {
    const pJc = ((jobCards ?? []) as JcRow[]).filter(jc => jc.project_id === p.id)
    const empSet = new Set(pJc.map(jc => jc.employee_id))
    return {
      id:            p.id,
      name:          p.name,
      project_number: p.project_number,
      status:        p.status,
      employee_count: empSet.size,
      total_manhours: Math.round(pJc.reduce((s, jc) => s + jc.total_manhours, 0) * 10) / 10,
    }
  }).sort((a, b) => b.total_manhours - a.total_manhours)

  // Overall stats
  const totalThisHours = thisMonthSummary.reduce((s, e) => s + e.total_hours, 0)
  const totalLastHours = lastMonthSummary.reduce((s, e) => s + e.total_hours, 0)
  const completedTasks = ((tasks ?? []) as TaskRow[]).filter(t => t.status === 'completed').length
  const pendingTasks   = ((tasks ?? []) as TaskRow[]).filter(t => t.status === 'pending').length

  return {
    thisMonth, lastMonth, now,
    thisMonthSummary, lastMonthSummary,
    taskSummary, projectSummary,
    totalThisHours: Math.round(totalThisHours * 10) / 10,
    totalLastHours: Math.round(totalLastHours * 10) / 10,
    completedTasks, pendingTasks,
    totalEmployees: (employees ?? []).length,
    activeProjects: ((projects ?? []) as ProjRow[]).filter(p => p.status === 'in_progress').length,
  }
}

const STATUS_COLORS: Record<string, string> = {
  planning:    'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  on_hold:     'bg-amber-100 text-amber-700',
  completed:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-600',
}

export default async function ReportsPage() {
  const data = await getReportData()

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header
        title="Reports"
        subtitle={`Data for ${format(data.now, 'MMMM yyyy')}`}
      />

      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-6">

        {/* KPI Overview */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Team Members',    value: data.totalEmployees,             icon: Users,       color: 'bg-blue-500' },
            { label: 'Active Projects', value: data.activeProjects,             icon: Briefcase,   color: 'bg-green-600' },
            { label: 'Hours This Month',value: `${data.totalThisHours}h`,      icon: Clock,       color: 'bg-amber-500' },
            { label: 'Tasks Completed', value: data.completedTasks,             icon: CheckSquare, color: 'bg-purple-500' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
              <div className={`w-10 h-10 rounded-lg ${kpi.color} flex items-center justify-center mb-3`}>
                <kpi.icon size={18} className="text-white" />
              </div>
              <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Month comparison */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-green-600" />
            <h3 className="font-semibold text-slate-900 text-sm">Month-over-Month Hours</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-50 rounded-xl p-4 text-center border border-green-100">
              <p className="text-3xl font-bold text-green-700">{data.totalThisHours}h</p>
              <p className="text-xs text-green-600 mt-1">{format(data.now, 'MMMM yyyy')} (this month)</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-200">
              <p className="text-3xl font-bold text-slate-700">{data.totalLastHours}h</p>
              <p className="text-xs text-slate-500 mt-1">{format(subMonths(data.now, 1), 'MMMM yyyy')} (last month)</p>
            </div>
          </div>
          {data.totalLastHours > 0 && (
            <p className="text-xs text-center mt-3 text-slate-500">
              {data.totalThisHours >= data.totalLastHours
                ? <span className="text-green-600 font-semibold">▲ {Math.round(((data.totalThisHours - data.totalLastHours) / data.totalLastHours) * 100)}% vs last month</span>
                : <span className="text-red-500 font-semibold">▼ {Math.round(((data.totalLastHours - data.totalThisHours) / data.totalLastHours) * 100)}% vs last month</span>
              }
            </p>
          )}
        </div>

        {/* Attendance Report */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Clock size={16} className="text-green-600" />
            <h3 className="font-semibold text-slate-900 text-sm">
              Attendance — {format(data.now, 'MMMM yyyy')}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Employee', 'Designation', 'Days Present', 'Total Hours', 'Avg/Day'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.thisMonthSummary.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-sm">No attendance data for this month</td></tr>
                ) : data.thisMonthSummary.map(emp => (
                  <tr key={emp.employee_id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{emp.full_name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{emp.designation ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800">{emp.total_days}</span>
                      <span className="text-slate-400 text-xs ml-1">days</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800">{emp.total_hours}</span>
                      <span className="text-slate-400 text-xs ml-1">hrs</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{emp.avg_hours_per_day}h/day</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Task Performance */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <CheckSquare size={16} className="text-green-600" />
            <h3 className="font-semibold text-slate-900 text-sm">Task Performance (All Time)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Employee', 'Total Tasks', 'Completed', 'In Progress', 'Pending', 'Completion %'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.taskSummary.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">No task data</td></tr>
                ) : data.taskSummary.map(emp => {
                  const pct = emp.total > 0 ? Math.round((emp.completed / emp.total) * 100) : 0
                  return (
                    <tr key={emp.employee_id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{emp.full_name}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{emp.total}</td>
                      <td className="px-4 py-3 text-green-600 font-semibold">{emp.completed}</td>
                      <td className="px-4 py-3 text-blue-600">{emp.in_progress}</td>
                      <td className="px-4 py-3 text-amber-600">{emp.pending}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[80px]">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-slate-700">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Project Hours */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <BarChart3 size={16} className="text-green-600" />
            <h3 className="font-semibold text-slate-900 text-sm">Project Man-Hours</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Project', 'Status', 'Team Size', 'Total Man-Hours'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.projectSummary.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-slate-400 text-sm">No project data</td></tr>
                ) : data.projectSummary.map(proj => (
                  <tr key={proj.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{proj.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{proj.project_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[proj.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {proj.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{proj.employee_count} {proj.employee_count === 1 ? 'person' : 'people'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{proj.total_manhours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
