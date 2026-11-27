'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Ban, Clock, Info } from 'lucide-react'

// Kanban board for tasks (supabase/kanban_v1.sql). The database enforces the WIP limit and who may move a card.
export interface BoardTask {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  due_date: string | null
  created_at?: string | null
  completed_at: string | null
  started_at?: string | null
  status_changed_at?: string | null
  blocked?: boolean | null
  blocked_reason?: string | null
  assigned_to?: string | null
  assigned_by?: string | null
  projects: { name: string } | null
  assignee: { full_name: string } | null
  assigner: { full_name: string } | null
}

const COLS = [
  { key: 'pending',     label: 'To do',  hint: 'Given, not started' },
  { key: 'in_progress', label: 'Doing',  hint: 'Being worked on' },
  { key: 'review',      label: 'Review', hint: 'Waiting for the person who gave it' },
  { key: 'completed',   label: 'Done',   hint: 'Finished in the last 14 days' },
] as const
const PRIORITY_BAR: Record<string, string> = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-green-500' }
const DAY = 86400000
const days = (from?: string | null) => (from ? Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / DAY)) : 0)
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const today = () => new Date().toISOString().slice(0, 10)

export default function TaskBoard({ tasks, meId, fullManager, wip, agingDays, onMove, onBlock }: {
  tasks: BoardTask[]
  meId: string | undefined
  fullManager: boolean
  wip: number           // per person, 0 = no limit
  agingDays: number
  onMove: (t: BoardTask, status: string) => Promise<boolean>
  onBlock: (t: BoardTask, blocked: boolean, reason?: string) => Promise<boolean>
}) {
  const [lanes, setLanes] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)

  const canMove = (t: BoardTask) => fullManager || t.assigned_to === meId || t.assigned_by === meId
  const recentDone = (t: BoardTask) => t.status !== 'completed' || (t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 14 * DAY)
  const live = tasks.filter(t => t.status !== 'cancelled' && recentDone(t))

  // Flow metrics (Kanban: measure and manage flow)
  const m = useMemo(() => {
    const doing = tasks.filter(t => t.status === 'in_progress')
    const done7 = tasks.filter(t => t.status === 'completed' && t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 7 * DAY).length
    const cycles = tasks.filter(t => t.status === 'completed' && t.started_at && t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 30 * DAY)
      .map(t => (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()) / DAY)
    const oldest = doing.reduce<BoardTask | null>((o, t) => (!o || days(t.status_changed_at ?? t.started_at) > days(o.status_changed_at ?? o.started_at) ? t : o), null)
    return { doing: doing.length, blocked: tasks.filter(t => t.blocked && !['completed', 'cancelled'].includes(t.status)).length,
             done7, cycle: median(cycles), cycleN: cycles.length, oldest }
  }, [tasks])

  // Swimlanes by person, or one lane
  const laneList = useMemo(() => {
    if (!lanes) return [{ id: 'all', name: '', items: live }]
    const map = new Map<string, { id: string; name: string; items: BoardTask[] }>()
    for (const t of live) {
      const id = t.assigned_to ?? 'none'
      if (!map.has(id)) map.set(id, { id, name: t.assignee?.full_name ?? 'Not given to anyone', items: [] })
      map.get(id)!.items.push(t)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [live, lanes])

  // People at or over their WIP limit
  const doingBy = useMemo(() => {
    const c = new Map<string, number>()
    for (const t of tasks) if (t.status === 'in_progress' && t.assigned_to) c.set(t.assigned_to, (c.get(t.assigned_to) ?? 0) + 1)
    return c
  }, [tasks])

  const drop = async (status: string) => {
    const t = tasks.find(x => x.id === drag)
    setDrag(null); setOver(null)
    if (t && t.status !== status) await onMove(t, status)
  }

  const block = async (t: BoardTask) => {
    if (t.blocked) { await onBlock(t, false); return }
    const r = window.prompt(`What is blocking "${t.title}"? (the person who gave it is told)`)
    if (r && r.trim()) await onBlock(t, true, r.trim())
  }

  const order = (a: BoardTask, b: BoardTask) =>
    Number(!!b.blocked) - Number(!!a.blocked)
    || ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1)
    || String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999'))

  const card = (t: BoardTask) => {
    const idx = COLS.findIndex(c => c.key === t.status)
    const age = days(t.status_changed_at ?? t.created_at)
    const aging = ['in_progress', 'review', 'pending'].includes(t.status) && age >= agingDays
    const overdue = t.due_date && t.due_date < today() && t.status !== 'completed'
    const movable = canMove(t)
    return (
      <div key={t.id} draggable={movable} onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null) }}
        className={`relative bg-white rounded-lg border shadow-sm pl-3 pr-2 py-2 text-xs space-y-1 ${t.blocked ? 'border-red-300 bg-red-50/40' : 'border-slate-200'} ${movable ? 'cursor-grab active:cursor-grabbing' : ''} ${drag === t.id ? 'opacity-40' : ''}`}>
        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${PRIORITY_BAR[t.priority] ?? 'bg-slate-300'}`} aria-hidden />
        <p className="font-semibold text-slate-800 text-[13px] leading-snug">{t.title}</p>
        {t.blocked && <p className="text-red-700 flex gap-1"><Ban size={12} className="shrink-0 mt-0.5" />Blocked: {t.blocked_reason}</p>}
        <p className="text-slate-500">
          {!lanes && <>{t.assignee?.full_name ?? 'Not given to anyone'}</>}
          {t.projects?.name && <>{!lanes && ' · '}{t.projects.name}</>}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {t.due_date && <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}>Due {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{overdue ? ' · late' : ''}</span>}
          {t.status !== 'completed' && <span className={`flex items-center gap-0.5 ${aging ? 'text-amber-700 font-semibold' : 'text-slate-400'}`} title="Days in this column">
            <Clock size={11} />{age}d here</span>}
          {t.status === 'completed' && t.started_at && t.completed_at && <span className="text-slate-400">took {Math.max(0, Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / DAY * 10) / 10)}d</span>}
        </div>
        {movable && (
          <div className="flex items-center gap-1 pt-1">
            <button disabled={idx <= 0} onClick={() => onMove(t, COLS[idx - 1].key)} aria-label={`Move "${t.title}" back`}
              className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <button disabled={idx < 0 || idx >= COLS.length - 1} onClick={() => onMove(t, COLS[idx + 1].key)} aria-label={`Move "${t.title}" forward`}
              className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
            {t.status !== 'completed' && <button onClick={() => block(t)} className={`ml-auto px-1.5 py-0.5 rounded text-[11px] ${t.blocked ? 'text-green-700 hover:bg-green-50' : 'text-red-600 hover:bg-red-50'}`}>
              {t.blocked ? 'Unblock' : 'Blocked?'}</button>}
          </div>
        )}
      </div>
    )
  }

  const tile = (label: string, value: string, sub: string, warn = false) => (
    <div className={`rounded-xl border px-3 py-2 ${warn ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
      <p className="text-[11px] text-slate-500">{label}</p><p className="text-lg font-bold text-slate-900 leading-tight">{value}</p><p className="text-[10px] text-slate-400">{sub}</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {tile('In Doing now', String(m.doing), wip ? `limit ${wip} per person` : 'no limit set')}
        {tile('Blocked', String(m.blocked), 'needs someone to clear it', m.blocked > 0)}
        {tile('Done in 7 days', String(m.done7), 'throughput')}
        {tile('Typical time to finish', m.cycle == null ? '—' : `${Math.round(m.cycle * 10) / 10} d`, m.cycleN ? `median of ${m.cycleN}, start → done` : 'shows after tasks finish')}
        {tile('Oldest in Doing', m.oldest ? `${days(m.oldest.status_changed_at ?? m.oldest.started_at)} d` : '—', m.oldest ? m.oldest.title.slice(0, 28) : 'nothing in progress',
          !!m.oldest && days(m.oldest.status_changed_at ?? m.oldest.started_at) >= agingDays)}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={lanes} onChange={e => setLanes(e.target.checked)} className="accent-green-600" /> One row per person</label>
        <button onClick={() => setShowRules(!showRules)} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><Info size={13} /> How the board works</button>
        <span className="text-slate-400 ml-auto">Drag a card, or use the arrows on a phone.</span>
      </div>
      {showRules && (
        <ul className="text-xs text-slate-600 bg-white border border-slate-100 rounded-xl p-3 space-y-1 list-disc pl-6">
          <li><b>Pull, don&apos;t push:</b> move a card to Doing only when you start it.{wip ? ` Each person can have ${wip} in Doing at a time;` : ''} finish or hand one over before starting another.</li>
          <li><b>Blocked:</b> flag a card the moment it is stuck and say why. The person who gave it is told, and blocked cards go to the top.</li>
          <li><b>Review:</b> move it here when your part is done; the person who gave it checks it and moves it to Done.</li>
          <li><b>Ageing:</b> a card {agingDays}+ days in the same column turns amber. Talk about amber and blocked cards first in the daily check-in.</li>
          <li>The coloured edge is the priority: red high, amber medium, green low.</li>
        </ul>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[760px] space-y-3">
          {laneList.map(lane => {
            const n = lane.id !== 'all' && lane.id !== 'none' ? doingBy.get(lane.id) ?? 0 : 0
            return (
              <div key={lane.id}>
                {lanes && (
                  <p className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-2">{lane.name}
                    {wip > 0 && lane.id !== 'none' && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${n >= wip ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>Doing {n}/{wip}</span>}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-3">
                  {COLS.map(col => {
                    const items = lane.items.filter(t => t.status === col.key).sort(order)
                    const fullPeople = col.key === 'in_progress' && wip > 0 && !lanes
                      ? Array.from(doingBy.entries()).filter(([, c]) => c >= wip).length : 0
                    const zone = `${lane.id}:${col.key}`
                    return (
                      <div key={col.key} onDragOver={e => { if (drag) { e.preventDefault(); setOver(zone) } }} onDragLeave={() => setOver(o => (o === zone ? null : o))}
                        onDrop={e => { e.preventDefault(); drop(col.key) }}
                        className={`rounded-xl p-2 min-h-[120px] space-y-2 transition ${over === zone ? 'bg-green-50 ring-2 ring-green-400' : 'bg-slate-100/70'}`}>
                        <div className="flex items-baseline justify-between px-1">
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">{col.label} <span className="text-slate-400 font-semibold">{items.length}</span></p>
                          {fullPeople > 0 && <span className="text-[10px] text-red-600 flex items-center gap-0.5" title="People at their WIP limit"><AlertTriangle size={11} />{fullPeople} at limit</span>}
                        </div>
                        {!lanes && <p className="text-[10px] text-slate-400 px-1 -mt-1">{col.hint}</p>}
                        {items.map(card)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
