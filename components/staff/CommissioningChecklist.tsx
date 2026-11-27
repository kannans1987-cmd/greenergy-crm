'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle, Loader2, AlertTriangle, ExternalLink, MessageSquare, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { whatsappLink } from '@/lib/workflow'
import { COMM_PHOTOS, COMM_VALUES, COMM_OPTIONAL, COMM_CHECKS, referralLink } from '@/lib/growth'

// Mistake-proof commissioning: the "Commissioning certificate issued" milestone cannot be ticked until
// every photo, test value and hand-over check is in and the customer has signed (the database checks it).
// When complete, the customer gets a branded report link (no login) with their referral link on it.

type Report = { project_id: string; data: Record<string, string | boolean>; photos: Record<string, string[]>; signature_url: string | null
  signed_name: string | null; signed_at: string | null; completed_at: string | null; override_reason: string | null; updated_by_name: string | null; updated_at: string }
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white disabled:bg-slate-50'

// Phone photos are 3–6 MB: shrink to 1600 px JPEG before upload (fast on mobile data, still clear)
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise(r => c.toBlob(b => r(b ?? file), 'image/jpeg', 0.82))
  } catch { return file }
}

function SignaturePad({ onSave, disabled }: { onSave: (b: Blob) => void; disabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect()
    c.width = r.width * 2; c.height = r.height * 2
    const x = c.getContext('2d')!; x.scale(2, 2); x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#0f172a'
  }, [])
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  return (
    <div className="space-y-2">
      <canvas ref={ref} className="w-full h-36 border-2 border-dashed border-slate-300 rounded-lg bg-white touch-none" aria-label="Customer signature pad"
        onPointerDown={e => { if (disabled) return; drawing.current = true; const [a, b] = pos(e); const x = ref.current!.getContext('2d')!; x.beginPath(); x.moveTo(a, b); ref.current!.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (!drawing.current) return; const [a, b] = pos(e); const x = ref.current!.getContext('2d')!; x.lineTo(a, b); x.stroke(); setDrawn(true) }}
        onPointerUp={() => { drawing.current = false }} />
      <div className="flex gap-2">
        <button type="button" className="px-3 py-1.5 text-xs bg-slate-100 rounded-lg" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDrawn(false) }}>Clear</button>
        <button type="button" disabled={!drawn || disabled} className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-lg disabled:opacity-40"
          onClick={() => ref.current!.toBlob(b => b && onSave(b), 'image/png')}>Save signature</button>
      </div>
    </div>
  )
}

