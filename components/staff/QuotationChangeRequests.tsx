'use client'

import { useState } from 'react'
import { GitPullRequest, Loader2, CheckCircle, XCircle } from 'lucide-react'

// Change requests (quotation_view_v1.sql): staff with "view all" ask, the CEO decides.

export interface ChangeRequest {
  id: string
  requested_by: string
  changes: Record<string, unknown>
  old_values: Record<string, unknown>
  request_note: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  decision_note: string | null
  decided_at: string | null
  created_at: string
  requester?: { full_name: string } | null
  decider?: { full_name: string } | null
}

// The same list as quotation_change_fields() in the database
const FIELDS: { key: string; label: string; type?: 'number' | 'textarea' | 'select'; options?: [string, string][] }[] = [
  { key: 'customer_name', label: 'Customer name' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'Town / city' },
  { key: 'address', label: 'Site address' },
  { key: 'pincode', label: 'PIN code' },
  { key: 'eb_consumer_number', label: 'EB consumer no.' },
  { key: 'avg_monthly_bill', label: 'Bill per month (₹)', type: 'number' },
  { key: 'avg_monthly_units', label: 'Units per month', type: 'number' },
  { key: 'sanctioned_load_kw', label: 'Sanctioned load (kW)', type: 'number' },
  { key: 'available_roof_area_sqft', label: 'Shadow-free area (sq ft)', type: 'number' },
  { key: 'roof_type', label: 'Roof', type: 'select', options: [['', '—'], ['rcc', 'RCC / concrete'], ['sheet', 'Metal sheet'], ['ground_mount', 'Ground'], ['other', 'Other']] },
  { key: 'current_phase', label: 'Supply', type: 'select', options: [['', '—'], ['single', 'Single phase'], ['three', 'Three phase']] },
  { key: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]
const LABEL = Object.fromEntries(FIELDS.map(f => [f.key, f.label]))
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 outline-none bg-white'
const show = (v: unknown) => (v == null || v === '' ? '—' : String(v))
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const STATUS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', withdrawn: 'bg-slate-100 text-slate-500',
}

