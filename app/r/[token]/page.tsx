import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { COMM_PHOTOS, COMM_VALUES, COMM_OPTIONAL, referralLink } from '@/lib/growth'
import PrintButton from './PrintButton'

// Customer commissioning report: opened from the link sent on WhatsApp (no login). Only shown once the
// commissioning checklist is complete. The unguessable token in the link is the only key.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar commissioning report · Greenergy Solar Solutions', robots: { index: false, follow: false } }

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const fmt = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

export default async function Report({ params }: { params: { token: string } }) {
  const notReady = (t: string) => <main className="min-h-screen flex items-center justify-center p-6 text-center text-slate-600"><p>{t}</p></main>
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return notReady('This report link is not valid.')
  const db = createAdminClient()
  const { data: p } = await db.from('projects').select('id, job_number, customer_name, site_address, capacity_kwp, project_type, quotation_id, referral_code, region, subsidy_job')
    .eq('report_token', params.token).maybeSingle()
  if (!p) return notReady('This report link is not valid.')
  const [{ data: r }, { data: q }, { data: stages }, { data: co }, { data: amc }] = await Promise.all([
    db.from('commissioning_reports').select('*').eq('project_id', p.id).maybeSingle(),
    p.quotation_id ? db.from('quotation_requests').select('panel_brand, panel_wp, panel_count, panel_type, inverter_label, battery_label, battery_qty, estimated_yearly_gen_kwh, estimated_monthly_gen_kwh, solar_type').eq('id', p.quotation_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('project_stage_history').select('stage_code, actual_date, status').eq('project_id', p.id).in('stage_code', ['commissioning', 'net_meter_sync', 'handover']),
    db.from('business_settings').select('data').eq('key', 'company').maybeSingle(),
    db.from('service_contracts').select('contract_number, plan, end_date, visits_per_year').eq('project_id', p.id).eq('status', 'active').maybeSingle(),
  ])
  if (!r?.completed_at) return notReady('Your commissioning report is being prepared. Please check again soon, or call us.')
  const c: Row = co?.data ?? {}
  const d: Row = r.data ?? {}
  const ph: Record<string, string[]> = r.photos ?? {}
  const when = (code: string) => (stages as Row[] | null)?.find(s => s.stage_code === code && s.status === 'completed')?.actual_date
  const kw = Number(p.capacity_kwp ?? 0)
  const yearly = q?.estimated_yearly_gen_kwh ?? (kw ? Math.round(kw * 4 * 365) : null)   // ~4 kWh per kW per day if no site estimate

  return (
    <main className="min-h-screen bg-slate-100 print:bg-white py-6 print:py-0 text-slate-800">
      <div className="max-w-3xl mx-auto bg-white shadow print:shadow-none p-6 sm:p-10 space-y-6 text-sm">
        <header className="flex items-start justify-between gap-4 border-b-2 border-green-700 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Greenergy Solar Solutions" className="h-14 w-auto" />
            <div><p className="text-lg font-bold text-green-800">{c.name ?? 'Greenergy Solar Solutions'}</p>
              <p className="text-xs text-slate-600">{[c.address, c.phone, c.website].filter(Boolean).join(' · ')}</p></div>
          </div>
          <div className="text-right"><p className="font-bold">Commissioning report</p><p className="text-xs font-mono">{p.job_number}</p><PrintButton /></div>
        </header>

        <section>
          <h1 className="text-xl font-bold text-slate-900">Your {kw ? `${kw} kW ` : ''}solar system is running</h1>
          <p className="text-slate-600">Prepared for <b>{p.customer_name}</b>{p.site_address ? `, ${p.site_address}` : ''}.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {([['Commissioned', fmt(when('commissioning') ?? r.completed_at)], ['Grid / net meter', fmt(when('net_meter_sync'))],
               ['Expected generation', yearly ? `≈ ${Math.round(yearly).toLocaleString('en-IN')} kWh / year` : '—'], ['Meter reading at start', d.meter_reading ? `${d.meter_reading} kWh` : '—']] as [string, string][]).map(([l, v]) => (
              <div key={l} className="bg-green-50 rounded-lg p-3"><p className="text-[11px] text-green-800">{l}</p><p className="font-semibold">{v}</p></div>))}
          </div>
        </section>

        <section>
          <h2 className="font-bold text-slate-900 mb-2">Your equipment</h2>
          <table className="w-full"><tbody className="divide-y divide-slate-100">
            {q?.panel_count && <tr><td className="py-1.5 text-slate-500 w-48">Solar panels</td><td>{q.panel_count} × {q.panel_brand} {q.panel_wp} Wp ({q.panel_type === 'NonDCR' ? 'Non-DCR' : 'DCR, made in India'})</td></tr>}
            {q?.inverter_label && <tr><td className="py-1.5 text-slate-500">Inverter</td><td>{q.inverter_label}</td></tr>}
            {q?.battery_label && <tr><td className="py-1.5 text-slate-500">Battery</td><td>{q.battery_qty} × {q.battery_label}</td></tr>}
            {[...COMM_VALUES.slice(0, 2), ...COMM_OPTIONAL.slice(0, 2)].filter(v => d[v.key]).map(v => <tr key={v.key}><td className="py-1.5 text-slate-500">{v.label}</td><td className="break-all">{String(d[v.key])}</td></tr>)}
          </tbody></table>
        </section>

        <section>
          <h2 className="font-bold text-slate-900 mb-2">Tests at commissioning</h2>
          <table className="w-full"><tbody className="divide-y divide-slate-100">
            {COMM_VALUES.slice(2, 5).map(v => <tr key={v.key}><td className="py-1.5 text-slate-500 w-48">{v.label}</td><td>{String(d[v.key] ?? '—')}</td></tr>)}
          </tbody></table>
          <p className="text-xs text-slate-500 mt-1">Checked by our engineer before switching the system on to the grid.</p>
        </section>

        <section className="print:break-inside-avoid">
          <h2 className="font-bold text-slate-900 mb-2">Photos</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {COMM_PHOTOS.flatMap(x => (ph[x.key] ?? []).slice(0, 1).map(u => (
              <figure key={u}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u} alt={x.label} className="w-full h-32 object-cover rounded" />
                <figcaption className="text-[11px] text-slate-500 mt-0.5">{x.label}</figcaption></figure>)))}
          </div>
        </section>

        <section className="grid sm:grid-cols-2 gap-4 print:break-inside-avoid">
          <div className="bg-slate-50 rounded-lg p-4">
            <h2 className="font-bold text-slate-900 mb-1">Looking after your system</h2>
            <ul className="list-disc pl-4 space-y-1 text-slate-700">
              <li>Rinse the panels with plain water every 2–4 weeks in the dry season, early morning or evening. No soap, no hard brushes, no walking on panels.</li>
              <li>Check the inverter display or app now and then: a sudden drop in generation means call us.</li>
              <li>Do not open the DC / AC boxes. In an emergency, switch off the AC isolator first, then the DC isolator.</li>
              <li>Keep warranty cards and this report together.</li>
            </ul>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h2 className="font-bold text-slate-900 mb-1">Warranty &amp; service</h2>
            <p className="text-slate-700">Panels and inverter carry the manufacturers’ warranties on the cards handed to you{d.check_warranty ? ' (handed over at commissioning)' : ''}. Our workmanship is covered as per your quotation.</p>
            {amc ? <p className="mt-2 text-slate-700">Your maintenance contract <b>{amc.contract_number}</b> ({amc.plan}, {amc.visits_per_year} visits a year) runs until {fmt(amc.end_date)}.</p>
              : <p className="mt-2 text-slate-700">Ask us about a yearly maintenance contract: scheduled cleaning, inspection and priority service{c.phone ? ` (${c.phone})` : ''}.</p>}
          </div>
        </section>

        {p.referral_code && (
          <section className="border-2 border-green-200 rounded-xl p-4 print:break-inside-avoid">
            <h2 className="font-bold text-green-800">Know someone who wants solar?</h2>
            <p className="text-slate-700">Share your personal link. We look after them the way we looked after you.</p>
            <p className="font-mono text-xs mt-1 break-all">{referralLink(p.referral_code)}</p>
          </section>
        )}

        <footer className="flex items-end justify-between border-t border-slate-200 pt-4 text-xs">
          <div>{r.signature_url && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={r.signature_url} alt="Customer signature" className="h-12" /></>}
            <p>Accepted by {r.signed_name ?? p.customer_name}{r.signed_at ? `, ${fmt(r.signed_at)}` : ''}</p></div>
          <p className="text-right">For {c.name ?? 'Greenergy Solar Solutions'}<br />{c.phone}</p>
        </footer>
      </div>
    </main>
  )
}
