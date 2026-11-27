'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Printer, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { inr } from '@/lib/workflow'
import { rupeesInWords, SERVICE_KINDS } from '@/lib/growth'

// Printable tax invoice for a chargeable service job or an AMC fee (print → "Save as PDF" to send).
// Intra-state (customer in the company's state): CGST + SGST; otherwise IGST.

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function Invoice() {
  const p = useSearchParams()
  const type = p.get('type') === 'amc' ? 'amc' : 'ticket'
  const id = p.get('id') ?? ''
  const supabase = createClient()
  const [doc, setDoc] = useState<Row | null>(null)
  const [co, setCo] = useState<Row>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const [{ data: d, error }, { data: c }] = await Promise.all([
        supabase.from(type === 'amc' ? 'service_contracts' : 'service_tickets').select('*').eq('id', id).maybeSingle(),
        supabase.from('business_settings').select('data').eq('key', 'company').maybeSingle(),
      ])
      if (error || !d) setErr('Not found, or you do not have access.')
      else if (!d.invoice_number) setErr('No invoice number has been issued yet.')
      setDoc(d); setCo(c?.data ?? {})
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id])

  if (err) return <div className="p-10 text-center text-slate-500">{err} <Link href="/staff/service" className="text-green-700 underline">Back</Link></div>
  if (!doc) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>

  const taxable = Number(type === 'amc' ? doc.fee : doc.charge_amount)
  const rate = Number(doc.gst_pct)
  const intra = (doc.region === 'tamilnadu' ? 'Tamil Nadu' : 'Puducherry').toLowerCase() === String(co.state ?? 'Puducherry').toLowerCase()
  const tax = Math.round(taxable * rate) / 100
  const total = Math.round((taxable + tax) * 100) / 100
  const line = type === 'amc'
    ? `Annual maintenance contract ${doc.contract_number} (${doc.plan}): ${doc.visits_per_year} preventive visits${doc.includes_cleaning ? ' incl. panel cleaning' : ''}, ${doc.capacity_kw ? doc.capacity_kw + ' kW solar system, ' : ''}${doc.start_date} to ${doc.end_date}`
    : `${SERVICE_KINDS[doc.kind] ?? 'Service'} (${doc.ticket_number}): ${doc.resolution_notes ?? doc.description}`
  const date = new Date(doc.invoiced_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white py-6 print:py-0">
      <div className="max-w-3xl mx-auto mb-3 flex gap-2 print:hidden px-4">
        <Link href={type === 'amc' ? '/staff/service?tab=amc' : `/staff/service/${doc.id}`} className="px-3 py-2 bg-white rounded-lg text-sm flex items-center gap-1"><ArrowLeft size={14} /> Back</Link>
        <button onClick={() => window.print()} className="ml-auto px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1"><Printer size={14} /> Print / save as PDF</button>
      </div>
      {!co.gstin && <p className="max-w-3xl mx-auto mb-3 px-4 text-xs text-amber-800 print:hidden">Add your GSTIN in Business rules → Company before sending this invoice.</p>}
      <div className="max-w-3xl mx-auto bg-white p-8 print:p-0 text-sm text-slate-800 shadow print:shadow-none">
        <div className="flex items-start justify-between border-b-2 border-green-700 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-14 w-auto" />
            <div><p className="text-lg font-bold text-green-800">{co.name ?? 'Greenergy Solar Solutions'}</p>
              <p className="text-xs text-slate-600">{co.address}{co.state ? `, ${co.state}` : ''}</p>
              <p className="text-xs text-slate-600">{[co.phone, co.email, co.website].filter(Boolean).join(' · ')}</p>
              {co.gstin && <p className="text-xs font-semibold">GSTIN: {co.gstin}</p>}</div>
          </div>
          <div className="text-right"><p className="text-lg font-bold">TAX INVOICE</p><p className="font-mono text-xs">{doc.invoice_number}</p><p className="text-xs">Date: {date}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-200">
          <div><p className="text-xs text-slate-500">Bill to</p><p className="font-semibold">{doc.customer_name}</p><p className="text-xs">{doc.site_address}</p><p className="text-xs">{doc.customer_mobile}</p></div>
          <div className="text-right"><p className="text-xs text-slate-500">Place of supply</p><p className="font-semibold">{doc.region === 'tamilnadu' ? 'Tamil Nadu (33)' : 'Puducherry (34)'}</p></div>
        </div>
        <table className="w-full my-4 text-sm">
          <thead><tr className="bg-slate-50 text-xs text-slate-600"><th className="text-left p-2">Description</th><th className="p-2">SAC</th><th className="text-right p-2">Taxable value</th></tr></thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="p-2 align-top">{line}</td><td className="p-2 text-center align-top">{co.sac || '9987'}</td><td className="p-2 text-right align-top tabular-nums">{inr(taxable)}</td></tr>
            {intra ? <>
              <tr><td className="p-2 text-right" colSpan={2}>CGST {rate / 2}%</td><td className="p-2 text-right tabular-nums">₹{(tax / 2).toFixed(2)}</td></tr>
              <tr><td className="p-2 text-right" colSpan={2}>SGST / UTGST {rate / 2}%</td><td className="p-2 text-right tabular-nums">₹{(tax / 2).toFixed(2)}</td></tr>
            </> : <tr><td className="p-2 text-right" colSpan={2}>IGST {rate}%</td><td className="p-2 text-right tabular-nums">₹{tax.toFixed(2)}</td></tr>}
            <tr className="border-t-2 border-slate-300 font-bold"><td className="p-2 text-right" colSpan={2}>Total</td><td className="p-2 text-right tabular-nums">₹{total.toFixed(2)}</td></tr>
          </tbody>
        </table>
        <p className="text-xs">Amount in words: <b>Rupees {rupeesInWords(total)} only</b></p>
        {(co.upi_id || co.bank) && <p className="text-xs mt-2">Payment: {[co.upi_id && `UPI ${co.upi_id}`, co.bank].filter(Boolean).join(' · ')}</p>}
        {doc.paid_at && <p className="text-xs mt-2 font-semibold text-green-700">Paid on {doc.paid_at}{doc.payment_ref ? ` · ${doc.payment_ref}` : ''}</p>}
        <div className="flex justify-between items-end mt-10 text-xs">
          <p className="text-slate-500">This is a computer-generated invoice.</p>
          <p className="text-center">For {co.name ?? 'Greenergy Solar Solutions'}<br /><br /><br />Authorised signatory</p>
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>}><Invoice /></Suspense>
}
