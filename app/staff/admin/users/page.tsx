'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { UserCheck, UserX, Shield, Users, Clock } from 'lucide-react'

interface Registration {
  id: string; full_name: string; email: string; phone: string | null
  designation: string | null; department: string | null
  date_of_joining: string | null; created_at: string; status: string
}
interface Employee {
  id: string; full_name: string; email: string; role: string
  designation: string | null; department: string | null; status: string
}
type Tab = 'pending' | 'employees'

export default function UserManagementPage() {
  const supabase = createClient()
  const [tab,       setTab]      = useState<Tab>('pending')
  const [pending,   setPending]  = useState<Registration[]>([])
  const [employees, setEmployees]= useState<Employee[]>([])
  const [loading,   setLoading]  = useState(true)
  const [actionId,  setActionId] = useState<string | null>(null)
  const [rejectId,  setRejectId] = useState<string | null>(null)
  const [rejectNote,setRejectNote]=useState('')
  const [toast,     setToast]    = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  const loadData = useCallback(async () => {
    const [{ data: regs }, { data: emps }] = await Promise.all([
      supabase.from('employee_registrations').select('*').eq('status','pending').order('created_at'),
      supabase.from('profiles').select('id,full_name,email,role,designation,department,status').order('full_name'),
    ])
    if (regs) setPending(regs as Registration[])
    if (emps) setEmployees(emps as Employee[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleApprove = async (reg: Registration) => {
    setActionId(reg.id)
    try {
      const res  = await fetch('/api/auth/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: reg.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Approval failed')
      showToast(`✅ Invite sent to ${reg.email}`)
      setPending(prev => prev.filter(r => r.id !== reg.id))
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`)
    } finally { setActionId(null) }
  }

  const handleReject = async () => {
    if (!rejectId) return
    setActionId(rejectId)
    try {
      const res = await fetch('/api/auth/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: rejectId, reject: true, reason: rejectNote }),
      })
      if (!res.ok) throw new Error('Rejection failed')
      showToast('Registration rejected.')
      setPending(prev => prev.filter(r => r.id !== rejectId))
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`)
    } finally { setActionId(null); setRejectId(null); setRejectNote('') }
  }

  const handleRoleChange = async (id: string, role: string) => {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (!error) { setEmployees(prev => prev.map(e => e.id === id ? { ...e, role } : e)); showToast('Role updated') }
  }

  const handleStatusToggle = async (emp: Employee) => {
    const newStatus = emp.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('profiles').update({ status: newStatus }).eq('id', emp.id)
    if (!error) {
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, status: newStatus } : e))
      showToast(`${emp.full_name} is now ${newStatus}`)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="User Management" subtitle="Approve registrations and manage employee access" />

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl text-sm">
          {toast}
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-slate-900 mb-2">Reject Registration</h3>
            <p className="text-sm text-slate-500 mb-4">Optional reason (logged internally):</p>
            <textarea rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder="Reason for rejection…"
              className="w-full border border-slate-200 rounded-lg p-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectId(null); setRejectNote('') }}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
              <button onClick={handleReject} disabled={!!actionId}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition">Reject</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-100 shadow-sm w-fit">
          {([['pending','Pending Approvals'], ['employees','All Employees']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'pending' ? <Clock size={14} /> : <Users size={14} />}
              {label}
              {t === 'pending' && pending.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{pending.length}</span>
              )}
              {t === 'employees' && <span className="opacity-50 text-xs">({employees.length})</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'pending' ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            {pending.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <UserCheck size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No pending registrations</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Name','Email','Phone','Designation','Department','Requested','Actions'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pending.map(reg => (
                      <tr key={reg.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-4 font-semibold text-slate-900 whitespace-nowrap">{reg.full_name}</td>
                        <td className="px-4 py-4 text-slate-600">{reg.email}</td>
                        <td className="px-4 py-4 text-slate-600">{reg.phone ?? '—'}</td>
                        <td className="px-4 py-4 text-slate-600 whitespace-nowrap">{reg.designation ?? '—'}</td>
                        <td className="px-4 py-4 text-slate-600 whitespace-nowrap">{reg.department ?? '—'}</td>
                        <td className="px-4 py-4 text-slate-400 text-xs whitespace-nowrap">
                          {new Date(reg.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleApprove(reg)} disabled={actionId === reg.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                              {actionId === reg.id
                                ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                                : <UserCheck size={13} />}
                              Approve
                            </button>
                            <button onClick={() => setRejectId(reg.id)} disabled={!!actionId}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-100 border border-red-100 disabled:opacity-50 transition">
                              <UserX size={13} /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {['Name','Email','Designation','Role','Status','Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-700 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {emp.full_name[0]?.toUpperCase()}
                          </div>
                          <p className="font-semibold text-slate-900 whitespace-nowrap">{emp.full_name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{emp.email}</td>
                      <td className="px-4 py-4 text-slate-600 whitespace-nowrap">{emp.designation ?? '—'}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <Shield size={12} className={emp.role === 'admin' ? 'text-purple-500' : emp.role === 'task_manager' ? 'text-blue-500' : 'text-slate-400'} />
                          <select value={emp.role} onChange={e => handleRoleChange(emp.id, e.target.value)}
                            className="text-xs bg-transparent text-slate-700 border-none focus:outline-none cursor-pointer">
                            <option value="employee">Employee</option>
                            <option value="task_manager">Task Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {emp.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button onClick={() => handleStatusToggle(emp)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${emp.status === 'active' ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-100'}`}>
                          {emp.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
