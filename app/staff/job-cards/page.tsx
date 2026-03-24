'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import Link from 'next/link'
import { FileText, Clock, CheckCircle, ChevronDown, ArrowRight } from 'lucide-react'
import { format } from 'date-fns'

interface JobCard {
  id: string; job_card_number: string; role_in_project: string | null
  start_date: string | null; end_date: string | null; total_manhours: number
  daily_notes: string | null; status: string; signoff_by: string | null; signoff_at: string | null
  projects: { name: string; project_number: string; site_address: string | null } | null
  employee: { full_name: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700',
}

export default function JobCardsPage() {
  const supabase  = createClient()
  const [cards,   setCards]   = useState<JobCard[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded,setExpanded]= useState<string | null>(null)
  const [notes,   setNotes]   = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState<string | null>(null)
  const [profile, setProfile] = useState<{ id: string; role: string } | null>(null)

  const loadCards = useCallback(async (uid: string, role: string) => {
    let q = supabase.from('job_cards').select(
      'id,job_card_number,role_in_project,start_date,end_date,total_manhours,daily_notes,status,signoff_by,signoff_at,projects(name,project_number,site_address),employee:employee_id(full_name)'
    ).order('created_at', { ascending: false })
    if (role === 'employee') q = q.eq('employee_id', uid)
    const { data } = await q
    if (data) {
      setCards(data as unknown as JobCard[])
      const init: Record<string, string> = {}
      ;(data as unknown as JobCard[]).forEach(c => { init[c.id] = c.daily_notes ?? '' })
      setNotes(init)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: prof } = await supabase.from('profiles').select('id,role').eq('id', user.id).single()
      if (prof) setProfile(prof as { id: string; role: string })
      await loadCards(user.id, (prof as { id: string; role: string })?.role ?? 'employee')
    }
    init()
  }, [loadCards])

  const handleSaveNotes = async (cardId: string) => {
    setSaving(cardId)
    await supabase.from('job_cards').update({ daily_notes: notes[cardId], updated_at: new Date().toISOString() }).eq('id', cardId)
    setSaving(null)
  }

  const handleSignOff = async (cardId: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('job_cards').update({
      status: 'completed', signoff_by: user.id,
      signoff_at: new Date().toISOString(),
      end_date: new Date().toISOString().split('T')[0],
    }).eq('id', cardId).select().single()
    if (data) setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...(data as JobCard) } : c))
  }

  const isManager = profile?.role !== 'employee'

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Job Cards" subtitle={isManager ? 'All employee project work records' : 'Your project work records'} />
      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-4">

        {cards.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-16 text-center">
            <FileText size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">No job cards yet.</p>
            <p className="text-slate-300 text-xs mt-1">Job cards are created automatically when assigned to a project.</p>
          </div>
        ) : cards.map(card => (
          <div key={card.id} className={`bg-white rounded-xl border shadow-sm transition-all ${card.status === 'completed' ? 'border-blue-100' : 'border-slate-100'}`}>
            <div className="p-5 flex items-start justify-between gap-3">
              <div
                className="flex items-start gap-3 flex-1 cursor-pointer"
                onClick={() => setExpanded(expanded === card.id ? null : card.id)}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${card.status === 'completed' ? 'bg-blue-100' : 'bg-green-100'}`}>
                  {card.status === 'completed'
                    ? <CheckCircle size={18} className="text-blue-600" />
                    : <FileText size={18} className="text-green-600" />}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-slate-900 text-sm">{card.projects?.name ?? 'Unknown Project'}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[card.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {card.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">{card.job_card_number}</p>
                  {isManager && card.employee && <p className="text-xs text-slate-500 mt-0.5">👤 {card.employee.full_name}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Clock size={10} /> {card.total_manhours.toFixed(1)} hrs</span>
                    {card.role_in_project && <span>🔧 {card.role_in_project}</span>}
                    {card.start_date && <span>📅 {format(new Date(card.start_date), 'dd MMM yy')}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/staff/job-cards/${card.id}`}
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 text-green-700 text-[11px] font-semibold rounded-lg hover:bg-green-100 transition"
                >
                  View Progress <ArrowRight size={11} />
                </Link>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 cursor-pointer transition-transform ${expanded === card.id ? 'rotate-180' : ''}`}
                  onClick={() => setExpanded(expanded === card.id ? null : card.id)}
                />
              </div>
            </div>

            {expanded === card.id && (
              <div className="border-t border-slate-100 p-5 space-y-4">
                {card.projects?.site_address && <p className="text-xs text-slate-500">📍 {card.projects.site_address}</p>}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Hours', value: `${card.total_manhours.toFixed(1)}h` },
                    { label: 'Start Date',  value: card.start_date ? format(new Date(card.start_date), 'dd MMM yy') : '—' },
                    { label: 'End Date',    value: card.end_date   ? format(new Date(card.end_date),   'dd MMM yy') : 'Ongoing' },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-slate-900 font-bold text-sm">{item.value}</p>
                      <p className="text-slate-400 text-[10px] mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>

                {card.status === 'active' && (
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1.5 block">Daily Work Notes</label>
                    <textarea rows={3} value={notes[card.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [card.id]: e.target.value }))}
                      placeholder="Add notes about today's work, materials, issues…"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
                    <div className="flex justify-end mt-2">
                      <button onClick={() => handleSaveNotes(card.id)} disabled={saving === card.id}
                        className="px-4 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                        {saving === card.id ? 'Saving…' : 'Save Notes'}
                      </button>
                    </div>
                  </div>
                )}

                {card.status === 'completed' && card.daily_notes && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs font-medium text-slate-600 mb-1">Work Notes</p>
                    <p className="text-sm text-slate-700">{card.daily_notes}</p>
                  </div>
                )}

                {isManager && card.status === 'active' && (
                  <div className="border-t border-slate-100 pt-4">
                    <button onClick={() => handleSignOff(card.id)}
                      className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2">
                      <CheckCircle size={16} /> Sign Off & Mark Complete
                    </button>
                    <p className="text-xs text-slate-400 text-center mt-2">Records your sign-off with timestamp.</p>
                  </div>
                )}

                {card.status === 'completed' && card.signoff_at && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle size={14} className="text-blue-600 shrink-0" />
                    <p className="text-xs text-blue-700">Signed off on {format(new Date(card.signoff_at), 'dd MMM yyyy, hh:mm a')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
