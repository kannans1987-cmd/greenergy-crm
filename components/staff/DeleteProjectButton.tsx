'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// CEO only: delete a project that has no numbered job card (wrong, test or duplicate entries).
// The database refuses projects with a job card or a quotation, and keeps a snapshot in the audit log.

type Preview = { can_delete: boolean; team: number; field_job_cards: number; field_entries: number; milestones: number
  payments_paid: number; documents: number; tasks: number; attendance_days: number }

export default function DeleteProjectButton({ id, label }: { id: string; label: string }) {
  const supabase = createClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Preview | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const friendly = (m: string) => /delete_project|project_delete_preview|schema cache/i.test(m)
    ? 'The database update for deleting projects has not been run yet (supabase/project_delete_v1.sql).' : m

  const start = async () => {
    setErr(''); setReason(''); setInfo(null); setOpen(true)
    const { data, error } = await supabase.rpc('project_delete_preview', { p_project: id })
    if (error) setErr(friendly(error.message)); else setInfo(data as Preview)
  }

  const remove = async () => {
    if (!reason.trim()) { setErr('Give a short reason, e.g. test entry, duplicate, customer cancelled before order.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('delete_project', { p_project: id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { setErr(friendly(error.message)); return }
    router.push('/staff/projects'); router.refresh()
  }

  const lines = info ? [
    [info.team, 'team member assignment'], [info.field_job_cards, 'field job card'], [info.field_entries, 'field entry (materials / daily log)'],
    [info.milestones, 'milestone'], [info.payments_paid, 'payment marked paid'], [info.documents, 'document'],
  ].filter(([n]) => Number(n) > 0) as [number, string][] : []

  return (
    <>
      <button onClick={start} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 print:hidden">
        <Trash2 size={13} /> Delete project</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-3">
            <h3 className="font-bold text-slate-900">Delete {label}?</h3>
            {!info && !err && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking what belongs to it…</p>}
            {info && !info.can_delete && <p className="text-sm text-red-700">This project has a numbered job card or a quotation and cannot be deleted.</p>}
            {info?.can_delete && (<>
              <p className="text-sm text-slate-600">This cannot be undone.{lines.length ? ' These are deleted with it:' : ' Nothing else is attached to it.'}</p>
              {lines.length > 0 && <ul className="text-sm text-slate-700 list-disc pl-5">{lines.map(([n, t]) => <li key={t}>{n} {t}{n > 1 ? 's' : ''}</li>)}</ul>}
              {(info.tasks > 0 || info.attendance_days > 0) && (
                <p className="text-xs text-slate-500">Kept: {info.tasks ? `${info.tasks} task${info.tasks > 1 ? 's' : ''}` : ''}{info.tasks && info.attendance_days ? ' and ' : ''}
                  {info.attendance_days ? `${info.attendance_days} attendance day${info.attendance_days > 1 ? 's' : ''}` : ''} (no longer linked to a project).</p>
              )}
              {info.field_entries > 0 && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Field staff have recorded work on this project. Make sure it really is a wrong entry.</p>}
              <label className="block"><span className="text-xs font-medium text-slate-600">Reason *</span>
                <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} autoFocus
                  placeholder="e.g. test entry / duplicate / cancelled before order"
                  className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" /></label>
              <p className="text-[11px] text-slate-400">A copy of the project and the reason are kept in the audit log.</p>
            </>)}
            {err && <p className="text-sm text-red-700">{err}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              {info?.can_delete && <button onClick={remove} disabled={busy}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete project'}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
