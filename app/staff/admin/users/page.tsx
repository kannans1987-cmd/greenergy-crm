'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import Avatar from '@/components/staff/Avatar'
import { setStaffPhoto, removeStaffPhoto, announceMyPhoto } from '@/lib/staff-photo'
import { UserCheck, UserX, Shield, Users, Clock, KeyRound, Trash2 } from 'lucide-react'

interface Registration {
  id: string; full_name: string; email: string; phone: string | null
  designation: string | null; department: string | null
  date_of_joining: string | null; created_at: string; status: string
}
interface Employee {
  id: string; full_name: string; email: string; role: string
  designation: string | null; department: string | null; status: string
  price_access: string | null
  quotation_access?: boolean
  quotation_view?: boolean
  allocation_level?: 'senior' | 'junior' | null
  avatar_url?: string | null
  super_admin?: boolean
}
type Tab = 'pending' | 'employees'
const ROLE_LABEL: Record<string, string> = {
  employee: 'Staff (sales / field)', jr_admin: 'Jr Admin Manager', sr_admin: 'Sr Admin Manager',
  task_manager: 'Admin manager (full access)', super_admin: 'Super Admin (all CEO powers)', admin: 'CEO (admin)',
}
// What each role means, shown before the change is confirmed
const ROLE_MEANS: Record<string, string> = {
  employee: 'Works on the tasks, quotations and jobs given to them.',
  jr_admin: 'Allocates work (tasks, quotation people, service jobs) to anyone except a Sr Admin Manager. Sees all quotations but not supplier cost or margin; changes to a quotation go to you for approval.',
  sr_admin: 'Allocates work to anyone, and gives the first-level approval of leave (you give the final approval). Sees all quotations but not supplier cost or margin; changes to a quotation go to you for approval.',
  task_manager: 'Full access: sees supplier cost and margin, edits every quotation directly, allocates work to anyone and gives first-level leave approval.',
  super_admin: 'Everything the CEO can do: see everything, approve quotations, change prices and margin, manage users. But: cannot change, deactivate or delete the CEO, cannot make anyone CEO or Super Admin, and every change they make is flagged to you (Super Admin activity). Like the CEO, they do not clock in.',
  admin: 'A CEO (admin) can see everything, approve quotations, change prices and manage all users, including the Super Admin.',
}
// The role as picked in the dropdown (Sr / Jr are staff with an allocation level)
const roleKey = (e: { role: string; allocation_level?: string | null; super_admin?: boolean }) =>
  e.role === 'employee' && e.allocation_level === 'senior' ? 'sr_admin' : e.role === 'employee' && e.allocation_level === 'junior' ? 'jr_admin'
    : e.role === 'admin' && e.super_admin ? 'super_admin' : e.role

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
  // "Login link" dialog: correct the email if needed, then email / copy / WhatsApp a set-password link
  const [access,    setAccess]   = useState<{ emp: Employee; email: string; busy: boolean; link?: string; emailed?: boolean; sentTo?: string; error?: string } | null>(null)

  const [meId,      setMeId]     = useState<string | null>(null)
  const [toDelete,  setToDelete] = useState<Employee | null>(null)
  const [deleting,  setDeleting] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }
  // CEO: set or remove anyone's photo
  const [photoBusy, setPhotoBusy] = useState<string | null>(null)
  const handlePhoto = async (emp: Employee, file?: File | null) => {
    if (!file) return
    setPhotoBusy(emp.id)
    try {
      const url = await setStaffPhoto(supabase, emp.id, file)
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, avatar_url: url } : e))
      if (emp.id === meId) announceMyPhoto(url)
      showToast(`✅ Photo saved for ${emp.full_name}`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Could not save the photo'}`) }
    finally { setPhotoBusy(null) }
  }
  const handleRemovePhoto = async (emp: Employee) => {
    if (!window.confirm(`Remove the photo of ${emp.full_name}?`)) return
    setPhotoBusy(emp.id)
    try {
      await removeStaffPhoto(supabase, emp.id)
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, avatar_url: null } : e))
      if (emp.id === meId) announceMyPhoto(null)
      showToast(`Photo removed for ${emp.full_name}`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
    finally { setPhotoBusy(null) }
  }

  // Role, status and delete go through the server (CEO only), which also blocks or unblocks the login
  const manage = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/auth/staff-manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed')
    return data
  }

  const loadData = useCallback(async () => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null))
    const [{ data: regs }, { data: emps }] = await Promise.all([
      supabase.from('employee_registrations').select('*').eq('status','pending').order('created_at'),
      supabase.from('profiles').select('*').order('full_name'),
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
      if (data.link) setAccess({ emp: { id: '', full_name: reg.full_name, email: reg.email, role: 'employee', designation: null, department: null, status: 'active', price_access: null },
        email: reg.email, busy: false, link: data.link, emailed: data.emailed, sentTo: reg.email })
      else showToast(`✅ Invite sent to ${reg.email}`)
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

  // Who may edit the supplier price list (and optionally the margin) besides the CEO
  const handlePriceAccess = async (id: string, value: string) => {
    const price_access = value || null
    const { error } = await supabase.from('profiles').update({ price_access }).eq('id', id)
    if (error) { showToast(error.message); return }
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, price_access } : e))
    showToast(price_access ? 'Price list access given' : 'Price list access removed')
  }

  // "Quotations: edit & delete" — see and edit every quotation, delete wrong ones
  const handleQuotationAccess = async (emp: Employee, on: boolean) => {
    try {
      await manage({ user_id: emp.id, action: 'quotation_access', value: on })
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, quotation_access: on } : e))
      showToast(on ? `✅ ${emp.full_name} can now edit and delete quotations` : `${emp.full_name} can no longer delete quotations`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
  }

  // "Quotations: view all" — see every quotation and log enquiries; changes need the CEO's approval
  const handleQuotationView = async (emp: Employee, on: boolean) => {
    try {
      await manage({ user_id: emp.id, action: 'quotation_view', value: on })
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, quotation_view: on } : e))
      showToast(on ? `✅ ${emp.full_name} can now see all quotations and log enquiries (changes need your approval)` : `${emp.full_name} now sees only their own quotations`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
  }

  // Super Admin signed in: the CEO's (and other Super Admins') rows are read only, and CEO / Super Admin cannot be given
  const meSuper = !!employees.find(e => e.id === meId)?.super_admin
  const lockedRow = (emp: Employee) => meSuper && emp.role === 'admin' && emp.id !== meId

  const handleRoleChange = async (emp: Employee, role: string) => {
    const cur = roleKey(emp)
    if (role === cur) return
    if (!window.confirm(`Change the role of ${emp.full_name} from "${ROLE_LABEL[cur] ?? cur}" to "${ROLE_LABEL[role]}"?\n\n${ROLE_MEANS[role] ?? ''}`)) {
      setEmployees(prev => [...prev]) // put the dropdown back
      return
    }
    try {
      await manage({ user_id: emp.id, action: 'role', role })
      const lv = role === 'sr_admin' ? 'senior' as const : role === 'jr_admin' ? 'junior' as const : null
      const title = lv === 'senior' ? 'Sr Admin Manager' : lv === 'junior' ? 'Jr Admin Manager' : null
      setEmployees(prev => prev.map(e => e.id === emp.id ? {
        ...e, role: lv ? 'employee' : role === 'super_admin' ? 'admin' : role, allocation_level: lv, super_admin: role === 'super_admin',
        designation: title ?? (['Sr Admin Manager', 'Jr Admin Manager'].includes(e.designation ?? '') ? (role === 'task_manager' ? 'Admin Manager' : null) : e.designation),
      } : e))
      showToast(`✅ ${emp.full_name} is now ${ROLE_LABEL[role]}`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
  }

  const handleStatusToggle = async (emp: Employee) => {
    const newStatus = emp.status === 'active' ? 'inactive' : 'active'
    if (newStatus === 'inactive' && !window.confirm(`Deactivate ${emp.full_name}? They will not be able to sign in until you activate them again.`)) return
    try {
      await manage({ user_id: emp.id, action: 'status', status: newStatus })
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, status: newStatus } : e))
      showToast(`${emp.full_name} is now ${newStatus}`)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      const data = await manage({ user_id: toDelete.id, action: 'delete' })
      if (data.deleted) {
        setEmployees(prev => prev.filter(e => e.id !== toDelete.id))
        showToast(`🗑 ${toDelete.full_name} has been deleted`)
      } else {
        setEmployees(prev => prev.map(e => e.id === toDelete.id ? { ...e, status: 'inactive', price_access: null } : e))
        showToast(`${toDelete.full_name} has been removed: login blocked, their records kept`)
      }
      setToDelete(null)
    } catch (err: unknown) { showToast(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
    finally { setDeleting(false) }
  }

  const handleLoginLink = async () => {
    if (!access) return
    setAccess({ ...access, busy: true, error: undefined })
    try {
      const res = await fetch('/api/auth/staff-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: access.emp.id, new_email: access.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setAccess(a => a && { ...a, busy: false, link: data.link, emailed: data.emailed, sentTo: data.email })
      if (data.email !== access.emp.email) setEmployees(prev => prev.map(e => e.id === access.emp.id ? { ...e, email: data.email } : e))
    } catch (err: unknown) {
      setAccess(a => a && { ...a, busy: false, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  const waText = (a: NonNullable<typeof access>) =>
    `Hello ${a.emp.full_name}, here is your Greenergy staff login link. Open it within 1 hour to set your password, then sign in with ${a.sentTo}:
${a.link}`

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="User Management" subtitle="Approve registrations and manage employee access" />

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl text-sm">
          {toast}
        </div>
      )}

      {/* Login link modal */}
      {access && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-slate-900 mb-1">Login link for {access.emp.full_name}</h3>
            {!access.link ? (<>
              <p className="text-sm text-slate-500 mb-4">Check the login email is spelt correctly (you can correct it here), then create a one-time link to set a password.</p>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Login email</label>
              <input type="email" value={access.email} onChange={e => setAccess({ ...access, email: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
              {access.email.trim().toLowerCase() !== access.emp.email.toLowerCase() && (
                <p className="text-xs text-amber-700 mb-2">The login email will change from {access.emp.email} to {access.email.trim().toLowerCase()}.</p>)}
              {access.error && <p className="text-xs text-red-600 mb-2">⚠ {access.error}</p>}
              <div className="flex gap-2 justify-end mt-3">
                <button onClick={() => setAccess(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
                <button onClick={handleLoginLink} disabled={access.busy}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                  {access.busy ? 'Creating…' : 'Create login link'}</button>
              </div>
            </>) : (<>
              <p className={`text-sm mb-3 ${access.emailed ? 'text-green-700' : 'text-amber-700'}`}>
                {access.emailed ? `✅ Emailed to ${access.sentTo}. You can also send it on WhatsApp.` : `Email is not set up, so send this link to ${access.sentTo} on WhatsApp.`}
              </p>
              <textarea readOnly rows={3} value={access.link} onFocus={e => e.target.select()}
                className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-600 mb-2 resize-none" />
              <p className="text-xs text-slate-500 mb-4">Works once, for 1 hour. They choose a password, then sign in with {access.sentTo}.</p>
              <div className="flex flex-wrap gap-2 justify-end">
                <button onClick={() => { navigator.clipboard.writeText(access.link!); showToast('Link copied') }}
                  className="px-4 py-2 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition">Copy link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(waText(access))}`} target="_blank" rel="noreferrer"
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition">WhatsApp</a>
                <button onClick={() => setAccess(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">Close</button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* Delete modal */}
      {toDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-slate-900 mb-2">Delete {toDelete.full_name}?</h3>
            <p className="text-sm text-slate-600 mb-2">{toDelete.email} · {ROLE_LABEL[toDelete.role] ?? toDelete.role}</p>
            <ul className="text-sm text-slate-500 list-disc pl-5 space-y-1 mb-5">
              <li>They can no longer sign in, straight away.</li>
              <li>If they have no work in the CRM yet, the account is deleted completely.</li>
              <li>If quotations, tasks, attendance or projects carry their name, those records are <b>kept</b> and the login is blocked for good (shown as inactive).</li>
            </ul>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setToDelete(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition">
                {deleting ? 'Deleting…' : 'Delete user'}</button>
            </div>
          </div>
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
                    {['Name','Email','Designation','Role','Allocates work','Price list access','Quotations','Status','Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <label className={`relative shrink-0 ${lockedRow(emp) ? 'pointer-events-none' : 'cursor-pointer'}`} title={emp.avatar_url ? `Change the photo of ${emp.full_name}` : `Add a photo of ${emp.full_name}`}>
                            <Avatar name={emp.full_name} url={emp.avatar_url} size={40} className={photoBusy === emp.id ? 'opacity-40' : ''} />
                            {!emp.avatar_url && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border border-slate-200 text-[10px] leading-none flex items-center justify-center text-slate-600">+</span>}
                            <input type="file" accept="image/*" className="sr-only" disabled={photoBusy === emp.id}
                              onChange={e => { handlePhoto(emp, e.target.files?.[0]); e.target.value = '' }} aria-label={`Photo of ${emp.full_name}`} />
                          </label>
                          <div>
                            <p className="font-semibold text-slate-900 whitespace-nowrap">{emp.full_name}</p>
                            {emp.role === 'admin' && <p className={`text-[10px] font-semibold ${emp.super_admin ? 'text-indigo-600' : 'text-purple-600'}`}>{emp.super_admin ? 'SUPER ADMIN' : 'CEO'}</p>}
                            {emp.avatar_url && !lockedRow(emp) && <button onClick={() => handleRemovePhoto(emp)} className="text-[11px] text-slate-400 hover:text-red-600">Remove photo</button>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{emp.email}</td>
                      <td className="px-4 py-4 text-slate-600 whitespace-nowrap">{emp.designation ?? '—'}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <Shield size={12} className={emp.role === 'admin' ? 'text-purple-500' : emp.role === 'task_manager' ? 'text-blue-500' : emp.allocation_level ? 'text-green-600' : 'text-slate-400'} />
                          <select value={roleKey(emp)} onChange={e => handleRoleChange(emp, e.target.value)} disabled={emp.id === meId || lockedRow(emp)} title={ROLE_MEANS[roleKey(emp)]}
                            aria-label={`Role of ${emp.full_name}`}
                            className="text-xs bg-transparent text-slate-700 border border-slate-200 rounded px-1 py-0.5 focus:outline-none cursor-pointer disabled:cursor-default disabled:border-transparent">
                            <option value="employee">Staff (sales / field)</option>
                            <option value="jr_admin">Jr Admin Manager</option>
                            <option value="sr_admin">Sr Admin Manager</option>
                            <option value="task_manager">Admin manager (full access)</option>
                            <option value="super_admin" disabled={meSuper}>Super Admin (all CEO powers)</option>
                            <option value="admin" disabled={meSuper}>CEO (admin)</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-xs text-slate-600">{
                          emp.role === 'admin' || emp.role === 'task_manager' || emp.allocation_level === 'senior' ? 'Anyone'
                          : emp.allocation_level === 'junior' ? 'Anyone except Sr Admin Manager' : '—'}</span>
                      </td>
                      <td className="px-4 py-4">
                        {emp.role === 'admin' ? <span className="text-xs text-slate-500">Full (CEO)</span> : (
                          <select value={emp.price_access ?? ''} onChange={e => handlePriceAccess(emp.id, e.target.value)} aria-label={`Price list access for ${emp.full_name}`}
                            className="text-xs bg-transparent text-slate-700 border border-slate-200 rounded px-1 py-0.5 cursor-pointer">
                            <option value="">None</option>
                            <option value="prices">Supplier prices</option>
                            <option value="prices_and_margin">Prices &amp; margin</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {emp.role === 'admin' ? <span className="text-xs text-slate-500">Full (CEO)</span> : (
                          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer whitespace-nowrap" title="See and edit every quotation, and delete wrong ones">
                            <input type="checkbox" checked={!!emp.quotation_access} onChange={e => handleQuotationAccess(emp, e.target.checked)}
                              className="accent-green-600" aria-label={`Quotations edit and delete for ${emp.full_name}`} />
                            Edit &amp; delete
                          </label>
                        )}
                        {emp.role === 'employee' && !emp.quotation_access && (
                          <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer whitespace-nowrap" title="See every quotation and log phone enquiries. Changes are sent to you for approval.">
                            <input type="checkbox" checked={!!emp.quotation_view} onChange={e => handleQuotationView(emp, e.target.checked)}
                              className="accent-green-600" aria-label={`Quotations view all for ${emp.full_name}`} />
                            View all · changes need you
                          </label>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {emp.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {emp.id === meId ? <span className="text-xs text-slate-400">You</span> : lockedRow(emp) ? <span className="text-xs text-slate-400">Only the CEO can change</span> : (
                        <div className="flex items-center gap-2">
                        <button onClick={() => setAccess({ emp, email: emp.email, busy: false })} title="Correct the login email or send a set-password link"
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition whitespace-nowrap">
                          <KeyRound size={12} /> Login link
                        </button>
                        <button onClick={() => handleStatusToggle(emp)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${emp.status === 'active' ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-100'}`}>
                          {emp.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => setToDelete(emp)} title={`Delete ${emp.full_name}`} aria-label={`Delete ${emp.full_name}`}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition">
                          <Trash2 size={14} />
                        </button>
                        </div>)}
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
