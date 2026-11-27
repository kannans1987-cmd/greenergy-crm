'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import Avatar from '@/components/staff/Avatar'
import { format } from 'date-fns'
import {
  CheckSquare, MapPin, FileText, Clock,
  TrendingUp, AlertCircle, Calendar
} from 'lucide-react'

interface Task {
  id: string
  title: string
  priority: string
  status: string
  due_date: string | null
  projects: { name: string } | null
}

interface AttendanceRecord {
  id: string
  clock_in_time: string
  clock_out_time: string | null
  total_hours: number | null
  attendance_status: string
}

interface JobCard {
  id: string
  job_card_number: string
  total_manhours: number
  status: string
  projects: { name: string } | null
}

function StatCard({ icon: Icon, label, value, color, href }: {
  icon: React.ElementType; label: string; value: string | number; color: string; href?: string
}) {
  const content = (
    <div className={`bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition group`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
          <Icon size={18} className="text-white" />
        </div>
        {href && (
          <span className="text-xs text-slate-400 group-hover:text-green-600 transition">View →</span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    high:   'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low:    'bg-green-100 text-green-700',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls[priority] ?? 'bg-slate-100 text-slate-600'}`}>
      {priority}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending:     'bg-slate-400',
    in_progress: 'bg-amber-500',
    completed:   'bg-green-500',
    review:      'bg-blue-500',
    cancelled:   'bg-red-400',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${cls[status] ?? 'bg-slate-300'}`} />
}

export default function EmployeeDashboard() {
  const supabase = createClient()
  const [userId,      setUserId]      = useState<string | null>(null)
  const [profile,     setProfile]     = useState<{ full_name: string; designation?: string | null; avatar_url?: string | null } | null>(null)
  // CEO, admin manager, Sr / Jr Admin Manager: everyone's face with today's status
  const [team,        setTeam]        = useState<{ id: string; full_name: string; designation: string | null; avatar_url: string | null; state: 'in' | 'done' | 'leave' | 'out' }[]>([])
  const [tasks,       setTasks]       = useState<Task[]>([])
  const [attendance,  setAttendance]  = useState<AttendanceRecord | null>(null)
  const [todayHours,  setTodayHours]  = useState(0)
  const [isCeo,       setIsCeo]       = useState(false)   // the CEO does not clock in
  const [isMgr,       setIsMgr]       = useState(false)
  const [saOpen,      setSaOpen]      = useState(0)       // CEO: Super Admin changes not yet reviewed
  const [isSuper,     setIsSuper]     = useState(false)
  const [jobCards,    setJobCards]    = useState<JobCard[]>([])
  const [monthHours,  setMonthHours]  = useState(0)
  const [loading,     setLoading]     = useState(true)

  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const [
        { data: prof },
        { data: todayTasks },
        { data: todayAtt },
        { data: cards },
        { data: attMonth },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('tasks').select('id,title,priority,status,due_date,projects(name)')
          .eq('assigned_to', user.id).neq('status', 'completed').neq('status', 'cancelled')
          .order('due_date', { ascending: true }).limit(5),
        supabase.from('attendance').select('*').eq('employee_id', user.id).eq('date', today).order('clock_in_time'),
        supabase.from('job_cards').select('id,job_card_number,total_manhours,status,projects(name)')
          .eq('employee_id', user.id).eq('status', 'active').limit(3),
        supabase.from('attendance').select('total_hours')
          .eq('employee_id', user.id)
          .gte('date', format(new Date(), 'yyyy-MM-01')),
      ])

      if (prof)        { setProfile(prof as unknown as { full_name: string }); setIsCeo((prof as { role?: string }).role === 'admin')
        const mgr = ['admin', 'task_manager'].includes((prof as { role?: string }).role ?? '')
        setIsMgr(mgr)
        if (mgr) supabase.rpc('run_scheduled_alerts').then(() => {}, () => {})   // due alerts (no-op if sent recently)
        const p = prof as { role?: string; allocation_level?: string | null; super_admin?: boolean }
        setIsSuper(p.role === 'admin' && !!p.super_admin)
        if (p.role === 'admin' && !p.super_admin) {
          supabase.from('super_admin_changes').select('id', { count: 'exact', head: true }).is('reviewed_at', null)
            .then(({ count, error }) => { if (!error) setSaOpen(count ?? 0) })
        }
        if (mgr || (p.role === 'employee' && p.allocation_level)) {
          const [{ data: people }, { data: att }, { data: lv }] = await Promise.all([
            supabase.from('profiles').select('*').eq('status', 'active').neq('role', 'admin').order('full_name'),
            supabase.from('attendance').select('employee_id, clock_out_time').eq('date', today),
            supabase.rpc('team_leave_on', { p_date: today }),
          ])
          const rows = (att as { employee_id: string; clock_out_time: string | null }[] | null) ?? []
          const onLeave = new Set(((lv as { employee_id: string }[] | null) ?? []).map(l => l.employee_id))
          setTeam(((people as { id: string; full_name: string; designation: string | null; avatar_url: string | null }[] | null) ?? []).map(x => {
            const mine = rows.filter(r => r.employee_id === x.id)
            const state = mine.some(r => !r.clock_out_time) ? 'in' as const : mine.length ? 'done' as const : onLeave.has(x.id) ? 'leave' as const : 'out' as const
            return { id: x.id, full_name: x.full_name, designation: x.designation, avatar_url: x.avatar_url, state }
          }))
        }
      }
      if (todayTasks)  setTasks(todayTasks as unknown as Task[])
      if (todayAtt) {
        // Site / O&M staff can have several sessions a day: show the open one, else the last one
        const rs = todayAtt as unknown as AttendanceRecord[]
        setAttendance(rs.find(r => r.clock_in_time && !r.clock_out_time) ?? rs[rs.length - 1] ?? null)
        setTodayHours(rs.reduce((t, r) => t + Number(r.total_hours ?? 0), 0))
      }
      if (cards)       setJobCards(cards as unknown as JobCard[])
      if (attMonth) {
        const total = (attMonth as { total_hours: number | null }[])
          .reduce((s, r) => s + (r.total_hours ?? 0), 0)
        setMonthHours(Math.round(total * 10) / 10)
      }

      setLoading(false)
    }
    load()
  }, [])

  const isClockedIn   = !!attendance?.clock_in_time && !attendance?.clock_out_time
  const pendingTasks  = tasks.filter(t => t.status === 'pending').length
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header
        title={`Good ${new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, ${profile?.full_name?.split(' ')[0] ?? 'there'}! 👋`}
        subtitle={format(new Date(), 'EEEE, dd MMMM yyyy')}
      />

      <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-6xl mx-auto w-full">

        {/* Welcome, with my photo */}
        <div className="bg-gradient-to-r from-green-700 to-green-500 rounded-2xl p-5 flex items-center gap-4 text-white shadow-sm">
          <Link href="/staff/profile" title={profile?.avatar_url ? 'My profile' : 'Add your photo'} className="shrink-0">
            <Avatar name={profile?.full_name} url={profile?.avatar_url} size={72} square className="border-4 border-white/80 shadow-md" />
          </Link>
          <div className="min-w-0">
            <p className="text-lg font-bold truncate">{profile?.full_name}</p>
            <p className="text-sm text-white/80 truncate">{isSuper ? 'Super Admin' : isCeo ? 'CEO' : profile?.designation || 'Greenergy team'}</p>
            {!profile?.avatar_url && (
              <Link href="/staff/profile" className="inline-block mt-2 text-xs font-semibold bg-white/20 hover:bg-white/30 rounded-full px-3 py-1">📷 Add your photo</Link>
            )}
          </div>
        </div>

        {saOpen > 0 && (
          <Link href="/staff/admin/super-activity" className="block rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 hover:bg-indigo-100">
            🛡️ <b>{saOpen} change{saOpen > 1 ? 's' : ''} by the Super Admin</b> to review → Super Admin activity
          </Link>
        )}

        {/* Team today (CEO, admin manager, Sr / Jr Admin Manager) */}
        {team.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900 text-sm">
                Team today · {team.filter(t => t.state === 'in').length} working now
              </h3>
              <Link href="/staff/attendance" className="text-xs text-green-600 hover:text-green-700">Attendance →</Link>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-4">
              {team.map(t => {
                const dot = { in: 'bg-green-500', done: 'bg-slate-400', leave: 'bg-blue-500', out: 'bg-amber-400' }[t.state]
                const label = { in: 'Working', done: 'Clocked out', leave: 'On leave', out: 'Not in yet' }[t.state]
                return (
                  <div key={t.id} className="flex flex-col items-center text-center" title={`${t.full_name} · ${label}`}>
                    <div className="relative">
                      <Avatar name={t.full_name} url={t.avatar_url} size={56} className={t.state === 'out' || t.state === 'leave' ? 'opacity-60' : ''} />
                      <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${dot}`} />
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-slate-800 leading-tight line-clamp-2">{t.full_name}</p>
                    <p className="text-[10px] text-slate-400">{label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Attendance status banner (staff only) */}
        {!isCeo && (
        <div className={`rounded-xl p-4 flex items-center justify-between ${isClockedIn ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-center gap-3">
            <MapPin size={20} className={isClockedIn ? 'text-green-600' : 'text-amber-600'} />
            <div>
              <p className={`text-sm font-semibold ${isClockedIn ? 'text-green-800' : 'text-amber-800'}`}>
                {isClockedIn
                  ? `Clocked in at ${format(new Date(attendance!.clock_in_time), 'hh:mm a')}`
                  : attendance?.clock_out_time
                    ? `Clocked out — ${todayHours.toFixed(1)} hrs worked today`
                    : 'Not clocked in today'}
              </p>
              <p className={`text-xs ${isClockedIn ? 'text-green-600' : 'text-amber-600'}`}>
                {isClockedIn ? 'Your attendance is being tracked' : 'Remember to clock in when you reach the office or site'}
              </p>
            </div>
          </div>
          <Link
            href="/staff/attendance"
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${isClockedIn ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
          >
            {isClockedIn ? 'Clock Out' : 'Clock In'}
          </Link>
        </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={AlertCircle}  label="Pending Tasks"   value={pendingTasks}     color="bg-amber-500"   href="/staff/tasks" />
          <StatCard icon={TrendingUp}   label="In Progress"     value={inProgressTasks}  color="bg-blue-500"    href="/staff/tasks" />
          <StatCard icon={Clock}        label="Hours This Month" value={`${monthHours}h`} color="bg-green-600"  />
          <StatCard icon={FileText}     label="Active Job Cards" value={jobCards.length}  color="bg-slate-700"  href="/staff/job-cards" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Tasks */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <CheckSquare size={16} className="text-green-600" /> My Active Tasks
              </h3>
              <Link href="/staff/tasks" className="text-xs text-green-600 hover:text-green-700">View all →</Link>
            </div>
            <div className="divide-y divide-slate-50">
              {tasks.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">
                  🎉 No pending tasks! You&apos;re all caught up.
                </div>
              ) : tasks.map(task => (
                <div key={task.id} className="px-5 py-3.5 hover:bg-slate-50 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <StatusDot status={task.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{task.title}</p>
                        {task.projects && (
                          <p className="text-xs text-slate-400 truncate">{task.projects.name}</p>
                        )}
                      </div>
                    </div>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  {task.due_date && (
                    <p className="text-xs text-slate-400 mt-1 ml-4 flex items-center gap-1">
                      <Calendar size={10} /> Due {format(new Date(task.due_date), 'dd MMM')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Active Job Cards */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <FileText size={16} className="text-green-600" /> Active Job Cards
              </h3>
              <Link href="/staff/job-cards" className="text-xs text-green-600 hover:text-green-700">View all →</Link>
            </div>
            <div className="divide-y divide-slate-50">
              {jobCards.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">
                  No active job cards. You will be assigned to projects by your manager.
                </div>
              ) : jobCards.map(jc => (
                <div key={jc.id} className="px-5 py-4 hover:bg-slate-50 transition">
                  <p className="text-sm font-semibold text-slate-800">{jc.projects?.name ?? 'Unknown Project'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{jc.job_card_number}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-slate-600 flex items-center gap-1">
                      <Clock size={10} /> {jc.total_manhours.toFixed(1)} hrs logged
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-slate-900 text-sm mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              isCeo
                ? { label: 'Team Attendance', href: '/staff/attendance', icon: '📍', color: 'bg-green-50 text-green-700 border-green-100' }
                : { label: 'Clock In / Out', href: '/staff/attendance', icon: '📍', color: 'bg-green-50 text-green-700 border-green-100' },
              ...(isMgr ? [{ label: 'Control room', href: '/staff/control', icon: '🚦', color: 'bg-red-50 text-red-700 border-red-100' },
                { label: 'Sales insights', href: '/staff/insights', icon: '📈', color: 'bg-violet-50 text-violet-700 border-violet-100' }] : []),
              { label: 'View Tasks',     href: '/staff/tasks',       icon: '✓',  color: 'bg-blue-50 text-blue-700 border-blue-100' },
              { label: 'Job Cards',      href: '/staff/job-cards',   icon: '📋', color: 'bg-slate-50 text-slate-700 border-slate-200' },
              { label: 'Apply Leave',    href: '/staff/leave',       icon: '📅', color: 'bg-amber-50 text-amber-700 border-amber-100' },
            ].map(action => (
              <Link
                key={action.href}
                href={action.href}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border ${action.color} hover:shadow-sm transition text-center`}
              >
                <span className="text-2xl">{action.icon}</span>
                <span className="text-xs font-semibold">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
