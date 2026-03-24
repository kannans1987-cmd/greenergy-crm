'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { User, Phone, Briefcase, Calendar, Shield, CheckCircle, AlertTriangle } from 'lucide-react'

interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  designation: string | null
  department: string | null
  role: string
  status: string
  date_of_joining: string | null
  created_at: string
}

export default function ProfilePage() {
  const supabase  = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Password change form
  const [pwForm,    setPwForm]    = useState({ current: '', new: '', confirm: '' })
  const [pwMsg,     setPwMsg]     = useState('')
  const [pwMsgType, setPwMsgType] = useState<'success' | 'error'>('success')
  const [pwLoading, setPwLoading] = useState(false)
  const [showPw,    setShowPw]    = useState(false)

  // Profile edit
  const [editing,    setEditing]    = useState(false)
  const [editPhone,  setEditPhone]  = useState('')
  const [saveMsg,    setSaveMsg]    = useState('')
  const [saveLoading,setSaveLoading]= useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('id,full_name,email,phone,designation,department,role,status,date_of_joining,created_at')
        .eq('id', user.id).single()
      if (data) {
        setProfile(data as Profile)
        setEditPhone((data as Profile).phone ?? '')
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleSavePhone = async () => {
    if (!profile) return
    setSaveLoading(true)
    setSaveMsg('')
    const { error } = await supabase.from('profiles').update({ phone: editPhone || null }).eq('id', profile.id)
    if (error) {
      setSaveMsg('Failed to save: ' + error.message)
    } else {
      setProfile(prev => prev ? { ...prev, phone: editPhone || null } : prev)
      setSaveMsg('Profile updated successfully!')
      setEditing(false)
    }
    setSaveLoading(false)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.new !== pwForm.confirm) {
      setPwMsg('New passwords do not match.')
      setPwMsgType('error')
      return
    }
    if (pwForm.new.length < 8) {
      setPwMsg('New password must be at least 8 characters.')
      setPwMsgType('error')
      return
    }
    setPwLoading(true)
    setPwMsg('')
    const { error } = await supabase.auth.updateUser({ password: pwForm.new })
    if (error) {
      setPwMsg(error.message)
      setPwMsgType('error')
    } else {
      setPwMsg('Password changed successfully!')
      setPwMsgType('success')
      setPwForm({ current: '', new: '', confirm: '' })
    }
    setPwLoading(false)
  }

  const roleLabel: Record<string, string> = {
    admin:        'Administrator',
    task_manager: 'Task Manager',
    employee:     'Employee',
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!profile) return null

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="My Profile" subtitle="Your account details and settings" />

      <div className="flex-1 p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-5">

        {/* Profile Card */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Cover / Avatar */}
          <div className="h-20 bg-gradient-to-r from-green-700 to-green-500" />
          <div className="px-5 pb-5">
            <div className="flex items-end gap-4 -mt-8 mb-4">
              <div className="w-16 h-16 rounded-2xl bg-white border-4 border-white shadow-md flex items-center justify-center text-2xl font-bold text-green-700">
                {profile.full_name?.[0]?.toUpperCase()}
              </div>
              <div className="pb-1">
                <h2 className="text-lg font-bold text-slate-900">{profile.full_name}</h2>
                <p className="text-sm text-slate-500">{profile.designation ?? 'Staff Member'}</p>
              </div>
              <div className="ml-auto pb-1">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  profile.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {profile.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={User}     label="Full Name"   value={profile.full_name} />
              <InfoRow icon={Shield}   label="Role"        value={roleLabel[profile.role] ?? profile.role} />
              <InfoRow icon={Briefcase}label="Department"  value={profile.department ?? '—'} />
              <InfoRow icon={Briefcase}label="Designation" value={profile.designation ?? '—'} />
              {profile.date_of_joining && (
                <InfoRow icon={Calendar} label="Date of Joining"
                  value={format(new Date(profile.date_of_joining), 'dd MMMM yyyy')} />
              )}
              <InfoRow icon={Calendar} label="Member Since"
                value={format(new Date(profile.created_at), 'MMM yyyy')} />
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Phone size={16} className="text-green-600" /> Contact Information
            </h3>
            {!editing && (
              <button onClick={() => setEditing(true)}
                className="text-xs text-green-600 hover:text-green-700 font-semibold">
                Edit
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500">Email Address</label>
              <p className="text-sm text-slate-800 mt-0.5">{profile.email}</p>
              <p className="text-xs text-slate-400">Email cannot be changed</p>
            </div>
            <div>
              <label className="text-xs text-slate-500">Phone Number</label>
              {editing ? (
                <div className="mt-1 flex gap-2">
                  <input
                    type="tel" value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    placeholder="+91 99999 99999"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button onClick={handleSavePhone} disabled={saveLoading}
                    className="px-4 py-2 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                    {saveLoading ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditing(false); setEditPhone(profile.phone ?? '') }}
                    className="px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition">
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-800 mt-0.5">{profile.phone ?? '—'}</p>
              )}
              {saveMsg && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle size={12} /> {saveMsg}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Shield size={16} className="text-green-600" /> Change Password
            </h3>
            <button onClick={() => setShowPw(!showPw)}
              className="text-xs text-slate-500 hover:text-slate-700">
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>

          {showPw && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">New Password</label>
                <input
                  type="password" required value={pwForm.new} minLength={8}
                  onChange={e => setPwForm(p => ({ ...p, new: e.target.value }))}
                  placeholder="At least 8 characters"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Confirm New Password</label>
                <input
                  type="password" required value={pwForm.confirm}
                  onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                  placeholder="Repeat new password"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              {pwMsg && (
                <div className={`flex items-center gap-2 text-xs p-3 rounded-lg ${
                  pwMsgType === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                }`}>
                  {pwMsgType === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                  {pwMsg}
                </div>
              )}

              <button type="submit" disabled={pwLoading}
                className="w-full py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition disabled:opacity-50">
                {pwLoading ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className="text-green-600" />
      </div>
      <div>
        <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-800 font-medium">{value}</p>
      </div>
    </div>
  )
}
