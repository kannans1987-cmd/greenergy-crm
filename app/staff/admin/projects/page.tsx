'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { Plus, Briefcase, MapPin, Calendar, FileText, X, Loader2, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'

interface Project {
  id: string; project_number: string; name: string; customer_name: string | null
  site_address: string | null; project_type: string | null; capacity_kwp: number | null
  start_date: string | null; expected_completion: string | null; status: string
}
interface Employee { id: string; full_name: string }
interface ProjectEmployee { id: string; full_name: string }

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}
const PROJECT_TYPES = ['residential','commercial','industrial','street_light','solar_pump','hybrid']

export default function ProjectsPage() {
  const supabase = createClient()
  const [projects,  setProjects]  = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [creating,  setCreating]  = useState(false)
  const [toast,     setToast]     = useState('')
  const [form, setForm] = useState({
    name: '', customer_name: '', site_address: '', project_type: 'residential',
    capacity_kwp: '', start_date: '', expected_completion: '', notes: '', assignees: [] as string[],
  })

  // Job card creation modal state
  const [jobCardModal, setJobCardModal] = useState<{ project: Project } | null>(null)
  const [projectEmployees, setProjectEmployees] = useState<ProjectEmployee[]>([])
  const [loadingProjEmps, setLoadingProjEmps] = useState(false)
  const [jobCardForm, setJobCardForm] = useState({ employee_id: '', role_in_project: '', start_date: '' })
  const [creatingJobCard, setCreatingJobCard] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  const openJobCardModal = async (project: Project) => {
    setJobCardModal({ project })
    setJobCardForm({ employee_id: '', role_in_project: '', start_date: project.start_date ?? '' })
    setLoadingProjEmps(true)
    const { data } = await supabase
      .from('project_employees')
      .select('employee_id, profiles:employee_id(id, full_name)')
      .eq('project_id', project.id)
    if (data) {
      const emps = data.map((row: unknown) => {
        const r = row as { profiles: { id: string; full_name: string } }
        return r.profiles
      }).filter(Boolean)
      setProjectEmployees(emps as ProjectEmployee[])
    }
    setLoadingProjEmps(false)
  }

  const handleCreateJobCard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobCardModal) return
    setCreatingJobCard(true)

    const { data: { user } } = await supabase.auth.getUser()
    const year = new Date().getFullYear()
    const rand = Math.floor(Math.random() * 90000) + 10000
    const jcNumber = `JC-${year}-${rand}`

    const { error } = await supabase.from('job_cards').insert({
      job_card_number: jcNumber,
      project_id: jobCardModal.project.id,
      employee_id: jobCardForm.employee_id,
      role_in_project: jobCardForm.role_in_project || null,
      start_date: jobCardForm.start_date || null,
      status: 'active',
      total_manhours: 0,
      created_by: user?.id,
    })

    if (error) {
      showToast('❌ Failed to create job card')
    } else {
      showToast(`✅ Job card ${jcNumber} created!`)
      setJobCardModal(null)
    }
    setCreatingJobCard(false)
  }

  const loadData = useCallback(async () => {
    const [{ data: proj }, { data: emps }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,full_name').eq('status','active').order('full_name'),
    ])
    if (proj) setProjects(proj as Project[])
    if (emps) setEmployees(emps as Employee[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: newProj, error } = await supabase.from('projects').insert({
      name: form.name, customer_name: form.customer_name || null,
      site_address: form.site_address || null, project_type: form.project_type,
      capacity_kwp: form.capacity_kwp ? parseFloat(form.capacity_kwp) : null,
      start_date: form.start_date || null, expected_completion: form.expected_completion || null,
      notes: form.notes || null, status: 'planning', created_by: user?.id,
    }).select().single()

    if (error || !newProj) { showToast('❌ Failed to create project'); setCreating(false); return }

    if (form.assignees.length > 0) {
      await supabase.from('project_employees').insert(
        form.assignees.map(eid => ({
          project_id: (newProj as Project).id, employee_id: eid,
          assigned_date: form.start_date || new Date().toISOString().split('T')[0],
        }))
      )
    }

    showToast(`✅ Project ${(newProj as Project).project_number} created — job cards auto-generated!`)
    setProjects(prev => [newProj as Project, ...prev])
    setForm({ name:'', customer_name:'', site_address:'', project_type:'residential', capacity_kwp:'', start_date:'', expected_completion:'', notes:'', assignees:[] })
    setShowForm(false); setCreating(false)
  }

  const toggleAssignee = (id: string) =>
    setForm(prev => ({ ...prev, assignees: prev.assignees.includes(id) ? prev.assignees.filter(a => a !== id) : [...prev.assignees, id] }))

  const handleStatusChange = async (id: string, status: string) => {
    await supabase.from('projects').update({ status }).eq('id', id)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Projects" subtitle="Create and manage solar installation projects" />
      {toast && <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl text-sm">{toast}</div>}

      {/* Create Job Card Modal */}
      {jobCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-br from-green-600 to-green-700 px-6 py-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-green-100 text-xs mb-0.5">Create Job Card for</p>
                <h3 className="text-white font-bold text-base leading-tight">{jobCardModal.project.name}</h3>
                <p className="text-green-100 text-xs font-mono mt-0.5">{jobCardModal.project.project_number}</p>
              </div>
              <button onClick={() => setJobCardModal(null)} className="text-white/70 hover:text-white transition mt-0.5">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateJobCard} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Assign Employee <span className="text-red-400">*</span>
                </label>
                {loadingProjEmps ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                    <Loader2 size={14} className="animate-spin" /> Loading employees…
                  </div>
                ) : projectEmployees.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">No employees assigned to this project yet.</p>
                ) : (
                  <select
                    required
                    value={jobCardForm.employee_id}
                    onChange={e => setJobCardForm(p => ({ ...p, employee_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Select employee…</option>
                    {projectEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Role in Project</label>
                <input
                  type="text"
                  value={jobCardForm.role_in_project}
                  onChange={e => setJobCardForm(p => ({ ...p, role_in_project: e.target.value }))}
                  placeholder="e.g. Panel Installer, Electrician, Supervisor"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Start Date</label>
                <input
                  type="date"
                  value={jobCardForm.start_date}
                  onChange={e => setJobCardForm(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setJobCardModal(null)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingJobCard || projectEmployees.length === 0}
                  className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition flex items-center gap-2"
                >
                  {creatingJobCard && <Loader2 size={14} className="animate-spin" />}
                  {creatingJobCard ? 'Creating…' : 'Create Job Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">
        <div className="flex justify-between items-center">
          <p className="text-sm text-slate-500">{projects.length} projects total</p>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition shadow-sm">
            <Plus size={16} /> New Project
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-5">Create New Project</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Project name *" className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <input value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))}
                  placeholder="Customer name" className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <input value={form.site_address} onChange={e => setForm(p => ({ ...p, site_address: e.target.value }))}
                  placeholder="Site address" className="sm:col-span-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <select value={form.project_type} onChange={e => setForm(p => ({ ...p, project_type: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                  {PROJECT_TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
                </select>
                <input type="number" step="0.1" value={form.capacity_kwp}
                  onChange={e => setForm(p => ({ ...p, capacity_kwp: e.target.value }))}
                  placeholder="Capacity (kWp)" className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <div><label className="text-xs text-slate-500 mb-1 block">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div>
                <div><label className="text-xs text-slate-500 mb-1 block">Expected Completion</label>
                  <input type="date" value={form.expected_completion} onChange={e => setForm(p => ({ ...p, expected_completion: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" /></div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Assign Employees <span className="text-xs text-green-600 font-normal">(Job cards auto-created for each)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-slate-100 rounded-lg p-2">
                  {employees.map(emp => (
                    <label key={emp.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-50">
                      <input type="checkbox" checked={form.assignees.includes(emp.id)} onChange={() => toggleAssignee(emp.id)} className="rounded accent-green-600" />
                      <span className="text-xs text-slate-700 truncate">{emp.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={creating} className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                  {creating ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-16 text-center">
            <Briefcase size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">No projects yet. Create your first project!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map(proj => (
              <div key={proj.id} className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs text-slate-400 font-mono">{proj.project_number}</p>
                    <h4 className="font-bold text-slate-900 text-sm mt-0.5">{proj.name}</h4>
                  </div>
                  <select value={proj.status} onChange={e => handleStatusChange(proj.id, e.target.value)}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-full border-0 focus:outline-none cursor-pointer ${STATUS_COLORS[proj.status]}`}>
                    {['planning','in_progress','on_hold','completed','cancelled'].map(s => (
                      <option key={s} value={s}>{s.replace('_',' ')}</option>
                    ))}
                  </select>
                </div>
                {proj.customer_name && <p className="text-xs text-slate-600 mb-1">👤 {proj.customer_name}</p>}
                {proj.site_address && (
                  <p className="text-xs text-slate-500 flex items-start gap-1 mb-1">
                    <MapPin size={10} className="shrink-0 mt-0.5" /> {proj.site_address}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
                  {proj.capacity_kwp && <span>⚡ {proj.capacity_kwp} kWp</span>}
                  {proj.project_type && <span className="capitalize">{proj.project_type.replace('_',' ')}</span>}
                </div>
                {(proj.start_date || proj.expected_completion) && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
                    <Calendar size={10} />
                    {proj.start_date && format(new Date(proj.start_date), 'dd MMM yy')}
                    {proj.expected_completion && ` → ${format(new Date(proj.expected_completion), 'dd MMM yy')}`}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                  <Link
                    href={`/staff/job-cards?project=${proj.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-100 transition"
                  >
                    <FileText size={12} /> View Jobs <ChevronRight size={11} />
                  </Link>
                  <button
                    onClick={() => openJobCardModal(proj)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100 transition"
                  >
                    <Plus size={12} /> Add Job Card
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