export default function CommissioningChecklist({ projectId, canWork, isCeo, isMgr, customerName, customerMobile, reportToken, referralCode }: {
  projectId: string; canWork: boolean; isCeo: boolean; isMgr: boolean; customerName: string | null; customerMobile: string | null
  reportToken: string | null; referralCode: string | null
}) {
  const supabase = createClient()
  const [r, setR] = useState<Report | null>(null)
  const [vals, setVals] = useState<Record<string, string | boolean>>({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [missingDb, setMissingDb] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('commissioning_reports').select('*').eq('project_id', projectId).maybeSingle()
    if (error) { setMissingDb(true); return }
    setR(data as Report | null); setVals((data?.data as Record<string, string | boolean>) ?? {}); setName(data?.signed_name ?? customerName ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])
  useEffect(() => { load() }, [load])

  if (missingDb) return null
  const done = !!r?.completed_at
  const locked = done && !isMgr
  const photos = r?.photos ?? {}
  const say = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 6000) }
  const missing = [
    ...COMM_PHOTOS.filter(p => !(photos[p.key]?.length)).map(p => 'Photo: ' + p.label),
    ...COMM_VALUES.filter(v => !String(vals[v.key] ?? '').trim()).map(v => v.label),
    ...COMM_CHECKS.filter(c => vals[c.key] !== true).map(c => c.label),
    ...(!r?.signature_url || !(r?.signed_name ?? '').trim() ? ['Customer signature'] : []),
  ]

  async function write(patch: Partial<Report>) {
    const row = { project_id: projectId, data: vals, photos, signed_name: r?.signed_name ?? null, signature_url: r?.signature_url ?? null, ...patch }
    const { error } = await supabase.from('commissioning_reports').upsert(row)
    if (error) { say(error.message, false); return false }
    await load(); return true
  }
  async function upload(key: string, files: FileList | null) {
    if (!files?.length) return
    setBusy(key)
    const urls: string[] = []
    for (const f of Array.from(files).slice(0, 6)) {
      const blob = await shrink(f)
      const path = `commissioning/${projectId}/${key}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
      const { error } = await supabase.storage.from('job-card-photos').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) { say('Upload failed: ' + error.message, false); continue }
      urls.push(supabase.storage.from('job-card-photos').getPublicUrl(path).data.publicUrl)
    }
    if (urls.length) await write({ photos: { ...photos, [key]: [...(photos[key] ?? []), ...urls] } })
    setBusy(null)
  }
  async function saveSignature(b: Blob) {
    if (!name.trim()) return say('Type the customer’s name under the signature.', false)
    setBusy('sig')
    const path = `commissioning/${projectId}/signature_${Date.now()}.png`
    const { error } = await supabase.storage.from('job-card-photos').upload(path, b, { contentType: 'image/png' })
    if (error) { setBusy(null); return say('Upload failed: ' + error.message, false) }
    const ok = await write({ signature_url: supabase.storage.from('job-card-photos').getPublicUrl(path).data.publicUrl, signed_name: name.trim() })
    setBusy(null); if (ok) say('Signature saved')
  }
  async function complete(override?: string) {
    setBusy('complete')
    if (!override) { const ok = await write({}); if (!ok) { setBusy(null); return } }
    const { data, error } = await supabase.rpc('complete_commissioning', { p_project: projectId, p_override_reason: override ?? null })
    setBusy(null)
    if (error) return say(error.message, false)
    const miss = (data as string[]) ?? []
    if (miss.length) return say('Still missing: ' + miss.join(', '), false)
    say('Commissioning checklist complete. You can now tick “Commissioning certificate issued” and send the report.'); load()
  }

  const reportUrl = typeof window !== 'undefined' && reportToken ? `${window.location.origin}/r/${reportToken}` : ''
  const custMsg = `Dear ${customerName ?? 'Sir / Madam'}, your solar system is commissioned. Thank you for choosing Greenergy Solar Solutions! Your commissioning report (system details, test results, photos and warranty information): ${reportUrl}${referralCode ? `\n\nKnow someone who wants solar? Share your personal link: ${referralLink(referralCode)}` : ''}`

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm print:hidden">
      <button className="w-full px-5 py-4 border-b border-slate-100 flex items-center gap-2 text-left" onClick={() => setOpen(o => !o)}>
        {done ? <CheckCircle size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
        <h2 className="font-semibold text-sm">Commissioning checklist &amp; customer report</h2>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${done ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
          {done ? (r?.override_reason ? 'Completed (CEO override)' : 'Complete') : `${missing.length} item${missing.length === 1 ? '' : 's'} to do`}</span>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Open'}</span>
      </button>
      {msg && <p className={`mx-5 mt-3 text-sm rounded-lg px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
      {done && reportUrl && (
        <div className="px-5 py-3 flex flex-wrap gap-3 text-sm border-b border-slate-50">
          <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="text-green-700 font-semibold flex items-center gap-1"><ExternalLink size={14} /> Customer report</a>
          {customerMobile && <a href={whatsappLink(customerMobile, custMsg)} target="_blank" rel="noopener noreferrer" className="text-green-700 font-semibold flex items-center gap-1"><MessageSquare size={14} /> WhatsApp report{referralCode ? ' + referral link' : ''} to the customer</a>}
        </div>
      )}
      {open && (
        <div className="p-5 space-y-5">
          {!canWork && <p className="text-xs text-slate-500">Only the project team, the appointed officer and managers can fill this in.</p>}
          {r?.override_reason && <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">Completed by the CEO with items missing: {r.override_reason}</p>}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">1. Photos (taken at the site)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {COMM_PHOTOS.map(p => (
                <div key={p.key} className={`rounded-lg border p-2 ${photos[p.key]?.length ? 'border-green-200 bg-green-50/40' : 'border-slate-200'}`}>
                  <p className="text-xs font-medium text-slate-700">{p.label}</p><p className="text-[11px] text-slate-400">{p.hint}</p>
                  <div className="flex flex-wrap gap-1 my-1.5">{(photos[p.key] ?? []).map(u => (
                    <span key={u} className="relative">
                      <a href={u} target="_blank" rel="noopener noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u} alt="" className="w-12 h-12 object-cover rounded" /></a>
                      {canWork && !locked && <button aria-label="Remove photo" className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5" onClick={() => write({ photos: { ...photos, [p.key]: photos[p.key].filter(x => x !== u) } })}><Trash2 size={9} /></button>}
                    </span>))}</div>
                  {canWork && !locked && <label className="text-xs text-green-700 font-semibold flex items-center gap-1 cursor-pointer">
                    {busy === p.key ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Add photo
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => upload(p.key, e.target.files)} /></label>}
                </div>))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">2. Serial numbers &amp; test values</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...COMM_VALUES, ...COMM_OPTIONAL.map(o => ({ ...o, placeholder: 'optional' }))].map(v => (
                <label key={v.key} className="block"><span className="text-xs text-slate-600">{v.label}{COMM_VALUES.some(x => x.key === v.key) ? ' *' : ''}</span>
                  <input className={INPUT} disabled={!canWork || locked} value={String(vals[v.key] ?? '')} placeholder={v.placeholder} maxLength={500}
                    onChange={e => setVals({ ...vals, [v.key]: e.target.value })} /></label>))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">3. Hand-over</p>
            {COMM_CHECKS.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" disabled={!canWork || locked} checked={vals[c.key] === true}
                onChange={e => setVals({ ...vals, [c.key]: e.target.checked })} /> {c.label}</label>))}
            {canWork && !locked && <button className="mt-2 px-3 py-1.5 text-xs bg-slate-100 rounded-lg font-semibold" disabled={!!busy} onClick={async () => { if (await write({})) say('Saved') }}>Save values &amp; checks</button>}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">4. Customer signature</p>
            {r?.signature_url ? (
              <div className="flex items-center gap-3">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={r.signature_url} alt="Customer signature" className="h-16 border rounded bg-white" />
                <p className="text-sm">{r.signed_name}<span className="block text-xs text-slate-500">{r.signed_at ? new Date(r.signed_at).toLocaleString('en-IN') : ''}</span></p>
                {canWork && !locked && <button className="text-xs text-slate-500 underline" onClick={() => write({ signature_url: null })}>Sign again</button>}</div>
            ) : canWork && !locked ? (
              <div className="max-w-md space-y-2">
                <p className="text-xs text-slate-500">Hand the phone to the customer after showing them the system working.</p>
                <SignaturePad onSave={saveSignature} disabled={busy === 'sig'} />
                <input className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="Customer’s name" aria-label="Customer name" />
              </div>
            ) : <p className="text-sm text-slate-400">Not signed yet.</p>}
          </div>
          {!done && canWork && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              {missing.length > 0 && <p className="text-xs text-amber-800">Still to do: {missing.join(' · ')}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50" disabled={!!busy || missing.length > 0} onClick={() => complete()}>
                  {busy === 'complete' && <Loader2 size={14} className="animate-spin inline mr-1" />}Checklist complete</button>
                {isCeo && missing.length > 0 && <button className="px-4 py-2 text-sm border border-amber-300 text-amber-800 rounded-lg" onClick={() => {
                  const why = window.prompt('Complete with items missing? Write why (kept in the audit log):'); if (why && why.trim()) complete(why.trim()) }}>Complete anyway (CEO)</button>}
              </div>
            </div>
          )}
          {r?.updated_by_name && <p className="text-[11px] text-slate-400">Last updated by {r.updated_by_name} · {new Date(r.updated_at).toLocaleString('en-IN')}</p>}
        </div>
      )}
    </div>
  )
}