export default function QuotationChangeRequests({ quotationId, current, requests, meId, isCeo, canRequest, onDone, notify }: {
  quotationId: string
  current: Record<string, unknown>
  requests: ChangeRequest[]
  meId: string
  isCeo: boolean
  canRequest: boolean            // "view all" staff who cannot edit this quotation themselves
  onDone: () => void
  notify: (msg: string, ok?: boolean) => void
}) {
  const start = () => Object.fromEntries(FIELDS.map(f => [f.key, current[f.key] == null ? '' : String(current[f.key])]))
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>(start)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (!canRequest && requests.length === 0) return null

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key)
    try {
      const r = await fetch(`/api/quotations/${quotationId}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(/quotation_change|request_quotation_change|schema cache|Could not find the function/i.test(d.error ?? '')
        ? 'The CEO has to run the latest database update (quotation_view_v1.sql) first.' : d.error ?? 'Something went wrong.')
      return d
    } catch (e) { notify(e instanceof Error ? e.message : 'Something went wrong.', false); return null }
    finally { setBusy(null) }
  }

  const send = async () => {
    const changes: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const before = current[f.key] == null ? '' : String(current[f.key])
      if (vals[f.key] !== before) changes[f.key] = vals[f.key] === '' ? null : f.type === 'number' ? Number(vals[f.key]) : vals[f.key]
    }
    if (!Object.keys(changes).length && !note.trim()) { notify('Change a field, or describe the change under “Other changes”.', false); return }
    if (reason.trim().length < 3) { notify('Say why the change is needed.', false); return }
    if (await post({ action: 'request', changes, note: note.trim(), reason: reason.trim() }, 'send')) {
      notify('Sent to the CEO for approval. You will be notified of the decision.')
      setOpen(false); setNote(''); setReason(''); onDone()
    }
  }

  const decide = async (r: ChangeRequest, approve: boolean) => {
    const n = window.prompt(approve
      ? `Approve this change${r.request_note ? ' (the field changes are applied now; do the "other changes" yourself)' : ''}? Note for ${r.requester?.full_name ?? 'them'} (optional):`
      : `Reject the change? Tell ${r.requester?.full_name ?? 'them'} why:`, '')
    if (n === null) return
    if (!approve && n.trim().length < 3) { notify('Please say why you are rejecting it.', false); return }
    const d = await post({ action: 'decide', request_id: r.id, approve, note: n.trim() }, r.id)
    if (d) { notify(approve ? `Approved${d.fields_applied ? ` · ${d.fields_applied} field${d.fields_applied === 1 ? '' : 's'} updated` : ''}` : 'Rejected'); onDone() }
  }

  const withdraw = async (r: ChangeRequest) => {
    if (!window.confirm('Take back this change request?')) return
    if (await post({ action: 'withdraw', request_id: r.id }, r.id)) { notify('Request withdrawn'); onDone() }
  }

  const pending = requests.filter(r => r.status === 'pending').length

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <GitPullRequest size={16} className="text-violet-600" />
        <h3 className="font-semibold text-sm">Change requests</h3>
        {pending > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">{pending} waiting for the CEO</span>}
        {canRequest && !open && (
          <button onClick={() => { setVals(start()); setOpen(true) }} className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700">
            Request a change
          </button>
        )}
      </div>

      {canRequest && !open && requests.length === 0 && (
        <p className="px-5 py-4 text-sm text-slate-500">You can see this quotation but not change it. Use “Request a change”: the CEO approves it before anything changes.</p>
      )}

      {open && (
        <div className="p-5 space-y-3 border-b border-slate-100 bg-violet-50/30">
          <p className="text-xs text-slate-600">Change the details below. Nothing changes until the CEO approves.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map(f => (
              <label key={f.key} className={`block ${f.type === 'textarea' || f.key === 'address' ? 'sm:col-span-2' : ''}`}>
                <span className="text-xs font-medium text-slate-600 mb-1 block">{f.label}</span>
                {f.type === 'select' ? (
                  <select className={INPUT} value={vals[f.key]} onChange={e => setVals({ ...vals, [f.key]: e.target.value })}>
                    {f.options!.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea className={INPUT} rows={2} maxLength={2000} value={vals[f.key]} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} />
                ) : (
                  <input className={INPUT} type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} value={vals[f.key]}
                    onChange={e => setVals({ ...vals, [f.key]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 mb-1 block">Other changes (price, size, panels, stage, who handles it …)</span>
            <textarea className={INPUT} rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Customer wants 5 kW instead of 3 kW, and asks for ₹5,000 discount" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 mb-1 block">Why is this needed? *</span>
            <input className={INPUT} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Customer called on 27 Nov with the new address" />
          </label>
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1.5 text-xs text-slate-600" onClick={() => setOpen(false)}>Cancel</button>
            <button className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold disabled:opacity-50" disabled={!!busy} onClick={send}>
              {busy === 'send' && <Loader2 size={14} className="animate-spin inline mr-1" />}Send to the CEO
            </button>
          </div>
        </div>
      )}

      {requests.length > 0 && (
        <ul className="divide-y divide-slate-50">
          {requests.map(r => (
            <li key={r.id} className="px-5 py-3 text-sm space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS[r.status]}`}>{r.status === 'pending' ? 'Waiting for the CEO' : r.status[0].toUpperCase() + r.status.slice(1)}</span>
                <span className="text-xs text-slate-500">{r.requester?.full_name ?? 'Staff'} · {when(r.created_at)}</span>
                {r.status === 'pending' && isCeo && (
                  <span className="ml-auto flex gap-1.5">
                    <button disabled={!!busy} onClick={() => decide(r, true)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-600 text-white disabled:opacity-50"><CheckCircle size={12} /> Approve</button>
                    <button disabled={!!busy} onClick={() => decide(r, false)} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-50 text-red-700 disabled:opacity-50"><XCircle size={12} /> Reject</button>
                  </span>
                )}
                {r.status === 'pending' && !isCeo && r.requested_by === meId && (
                  <button disabled={!!busy} onClick={() => withdraw(r)} className="ml-auto text-xs text-slate-500 hover:underline">Withdraw</button>
                )}
              </div>
              <p className="text-slate-700"><b>Why:</b> {r.reason}</p>
              {Object.keys(r.changes).length > 0 && (
                <ul className="text-xs text-slate-600 space-y-0.5">
                  {Object.entries(r.changes).map(([k, v]) => (
                    <li key={k}>{LABEL[k] ?? k}: <span className="line-through text-slate-400">{show(r.old_values[k])}</span> → <b className="text-slate-800">{show(v)}</b></li>
                  ))}
                </ul>
              )}
              {r.request_note && <p className="text-xs text-slate-600"><b>Other changes:</b> {r.request_note}</p>}
              {r.decision_note && <p className="text-xs text-slate-600"><b>CEO:</b> {r.decision_note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
