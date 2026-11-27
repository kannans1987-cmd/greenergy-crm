'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format } from 'date-fns'
import { ShieldCheck, CheckCircle } from 'lucide-react'

// CEO only: everything the Super Admin changed (super_admin_v1.sql). Nobody can edit or delete these
// records; the CEO marks them reviewed.

interface Change {
  id: number; at: string; actor_name: string | null; table_name: string; row_id: string | null
  action: 'insert' | 'update' | 'delete' | 'action'; summary: string; changes: Record<string, unknown> | null
  reviewed_at: string | null
}

const ACTION: Record<Change['action'], [string, string]> = {
  insert: ['Added', 'bg-green-100 text-green-700'],
  update: ['Changed', 'bg-amber-100 text-amber-800'],
  delete: ['Deleted', 'bg-red-100 text-red-700'],
  action: ['Action', 'bg-indigo-100 text-indigo-700'],
}
// Technical columns that do not need the CEO's attention
const HIDE = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'search', 'version'])

const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 140 ? s.slice(0, 140) + '…' : s
}
const field = (k: string) => k.replace(/_/g, ' ')

function Details({ c }: { c: Change }) {
  const ch = c.changes ?? {}
  if (c.action === 'update') {
    const rows = Object.entries(ch) as [string, { from?: unknown; to?: unknown }][]
    return (
      <table className="mt-2 w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-3 text-slate-500 whitespace-nowrap">{field(k)}</td>
              <td className="py-1 pr-3 text-red-700 line-through break-all">{show(v?.from)}</td>
              <td className="py-1 text-green-800 break-all">{show(v?.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (c.action === 'action') return null
  const rows = Object.entries(ch).filter(([k, v]) => !HIDE.has(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {rows.slice(0, 25).map(([k, v]) => (
          <tr key={k} className="border-t border-slate-100 align-top">
            <td className="py-1 pr-3 text-slate-500 whitespace-nowrap">{field(k)}</td>
            <td className="py-1 text-slate-800 break-all">{show(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function SuperAdminActivityPage() {
  const supabase = createClient()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [rows, setRows] = useState<Change[]>([])
  const [tab, setTab] = useState<'open' | 'all'>('open')
  const [open, setOpen] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('super_admin_changes').select('*').order('at', { ascending: false }).limit(300)
    if (tab === 'open') q = q.is('reviewed_at', null)
    const { data, error } = await q
    if (error) setMsg(/super_admin_changes|does not exist|schema cache/i.test(error.message) ? 'This needs the latest database update (supabase/super_admin_v1.sql).' : error.message)
    setRows((data as Change[]) ?? [])
  }, [tab])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setAllowed(p?.role === 'admin' && !p?.super_admin)
    })
  }, [])
  useEffect(() => { if (allowed) load() }, [allowed, load])

  const review = async (ids: number[], done: boolean) => {
    if (!ids.length) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('super_admin_changes').update({ reviewed_at: done ? new Date().toISOString() : null }).in('id', ids)
    setBusy(false)
    if (error) { setMsg('❌ ' + error.message); return }
    if (done) await supabase.from('notifications').update({ is_read: true }).eq('type', 'super_admin').eq('is_read', false)
    load()
  }

  if (allowed === null) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!allowed) return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Super Admin activity" />
      <p className="p-6 text-sm text-slate-600">Only the CEO can see this page.</p>
    </div>
  )

  const openIds = rows.filter(r => !r.reviewed_at).map(r => r.id)
  const days = new Map<string, Change[]>()
  for (const r of rows) { const d = format(new Date(r.at), 'yyyy-MM-dd'); days.set(d, [...(days.get(d) ?? []), r]) }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Super Admin activity" subtitle="Every change made by a Super Admin. Only you can see this; it cannot be edited or deleted." />
      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            {([['open', 'To review'], ['all', 'All (last 300)']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${tab === k ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          {openIds.length > 0 && (
            <button onClick={() => review(openIds, true)} disabled={busy}
              className="px-4 py-2 text-xs font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
              <CheckCircle size={14} /> Mark all {openIds.length} reviewed
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}

        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center text-sm text-slate-500">
            <ShieldCheck size={28} className="mx-auto mb-2 text-green-600" />
            {tab === 'open' ? 'Nothing to review. All Super Admin changes have been seen.' : 'No Super Admin changes yet.'}
          </div>
        ) : Array.from(days.entries()).map(([d, list]) => (
          <div key={d} className="bg-white rounded-xl border border-slate-100 shadow-sm">
            <p className="px-5 py-3 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {format(new Date(d + 'T12:00:00'), 'EEEE, dd MMM yyyy')} · {list.length} change{list.length > 1 ? 's' : ''}
            </p>
            <div className="divide-y divide-slate-50">
              {list.map(c => {
                const [label, cls] = ACTION[c.action] ?? ACTION.action
                const hasDetails = c.action !== 'action' && c.changes && Object.keys(c.changes).length > 0
                return (
                  <div key={c.id} className={`px-5 py-3 ${c.reviewed_at ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">
                          <span className={`inline-flex mr-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{label}</span>
                          {c.summary}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{format(new Date(c.at), 'hh:mm a')} · {c.actor_name ?? 'Super Admin'}
                          {c.reviewed_at && ` · reviewed ${format(new Date(c.reviewed_at), 'dd MMM, hh:mm a')}`}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hasDetails && <button onClick={() => setOpen(open === c.id ? null : c.id)} className="text-xs text-green-700 hover:underline">{open === c.id ? 'Hide' : 'Details'}</button>}
                        {c.reviewed_at
                          ? <button onClick={() => review([c.id], false)} disabled={busy} className="text-xs text-slate-500 hover:underline">Undo</button>
                          : <button onClick={() => review([c.id], true)} disabled={busy} className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">Reviewed</button>}
                      </div>
                    </div>
                    {open === c.id && hasDetails && <Details c={c} />}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-400">If a change looks wrong, correct it on the related page (or change the person&apos;s role in User Management). The record stays here either way.</p>
      </div>
    </div>
  )
}
