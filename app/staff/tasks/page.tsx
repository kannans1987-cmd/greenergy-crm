'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { Plus, CheckCircle, Clock, AlertCircle, ChevronDown, Trash2 } from 'lucide-react'
import { canAllocate, allocatable, personTitle, LEVEL_TITLE, ALLOCATION_RULE, type AllocationLevel } from '@/lib/allocation'
import TaskBoard from '@/components/staff/TaskBoard'
import { LayoutGrid, List } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/workflow'

interface Task {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  due_date: string | null
  due_time: string | null
  completion_notes: string | null
  completed_at: string | null
  projects: { name: string } | null
  assignee: { full_name: string } | null
  assigner: { full_name: string } | null
  assigned_to?: string | null
  assigned_by?: string | null
  created_at?: string | null
  started_at?: string | null
  status_changed_at?: string | null
  blocked?: boolean | null
  blocked_reason?: string | null
}

interface Profile {
  id: string
  full_name: string
  role: string
  allocation_level?: AllocationLevel
}

interface Project {
  id: string
  name: string
}

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low:    'bg-green-100 text-green-700 border-green-200',
}

const STATUS_OPTIONS = ['pending', 'in_progress', 'completed', 'review', 'cancelled']

function TaskCard({ task, onUpdate, canEdit, onDelete }: {
  task: Task
  onUpdate: (id: string, status: string, notes?: string) => void
  canEdit: boolean
  onDelete?: (task: Task) => void   // CEO only
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes,    setNotes]    = useState(task.completion_notes ?? '')
  const [updating, setUpdating] = useState(false)

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true)
    await onUpdate(task.id, newStatus, notes || undefined)
    setUpdating(false)
  }

  return (
    <div className={`bg-white rounded-xl border shadow-sm transition-all ${
      task.status === 'completed' ? 'border-green-100 opacity-75' :
      task.status === 'in_progress' ? 'border-blue-100' : 'border-slate-100'
    }`}>
      <div
        className="p-4 cursor-pointer flex items-start justify-between gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5">
            {task.status === 'completed'
              ? <CheckCircle size={18} className="text-green-500 shrink-0" />
              : task.status === 'in_progress'
                ? <Clock size={18} className="text-blue-500 shrink-0" />
                : <AlertCircle size={18} className="text-amber-500 shrink-0" />
            }
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-semibold text-slate-900 ${task.status === 'completed' ? 'line-through text-slate-500' : ''}`}>
              {task.title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[task.priority] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                {task.priority.toUpperCase()}
              </span>
              {task.projects && (
                <span className="text-xs text-slate-400 truncate">{task.projects.name}</span>
              )}
              {task.due_date && (
                <span className="text-xs text-slate-400">
                  Due {format(new Date(task.due_date), 'dd MMM')}
                </span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-3">
          {task.description && (
            <p className="text-sm text-slate-600">{task.description}</p>
          )}
          {(task.assigner || task.assignee) && (
            <p className="text-xs text-slate-400">{task.assignee ? `Assigned to: ${task.assignee.full_name}` : ''}{task.assignee && task.assigner ? ' · ' : ''}{task.assigner ? `Assigned by: ${task.assigner.full_name}` : ''}</p>
          )}

          {canEdit && task.status !== 'cancelled' && (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Update Status</label>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.filter(s => s !== 'cancelled').map(s => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={updating || task.status === s}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition ${
                        task.status === s
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      } disabled:opacity-50`}
                    >
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {(task.status === 'in_progress' || task.status === 'completed' || task.status === 'review') && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Completion Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Add notes about what was done…"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                  <button
                    onClick={() => handleStatusChange(task.status)}
                    disabled={updating}
                    className="mt-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                  >
                    Save Notes
                  </button>
                </div>
              )}
            </>
          )}

          {onDelete && (
            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button onClick={() => onDelete(task)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-red-600 border border-red-200 hover:bg-red-50 transition">
                <Trash2 size={12} /> Delete task
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TasksPage() {
  const supabase = createClient()
  const [profile,   setProfile]   = useState<Profile | null>(null)
  const [tasks,     setTasks]     = useState<Task[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showCreate,setShowCreate]= useState(false)
  const [activeTab, setActiveTab] = useState<'pending'|'in_progress'|'completed'|'all'>('pending')
  const [whose,     setWhose]     = useState<'all' | 'mine' | 'given'>('all')
  // Kanban board or list (remembered on this device; ?view=board from notifications)
  const [view, setView] = useState<'list' | 'board'>('list')
  const [kanban, setKanban] = useState<{ wip: number; aging: number }>({ wip: 3, aging: 3 })
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view') ?? localStorage.getItem('gss-task-view')
    if (v === 'board' || v === 'list') setView(v)
  }, [])
  const switchView = (v: 'list' | 'board') => { setView(v); try { localStorage.setItem('gss-task-view', v) } catch { /* private mode */ } }

  // Create task form
  const [newTask, setNewTask] = useState({
    title: '', description: '', assigned_to: '',
    project_id: '', priority: 'medium', due_date: '', due_time: '',
  })
  const [creating, setCreating] = useState(false)
  const [notice,   setNotice]   = useState('')
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t) }, [notice])

  const loadTasks = useCallback(async (uid: string, role: string) => {
    let q = supabase.from('tasks').select(
      // '*' so the Kanban fields (kanban_v1.sql) come along once they exist
      '*,projects(name),assignee:assigned_to(full_name),assigner:assigned_by(full_name)'
    ).order('created_at', { ascending: false })

    if (role === 'employee') q = q.or(`assigned_to.eq.${uid},assigned_by.eq.${uid}`)

    const { data } = await q
    if (data) setTasks(data as unknown as Task[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // '*' so this works before the allocation_level column exists
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (prof) setProfile(prof as Profile)

      const role = (prof as Profile)?.role ?? 'employee'
      const level = (prof as Profile)?.allocation_level ?? null
      const { data: kb } = await supabase.from('business_settings').select('data').eq('key', 'kanban').maybeSingle()
      if (kb?.data) setKanban({ wip: Number(kb.data.wip_per_person ?? 3), aging: Number(kb.data.aging_days ?? 3) })
      // Sr / Jr Admin Managers see every task, like managers
      await loadTasks(user.id, canAllocate(role, level) ? 'manager' : role)

      if (canAllocate(role, level)) {
        const [emps, { data: proj }] = await Promise.all([
          fetch('/api/profiles').then(r => r.ok ? r.json() : { profiles: [] }).catch(() => ({ profiles: [] })),
          supabase.from('projects').select('id,name').eq('status', 'in_progress').order('name'),
        ])
        setEmployees(allocatable((emps.profiles ?? []) as Profile[], role, level))
        if (proj) setProjects(proj as Project[])
      }
    }
    init()
  }, [loadTasks])

  const handleUpdateTask = async (id: string, status: string, notes?: string) => {
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (notes)                    updates.completion_notes = notes
    if (status === 'completed')   updates.completed_at     = new Date().toISOString()

    const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select('id')
    if (error || !data?.length) { setNotice(error?.message ?? 'Only the person doing the task, the person who gave it, or a manager can change it.'); return }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status, completion_notes: notes ?? t.completion_notes } : t))
  }

  // Board: move a card (the database checks the WIP limit and who may move it)
  const moveCard = async (t: Task, status: string) => {
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'completed') updates.completed_at = new Date().toISOString()
    const { data, error } = await supabase.from('tasks').update(updates).eq('id', t.id).select('*,projects(name),assignee:assigned_to(full_name),assigner:assigned_by(full_name)')
    if (error || !data?.length) { setNotice(error?.message ?? 'Only the person doing the task, the person who gave it, or a manager can move it.'); return false }
    setTasks(prev => prev.map(x => x.id === t.id ? data[0] as unknown as Task : x))
    return true
  }
  const blockCard = async (t: Task, blocked: boolean, reason?: string) => {
    const { data, error } = await supabase.from('tasks').update({ blocked, blocked_reason: blocked ? reason : null }).eq('id', t.id)
      .select('*,projects(name),assignee:assigned_to(full_name),assigner:assigned_by(full_name)')
    if (error || !data?.length) {
      setNotice(/blocked/.test(error?.message ?? '') && /column|schema/.test(error?.message ?? '') ? 'Flagging blocked needs the latest database update (kanban_v1.sql). Ask the CEO to run it.'
        : error?.message ?? 'Could not change it.'); return false
    }
    setTasks(prev => prev.map(x => x.id === t.id ? data[0] as unknown as Task : x))
    setNotice(blocked ? 'Flagged blocked — the person who gave it has been told' : 'Unblocked')
    return true
  }

  // CEO only (the database refuses anyone else); a copy is kept in the audit log
  const handleDeleteTask = async (task: Task) => {
    const who = task.assignee ? ` assigned to ${task.assignee.full_name}` : ''
    if (!window.confirm(`Delete the task "${task.title}"${who}?

This cannot be undone.${task.assignee && !['completed', 'cancelled'].includes(task.status) ? ' They will be told it was removed.' : ''}`)) return
    const { data, error } = await supabase.from('tasks').delete().eq('id', task.id).select('id')
    if (error || !data?.length) {
      setNotice(error?.message ?? 'Could not delete. The database update for deleting tasks may not have been run yet (supabase/task_delete_v1.sql).')
      return
    }
    setTasks(prev => prev.filter(t => t.id !== task.id))
    setNotice(`Task "${task.title}" deleted`)
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase.from('tasks').insert({
      title:        newTask.title,
      description:  newTask.description || null,
      assigned_to:  newTask.assigned_to || null,
      project_id:   newTask.project_id  || null,
      priority:     newTask.priority,
      due_date:     newTask.due_date    || null,
      due_time:     newTask.due_time    || null,
      assigned_by:  user.id,
      status:       'pending',
    }).select('id,title,description,priority,status,due_date,due_time,completion_notes,completed_at,assigned_to,assigned_by,projects(name),assignee:assigned_to(full_name),assigner:assigned_by(full_name)').single()

    if (error) setNotice(error.message)
    if (!error && data) {
      setNotice(`Task given${newTask.assigned_to ? ' to ' + (employees.find(x => x.id === newTask.assigned_to)?.full_name ?? '') + ' — they have been notified' : ''}`)
      setTasks(prev => [data as unknown as Task, ...prev])
      setNewTask({ title: '', description: '', assigned_to: '', project_id: '', priority: 'medium', due_date: '', due_time: '' })
      setShowCreate(false)
    }
    setCreating(false)
  }

  const filteredTasks = tasks.filter(t => {
    if (whose === 'mine' && t.assigned_to !== profile?.id) return false
    if (whose === 'given' && t.assigned_by !== profile?.id) return false
    if (activeTab === 'all') return true
    return t.status === activeTab
  })

  // CEO, admin manager, Sr / Jr Admin Manager give tasks
  const isManager = canAllocate(profile?.role, profile?.allocation_level)
  const fullManager = profile?.role === 'admin' || profile?.role === 'task_manager'
  const counts = {
    pending:     tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed:   tasks.filter(t => t.status === 'completed').length,
    all:         tasks.length,
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Tasks" subtitle={isManager ? (profile?.role === 'employee' && profile?.allocation_level ? `${LEVEL_TITLE[profile.allocation_level]} · ${ALLOCATION_RULE[profile.allocation_level]}` : 'Assign and manage team tasks') : 'Your assigned tasks'} />

      <div className={`flex-1 p-4 sm:p-6 mx-auto w-full space-y-5 ${view === 'board' ? 'max-w-7xl' : 'max-w-4xl'}`}>

        {/* Tabs + Create button */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-100 shadow-sm" role="group" aria-label="View">
            <button onClick={() => switchView('list')} aria-pressed={view === 'list'} className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><List size={13} /> List</button>
            <button onClick={() => switchView('board')} aria-pressed={view === 'board'} className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${view === 'board' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><LayoutGrid size={13} /> Board</button>
          </div>
          {view === 'list' && <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-100 shadow-sm">
            {(['pending', 'in_progress', 'completed', 'all'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === tab ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.replace('_', ' ')} <span className="ml-1 opacity-60">({counts[tab]})</span>
              </button>
            ))}
          </div>}

          {isManager && (
            <select value={whose} onChange={e => setWhose(e.target.value as 'all' | 'mine' | 'given')} aria-label="Whose tasks"
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white text-slate-600">
              <option value="all">Everyone&apos;s tasks</option><option value="mine">For me</option><option value="given">Given by me</option>
            </select>
          )}
          {isManager && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition shadow-sm"
            >
              <Plus size={16} /> Assign Task
            </button>
          )}
        </div>

        {/* Create Task Form */}
        {showCreate && isManager && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900 text-sm mb-4">Create & Assign Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <input
                    required value={newTask.title}
                    onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                    placeholder="Task title *"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <textarea
                    rows={2} value={newTask.description}
                    onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
                    placeholder="Description (optional)"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                </div>
                <select value={newTask.assigned_to} onChange={e => setNewTask(p => ({ ...p, assigned_to: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Assign to…</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} · {personTitle(e, ROLE_LABELS)}</option>)}
                </select>
                <select value={newTask.project_id} onChange={e => setNewTask(p => ({ ...p, project_id: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Link to project…</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="high">High Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="low">Low Priority</option>
                </select>
                <input type="date" value={newTask.due_date}
                  onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        )}

        {notice && <p role="status" className="text-sm bg-slate-800 text-white rounded-lg px-4 py-2">{notice}</p>}

        {view === 'board' && (
          <TaskBoard tasks={tasks.filter(t => whose === 'mine' ? t.assigned_to === profile?.id : whose === 'given' ? t.assigned_by === profile?.id : true)}
            meId={profile?.id} fullManager={fullManager} wip={kanban.wip} agingDays={kanban.aging}
            onMove={(t, s) => moveCard(t as Task, s)} onBlock={(t, b, r) => blockCard(t as Task, b, r)} />
        )}

        {/* Task list */}
        <div className={`space-y-3 ${view === 'board' ? 'hidden' : ''}`}>
          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-10 text-center">
              <p className="text-slate-400 text-sm">No {activeTab.replace('_', ' ')} tasks found.</p>
            </div>
          ) : filteredTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onUpdate={handleUpdateTask}
              canEdit={fullManager || task.assigned_to === profile?.id || task.assigned_by === profile?.id}
              onDelete={profile?.role === 'admin' ? handleDeleteTask : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
