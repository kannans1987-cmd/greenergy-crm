'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { Calendar, Plus, Clock, CheckCircle, XCircle, ChevronDown } from 'lucide-react'

interface Leave {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  reviewer: { full_name: string } | null
  employee: { full_name: string } | null
}

const LEAVE_TYPES = ['annual', 'sick', 'casual', 'emergency', 'unpaid']

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700 border-amber-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
}

function diffDays(start: string, end: string) {
  const s = new Date(start), e = new Date(end)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
}

export default function LeavePage() {
  const supabase   = createClient()
  const [profile,  setProfile]  = useState<{ id: string; role: string } | null>(null)
  const [leaves,   setLeaves]   = useState<Leave[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('mine')

  const [form, setForm] = useState({
    leave_type: 'annual', start_date: '', end_date: '', reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg,  setSubmitMsg]  = useState('')

  // Review state (manager/admin)
  const [reviewing,   setReviewing]   = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  const loadLeaves = useCallback(async (uid: string, role: string) => {
    let q = supabase
      .from('leaves')
      .select('id,leave_type,start_date,end_date,reason,status,reviewed_by,reviewed_at,review_notes,created_at,reviewer:reviewed_by(full_name),employee:employee_id(full_name)')
      .order('created_at', { ascending: false })

    if (role === 'employee' || activeTab === 'mine') {
      q = q.eq('employee_id', uid)
    }

    const { data } = await q
    if (data) setLeaves(data as unknown as Leave[])
    setLoading(false)
  }, [activeTab])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: prof } = await supabase.from('profiles').select('id,role').eq('id', user.id).single()
      if (prof) setProfile(prof as { id: string; role: string })
      await loadLeaves(user.id, (prof as { id: string; role: string })?.role ?? 'employee')
    }
    init()
  }, [loadLeaves])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('leaves').insert({
      employee_id: user.id,
      leave_type:  form.leave_type,
      start_date:  form.start_date,
      end_date:    form.end_date,
      reason:      form.reason,
      status:      'pending',
    })

    if (error) {
      setSubmitMsg('Error submitting leave: ' + error.message)
    } else {
      setSubmitMsg('Leave application submitted successfully!')
      setForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' })
      setShowForm(false)
      await loadLeaves(user.id, profile?.role ?? 'employee')
    }
    setSubmitting(false)
  }

  const handleReview = async (leaveId: string, action: 'approved' | 'rejected') => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('leaves').update({
      status:       action,
      reviewed_by:  user.id,
      reviewed_at:  new Date().toISOString(),
      review_notes: reviewNotes || null,
    }).eq('id', leaveId)

    setLeaves(prev => prev.map(l =>
      l.id === leaveId ? { ...l, status: action, review_notes: reviewNotes || null } : l
    ))
    setReviewing(null)
    setReviewNotes('')
  }

  const isManager = profile?.role !== 'employee'

  const displayLeaves = isManager && activeTab === 'all' ? leaves : leaves

  const counts = {
    pending:  leaves.filter(l => l.status === 'pending').length,
    approved: leaves.filter(l => l.status === 'approved').length,
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header
        title="Leave Management"
        subtitle={isManager ? 'Review and manage team leave requests' : 'Apply for and track your leave'}
      />

      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-5">

        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2">
            {isManager && (
              <>
                <button
                  onClick={() => setActiveTab('mine')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'mine' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                  My Leaves
                </button>
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                  All Team {counts.pending > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded-full">{counts.pending}</span>}
                </button>
              </>
            )}
            {!isManager && (
              <div className="flex gap-3 text-xs text-slate-500">
                <span className="bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                  Pending: <strong>{counts.pending}</strong>
                </span>
                <span className="bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                  Approved: <strong>{counts.approved}</strong>
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition shadow-sm"
          >
            <Plus size={16} /> Apply Leave
          </button>
        </div>

        {/* Success message */}
        {submitMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
            <CheckCircle size={16} />
            {submitMsg}
          </div>
        )}

        {/* Leave Application Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900 text-sm mb-4 flex items-center gap-2">
              <Calendar size={16} className="text-green-600" /> New Leave Application
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={form.leave_type}
                  onChange={e => setForm(p => ({ ...p, leave_type: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {LEAVE_TYPES.map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} Leave</option>
                  ))}
                </select>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Start Date</label>
                  <input
                    type="date" required value={form.start_date}
                    min={format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">End Date</label>
                  <input
                    type="date" required value={form.end_date}
                    min={form.start_date || format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              {form.start_date && form.end_date && (
                <p className="text-xs text-slate-500">
                  Duration: <strong>{diffDays(form.start_date, form.end_date)} day{diffDays(form.start_date, form.end_date) > 1 ? 's' : ''}</strong>
                </p>
              )}
              <textarea
                required rows={3} value={form.reason}
                onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                placeholder="Reason for leave *"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                  {submitting ? 'Submitting…' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Leave List */}
        <div className="space-y-3">
          {displayLeaves.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center">
              <Calendar size={40} className="mx-auto mb-3 text-slate-200" />
              <p className="text-slate-400 text-sm">No leave applications found.</p>
            </div>
          ) : displayLeaves.map(leave => (
            <div key={leave.id} className="bg-white rounded-xl border border-slate-100 shadow-sm">
              <div
                className="p-4 cursor-pointer flex items-start justify-between gap-3"
                onClick={() => setExpanded(expanded === leave.id ? null : leave.id)}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="mt-0.5">
                    {leave.status === 'approved'
                      ? <CheckCircle size={18} className="text-green-500 shrink-0" />
                      : leave.status === 'rejected'
                        ? <XCircle size={18} className="text-red-400 shrink-0" />
                        : <Clock size={18} className="text-amber-500 shrink-0" />
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 capitalize">
                        {leave.leave_type} Leave
                      </p>
                      <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[leave.status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {leave.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {format(new Date(leave.start_date), 'dd MMM yyyy')}
                      {leave.start_date !== leave.end_date && ` → ${format(new Date(leave.end_date), 'dd MMM yyyy')}`}
                      <span className="ml-2 text-slate-400">({diffDays(leave.start_date, leave.end_date)} day{diffDays(leave.start_date, leave.end_date) > 1 ? 's' : ''})</span>
                    </p>
                    {isManager && leave.employee && (
                      <p className="text-xs text-slate-400 mt-0.5">👤 {leave.employee.full_name}</p>
                    )}
                  </div>
                </div>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 shrink-0 transition-transform ${expanded === leave.id ? 'rotate-180' : ''}`}
                />
              </div>

              {expanded === leave.id && (
                <div className="border-t border-slate-100 p-4 space-y-3">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-medium text-slate-600 mb-1">Reason</p>
                    <p className="text-sm text-slate-700">{leave.reason}</p>
                  </div>

                  {leave.review_notes && (
                    <div className={`rounded-lg p-3 ${leave.status === 'approved' ? 'bg-green-50' : 'bg-red-50'}`}>
                      <p className="text-xs font-medium mb-1">Manager Notes</p>
                      <p className="text-sm">{leave.review_notes}</p>
                      {leave.reviewer && (
                        <p className="text-xs text-slate-400 mt-1">— {leave.reviewer.full_name}</p>
                      )}
                    </div>
                  )}

                  {/* Manager review actions */}
                  {isManager && leave.status === 'pending' && (
                    <div className="border-t border-slate-100 pt-3 space-y-3">
                      {reviewing === leave.id ? (
                        <>
                          <textarea
                            rows={2} value={reviewNotes}
                            onChange={e => setReviewNotes(e.target.value)}
                            placeholder="Add review notes (optional)…"
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleReview(leave.id, 'approved')}
                              className="flex-1 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReview(leave.id, 'rejected')}
                              className="flex-1 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => { setReviewing(null); setReviewNotes('') }}
                              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => setReviewing(leave.id)}
                          className="w-full py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition"
                        >
                          Review this Request
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
