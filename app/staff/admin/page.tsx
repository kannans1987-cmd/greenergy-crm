import { createClient } from '@/lib/supabase/server'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { Users, Briefcase, Clock, AlertCircle, UserPlus, CheckCircle } from 'lucide-react'

async function getStats() {
  const supabase   = await createClient()
  const today      = new Date().toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  const [
    { count: totalEmployees },
    { count: activeProjects },
    { count: todayClockIns },
    { count: pendingTasks },
    { count: pendingRegs },
    { data: monthHoursData },
    { data: recentTasks },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('status','active').neq('role','admin'),
    supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status','in_progress'),
    supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).not('clock_in_time','is',null),
    supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status','pending'),
    supabase.from('employee_registrations').select('*', { count: 'exact', head: true }).eq('status','pending'),
    supabase.from('attendance').select('total_hours').gte('date', monthStart).not('total_hours','is',null),
    supabase.from('tasks')
      .select('id,title,status,created_at,assignee:assigned_to(full_name)')
      .order('created_at',{ ascending: false }).limit(6),
  ])

  const totalMonthHours = (monthHoursData ?? []).reduce(
    (s: number, r: { total_hours: number | null }) => s + (r.total_hours ?? 0), 0
  )
  return {
    totalEmployees:  totalEmployees  ?? 0,
    activeProjects:  activeProjects  ?? 0,
    todayClockIns:   todayClockIns   ?? 0,
    pendingTasks:    pendingTasks    ?? 0,
    pendingRegs:     pendingRegs     ?? 0,
    totalMonthHours: Math.round(totalMonthHours),
    recentTasks:     recentTasks     ?? [],
  }
}

export default async function AdminDashboard() {
  const stats = await getStats()

  const kpis = [
    { label: 'Active Employees',     value: stats.totalEmployees,        icon: Users,        color: 'bg-blue-500',   href: '/staff/admin/users'    },
    { label: 'Active Projects',      value: stats.activeProjects,        icon: Briefcase,    color: 'bg-green-600',  href: '/staff/admin/projects' },
    { label: "Today's Clock-Ins",    value: stats.todayClockIns,         icon: Clock,        color: 'bg-teal-500',   href: undefined               },
    { label: 'Pending Tasks',        value: stats.pendingTasks,          icon: AlertCircle,  color: 'bg-amber-500',  href: '/staff/tasks'          },
    { label: 'Pending Approvals',    value: stats.pendingRegs,           icon: UserPlus,     color: 'bg-red-500',    href: '/staff/admin/users'    },
    { label: 'Man-Hours This Month', value: `${stats.totalMonthHours}h`, icon: CheckCircle,  color: 'bg-slate-700',  href: undefined               },
  ]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Admin Dashboard" subtitle="Greenergy Solar Solutions — Operations Overview" />
      <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">

        {/* Pending approval alert */}
        {stats.pendingRegs > 0 && (
          <Link href="/staff/admin/users">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 hover:bg-red-100 transition cursor-pointer">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                <UserPlus size={16} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-800">
                  {stats.pendingRegs} employee registration{stats.pendingRegs > 1 ? 's' : ''} awaiting approval
                </p>
                <p className="text-xs text-red-600">Click to review and approve →</p>
              </div>
            </div>
          </Link>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {kpis.map(kpi => {
            const Icon = kpi.icon
            const card = (
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition group">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 ${kpi.color} rounded-lg flex items-center justify-center`}>
                    <Icon size={18} className="text-white" />
                  </div>
                  {kpi.href && <span className="text-xs text-slate-400 group-hover:text-green-600">View →</span>}
                </div>
                <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{kpi.label}</p>
              </div>
            )
            return kpi.href
              ? <Link key={kpi.label} href={kpi.href}>{card}</Link>
              : <div key={kpi.label}>{card}</div>
          })}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-slate-900 text-sm mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Review Users',    href: '/staff/admin/users',    emoji: '👥' },
              { label: 'Manage Projects', href: '/staff/admin/projects', emoji: '🏗️' },
              { label: 'Assign Tasks',    href: '/staff/tasks',          emoji: '✅' },
              { label: 'View Job Cards',  href: '/staff/job-cards',      emoji: '📋' },
            ].map(a => (
              <Link key={a.href} href={a.href}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 transition text-center">
                <span className="text-2xl">{a.emoji}</span>
                <span className="text-xs font-semibold text-slate-700">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent task activity */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 text-sm">Recent Task Activity</h3>
            <Link href="/staff/tasks" className="text-xs text-green-600 hover:text-green-700">View all →</Link>
          </div>
          <div className="divide-y divide-slate-50">
            {(stats.recentTasks as unknown as { id: string; title: string; status: string; assignee: { full_name: string } | null }[]).map(t => (
              <div key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{t.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t.assignee?.full_name ?? 'Unassigned'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                  t.status === 'completed'   ? 'bg-green-100 text-green-700'  :
                  t.status === 'in_progress' ? 'bg-blue-100 text-blue-700'   :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {t.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {stats.recentTasks.length === 0 && (
              <p className="text-center py-8 text-slate-400 text-sm">No tasks yet</p>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
