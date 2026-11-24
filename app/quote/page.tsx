'use client'

import { useState, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { CheckCircle, ChevronRight, ChevronLeft, Loader2, Sun, Zap, Shield } from 'lucide-react'
import { GST_RATE, residentialSubsidy } from '@/lib/workflow'

// ─── Constants ──────────────────────────────────────────────────────────────
const PEAK_SUN_HOURS = 5.2
const SYSTEM_EFFICIENCY = 0.80
const TARIFF_DOMESTIC = 4.5
const TARIFF_COMMERCIAL = 7.5
const TARIFF_INDUSTRIAL = 8.0
const BASE_COST_PER_KW_ONGRID = 57500
const BASE_COST_PER_KW_HYBRID = 72000

// ─── Types ───────────────────────────────────────────────────────────────────
interface Step1 {
  customer_name: string
  mobile: string
  email: string
  address: string
  city: string
}

interface Step2 {
  region: string
  consumer_type: string
  solar_type: string
  eb_consumer_number: string
  sanctioned_load: string
  monthly_bill: string
  monthly_units: string
  required_capacity: string
  roof_type: string
  roof_area: string
  connection_phase: string
}

interface Step3 {
  loan_required: string
  subsidy_required: string
  site_visit: string
  notes: string
  bill_file: File | null
  roof_file: File | null
}

interface Estimate {
  capacityKw: number
  dailyGen: number
  monthlyGen: number
  yearlyGen: number
  monthlySavings: number
  yearlySavings: number
  systemCost: number
  gst: number
  totalCost: number
  subsidy: number
  centralSubsidy: number
  stateSubsidy: number
  netCost: number
  payback: number
  savings25yr: number
}

// Price from the current supplier price list (server), sized in whole panels
interface ListPrice { available: boolean; kwp?: number; panels?: number; wp?: number; panelBrand?: string; inverterLabel?: string
  systemCost?: number; gst?: number; total?: number; centralSubsidy?: number; stateSubsidy?: number; net?: number; priceList?: string | null }

// ─── Calculation helpers ──────────────────────────────────────────────────────
function getTariff(consumerType: string): number {
  if (consumerType === 'commercial') return TARIFF_COMMERCIAL
  if (consumerType === 'industrial') return TARIFF_INDUSTRIAL
  return TARIFF_DOMESTIC
}

function calculateEstimate(step2: Step2, subsidyRequired: string, list?: ListPrice | null): Estimate {
  const tariff = getTariff(step2.consumer_type)

  let capacityKw: number
  if (step2.required_capacity && parseFloat(step2.required_capacity) > 0) {
    capacityKw = parseFloat(step2.required_capacity)
  } else if (step2.monthly_units && parseFloat(step2.monthly_units) > 0) {
    const dailyUnits = parseFloat(step2.monthly_units) / 30
    const raw = dailyUnits / (PEAK_SUN_HOURS * SYSTEM_EFFICIENCY)
    capacityKw = Math.ceil(raw * 2) / 2
  } else if (step2.monthly_bill && parseFloat(step2.monthly_bill) > 0) {
    const monthlyUnits = parseFloat(step2.monthly_bill) / tariff
    const dailyUnits = monthlyUnits / 30
    const raw = dailyUnits / (PEAK_SUN_HOURS * SYSTEM_EFFICIENCY)
    capacityKw = Math.ceil(raw * 2) / 2
  } else {
    capacityKw = 3 // default
  }

  // The price list sizes in whole panels (e.g. 3 kW → 6 × 550 Wp = 3.3 kWp)
  if (list?.available && list.kwp) capacityKw = list.kwp

  const dailyGen = capacityKw * PEAK_SUN_HOURS * SYSTEM_EFFICIENCY
  const monthlyGen = dailyGen * 30
  const yearlyGen = dailyGen * 365
  const monthlySavings = monthlyGen * tariff
  const yearlySavings = monthlySavings * 12

  const solarType = step2.solar_type
  const costPerKw = solarType === 'hybrid' ? BASE_COST_PER_KW_HYBRID : BASE_COST_PER_KW_ONGRID
  // Fallback flat rate only if the price list is unavailable (or for off-grid / pumps)
  const systemCost = list?.available ? list.systemCost! : capacityKw * costPerKw
  const gst = list?.available ? list.gst! : systemCost * GST_RATE   // 70% supply at 5% + 30% installation at 18%
  const totalCost = list?.available ? list.total! : systemCost + gst

  const isOngridEligible =
    step2.consumer_type === 'domestic' &&
    (solarType === 'ongrid' || solarType === 'not_sure') &&
    subsidyRequired === 'yes'

  // Central PM Surya Ghar + Puducherry / Tamil Nadu state top-up (same rules as the staff quotations)
  const aid = isOngridEligible ? residentialSubsidy(step2.region, capacityKw) : { central: 0, state: 0, total: 0 }
  const subsidy = aid.total

  const netCost = totalCost - subsidy
  const payback = yearlySavings > 0 ? netCost / yearlySavings : 0
  const savings25yr = yearlySavings * 25 - netCost

  return {
    capacityKw, dailyGen, monthlyGen, yearlyGen, monthlySavings, yearlySavings,
    systemCost, gst, totalCost, subsidy, centralSubsidy: aid.central, stateSubsidy: aid.state, netCost, payback, savings25yr,
  }
}

// ─── Reusable input classes ───────────────────────────────────────────────────
const inputCls =
  'block w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-slate-900 text-sm outline-none transition'
const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5'

// ─── Main Component ───────────────────────────────────────────────────────────
export default function QuotePage() {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [quotationNumber, setQuotationNumber] = useState('')
  const [apiError, setApiError] = useState('')

  const [step1, setStep1] = useState<Step1>({
    customer_name: '', mobile: '', email: '', address: '', city: '',
  })
  const [step2, setStep2] = useState<Step2>({
    region: 'puducherry', consumer_type: '', solar_type: '', eb_consumer_number: '',
    sanctioned_load: '', monthly_bill: '', monthly_units: '',
    required_capacity: '', roof_type: '', roof_area: '', connection_phase: '',
  })
  const [listPrice, setListPrice] = useState<ListPrice | null>(null)
  const [step3, setStep3] = useState<Step3>({
    loan_required: 'no', subsidy_required: 'no', site_visit: 'yes',
    notes: '', bill_file: null, roof_file: null,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const s1 = useCallback((k: keyof Step1, v: string) => setStep1(p => ({ ...p, [k]: v })), [])
  const s2 = useCallback((k: keyof Step2, v: string) => setStep2(p => ({ ...p, [k]: v })), [])
  const s3 = useCallback((k: keyof Step3, v: string | File | null) => setStep3(p => ({ ...p, [k]: v })), [])

  // Validation
  const validateStep1 = () => {
    const e: Record<string, string> = {}
    if (!step1.customer_name.trim()) e.customer_name = 'Name is required'
    if (!step1.mobile.trim()) e.mobile = 'Mobile is required'
    else if (!/^[6-9]\d{9}$/.test(step1.mobile.trim())) e.mobile = 'Enter a valid 10-digit Indian mobile number'
    if (step1.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(step1.email)) e.email = 'Enter a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const e: Record<string, string> = {}
    if (!step2.consumer_type) e.consumer_type = 'Please select consumer type'
    if (!step2.solar_type) e.solar_type = 'Please select system type'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setErrors({})
    setStep(s => s + 1)
  }

  const handleBack = () => {
    setErrors({})
    setStep(s => s - 1)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setApiError('')

    const estimate = calculateEstimate(step2, step3.subsidy_required, listPrice)

    const formData = new FormData()
    // Step 1 — contact details (field names already match the DB columns)
    formData.append('customer_name', step1.customer_name)
    formData.append('mobile', step1.mobile)
    formData.append('email', step1.email)
    formData.append('address', step1.address)
    formData.append('city', step1.city)
    // Step 2 — technical requirements (renamed to match quotation_requests columns)
    formData.append('region', step2.region)
    formData.append('consumer_type', step2.consumer_type)
    formData.append('solar_type', step2.solar_type)
    formData.append('eb_consumer_number', step2.eb_consumer_number)
    formData.append('sanctioned_load_kw', step2.sanctioned_load)
    formData.append('avg_monthly_bill', step2.monthly_bill)
    formData.append('avg_monthly_units', step2.monthly_units)
    formData.append('required_capacity_kw', step2.required_capacity)
    formData.append('roof_type', step2.roof_type)
    formData.append('available_roof_area_sqft', step2.roof_area)
    formData.append('current_phase', step2.connection_phase)
    // Step 3 — preferences + files
    formData.append('loan_required', step3.loan_required)
    formData.append('subsidy_required', step3.subsidy_required)
    formData.append('site_visit_required', step3.site_visit)
    formData.append('notes', step3.notes)
    if (step3.bill_file) formData.append('bill_file', step3.bill_file)
    if (step3.roof_file) formData.append('roof_file', step3.roof_file)
    // Preliminary estimate (mapped to the DB's estimated_*/system_cost columns)
    formData.append('recommended_capacity_kw', String(estimate.capacityKw))
    formData.append('estimated_daily_gen_kwh', String(Math.round(estimate.dailyGen)))
    formData.append('estimated_monthly_gen_kwh', String(Math.round(estimate.monthlyGen)))
    formData.append('estimated_yearly_gen_kwh', String(Math.round(estimate.yearlyGen)))
    formData.append('estimated_monthly_savings', String(Math.round(estimate.monthlySavings)))
    formData.append('estimated_yearly_savings', String(Math.round(estimate.yearlySavings)))
    formData.append('estimated_payback_years', String(parseFloat(estimate.payback.toFixed(1))))
    formData.append('estimated_25yr_savings', String(Math.round(estimate.savings25yr)))
    formData.append('subsidy_applicable', String(Math.round(estimate.subsidy)))
    formData.append('system_cost', String(Math.round(estimate.systemCost)))
    formData.append('gst_amount', String(Math.round(estimate.gst)))
    formData.append('total_cost_before_subsidy', String(Math.round(estimate.totalCost)))
    formData.append('net_cost_after_subsidy', String(Math.round(estimate.netCost)))

    try {
      const res = await fetch('/api/quotations', { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error ?? 'Submission failed. Please try again.')
      }
      // Use the server-assigned quotation number (auto-generated by a DB
      // trigger) — never a client-guessed one, so it matches what staff see.
      setQuotationNumber(data.quotation_number ?? '')
      setSubmitted(true)
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Estimate for the preview card (computed live)
  const baseKw = calculateEstimate(step2, step3.subsidy_required).capacityKw
  useEffect(() => {
    if (!step2.consumer_type || !step2.solar_type || !(baseKw > 0)) { setListPrice(null); return }
    const t = setTimeout(() => {
      fetch('/api/pricing/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        kw: baseKw, consumer_type: step2.consumer_type, solar_type: step2.solar_type, roof_type: step2.roof_type,
        region: step2.region, subsidy_required: step3.subsidy_required }) })
        .then(r => r.json()).then(setListPrice).catch(() => setListPrice(null))
    }, 300)
    return () => clearTimeout(t)
  }, [baseKw, step2.consumer_type, step2.solar_type, step2.roof_type, step2.region, step3.subsidy_required])
  const estimate = calculateEstimate(step2, step3.subsidy_required, listPrice)
  const step2HasData = !!(step2.consumer_type && step2.solar_type && (step2.monthly_bill || step2.monthly_units || step2.required_capacity))

  // ─── Success Screen ───────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 sm:p-12 max-w-lg w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={44} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Quotation Request Submitted!</h1>
          <p className="text-slate-500 mb-6 text-sm">Your preliminary quotation number:</p>
          <div className="bg-orange-50 border border-orange-200 rounded-2xl px-6 py-4 mb-6">
            <p className="text-2xl font-bold text-orange-600 font-mono tracking-wider">{quotationNumber}</p>
          </div>
          <p className="text-slate-600 text-sm mb-4">
            Our team will review your request and contact you within <strong>24 hours</strong>.
          </p>
          <div className="bg-slate-50 rounded-xl px-4 py-3 mb-8">
            <p className="text-xs text-slate-500 mb-0.5">For immediate assistance:</p>
            <a href="tel:+919943256109" className="text-slate-900 font-bold text-base">+91 99432 56109</a>
          </div>
          <a
            href="https://www.greenergypdy.com"
            className="inline-block bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold px-8 py-3 rounded-xl hover:shadow-lg transition"
          >
            Back to Greenergy Website
          </a>
        </div>
      </div>
    )
  }

  // ─── Main Form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">

      {/* Hero Header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-green-900 px-4 py-10 sm:py-14">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-5">
            <Image
              src="/logo.png"
              alt="Greenergy Solar Solutions"
              width={140}
              height={60}
              className="rounded-xl"
              priority
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 leading-tight">
            gre<span className="text-green-400">ENERGY</span> Solar Solutions
          </h1>
          <p className="text-slate-300 text-sm sm:text-base mb-6 max-w-xl mx-auto">
            Get Your Free Solar Quotation — Pondicherry&apos;s Most Trusted Solar Company Since 2011
          </p>
          {/* Trust badges */}
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { icon: Shield, label: 'MNRE Certified' },
              { icon: Sun, label: 'Est. 2011' },
              { icon: Zap, label: '500+ Installations' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 bg-white/10 backdrop-blur px-3 py-1.5 rounded-full text-white text-xs font-medium border border-white/20">
                <Icon size={12} className="text-orange-400" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {[
              { n: 1, label: 'Personal Details' },
              { n: 2, label: 'Technical Info' },
              { n: 3, label: 'Preferences' },
            ].map(({ n, label }, idx) => (
              <div key={n} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    step > n ? 'bg-green-500 text-white' :
                    step === n ? 'bg-orange-500 text-white ring-4 ring-orange-100' :
                    'bg-slate-200 text-slate-500'
                  }`}>
                    {step > n ? <CheckCircle size={14} /> : n}
                  </div>
                  <span className={`text-[10px] sm:text-xs mt-1 font-medium whitespace-nowrap ${step === n ? 'text-orange-600' : step > n ? 'text-green-600' : 'text-slate-400'}`}>
                    {label}
                  </span>
                </div>
                {idx < 2 && (
                  <div className={`h-0.5 flex-1 mx-1 mb-4 transition-all ${step > n ? 'bg-green-400' : 'bg-slate-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form Card */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 px-6 py-4">
            <p className="text-xs text-orange-600 font-semibold uppercase tracking-wider mb-0.5">
              Step {step} of 3
            </p>
            <h2 className="text-lg font-bold text-slate-900">
              {step === 1 ? 'Personal Details' : step === 2 ? 'Technical Requirements' : 'Preferences & Submit'}
            </h2>
          </div>

          <div className="p-6 sm:p-8">
            {/* ── STEP 1 ── */}
            {step === 1 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Customer Name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={step1.customer_name}
                      onChange={e => s1('customer_name', e.target.value)}
                      placeholder="Your full name"
                      className={inputCls}
                    />
                    {errors.customer_name && <p className="mt-1 text-xs text-red-500">{errors.customer_name}</p>}
                  </div>

                  <div>
                    <label className={labelCls}>Mobile Number <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={step1.mobile}
                      onChange={e => s1('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile number"
                      maxLength={10}
                      className={inputCls}
                    />
                    {errors.mobile && <p className="mt-1 text-xs text-red-500">{errors.mobile}</p>}
                  </div>

                  <div>
                    <label className={labelCls}>Email Address</label>
                    <input
                      type="email"
                      value={step1.email}
                      onChange={e => s1('email', e.target.value)}
                      placeholder="your@email.com"
                      className={inputCls}
                    />
                    {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                  </div>

                  <div className="sm:col-span-2">
                    <label className={labelCls}>Address</label>
                    <textarea
                      value={step1.address}
                      onChange={e => s1('address', e.target.value)}
                      placeholder="Your full address"
                      rows={2}
                      className={inputCls + ' resize-none'}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>City / Area</label>
                    <input
                      type="text"
                      value={step1.city}
                      onChange={e => s1('city', e.target.value)}
                      placeholder="e.g. Pondicherry, Karaikal"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Electricity connection in <span className="text-red-400">*</span></label>
                    <select value={step2.region} onChange={e => s2('region', e.target.value)} className={inputCls}>
                      <option value="puducherry">Puducherry / Pondicherry</option>
                      <option value="tamilnadu">Tamil Nadu</option>
                    </select>
                    <p className="mt-1 text-xs text-slate-500">Homes get a state subsidy on top of PM Surya Ghar: up to ₹30,000 in Puducherry, up to ₹22,000 in Tamil Nadu.</p>
                  </div>
                  <div>
                    <label className={labelCls}>Consumer Type <span className="text-red-400">*</span></label>
                    <select value={step2.consumer_type} onChange={e => s2('consumer_type', e.target.value)} className={inputCls}>
                      <option value="">Select type…</option>
                      <option value="domestic">Domestic</option>
                      <option value="commercial">Commercial</option>
                      <option value="industrial">Industrial</option>
                      <option value="institution">Institution</option>
                      <option value="agricultural">Agricultural</option>
                    </select>
                    {errors.consumer_type && <p className="mt-1 text-xs text-red-500">{errors.consumer_type}</p>}
                  </div>

                  <div>
                    <label className={labelCls}>Type of Solar System <span className="text-red-400">*</span></label>
                    <select value={step2.solar_type} onChange={e => s2('solar_type', e.target.value)} className={inputCls}>
                      <option value="">Select system…</option>
                      <option value="ongrid">On-Grid (Grid-tied)</option>
                      <option value="hybrid">Hybrid (Grid + Battery)</option>
                      <option value="offgrid">Off-Grid (Battery Only)</option>
                      <option value="solar_pump">Solar Water Pump</option>
                      <option value="not_sure">Not Sure — Help me choose</option>
                    </select>
                    {errors.solar_type && <p className="mt-1 text-xs text-red-500">{errors.solar_type}</p>}
                  </div>

                  <div>
                    <label className={labelCls}>EB Consumer Number</label>
                    <input
                      type="text"
                      value={step2.eb_consumer_number}
                      onChange={e => s2('eb_consumer_number', e.target.value)}
                      placeholder="Your EB service number"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Sanctioned Load (kW)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={step2.sanctioned_load}
                      onChange={e => s2('sanctioned_load', e.target.value)}
                      placeholder="e.g. 5"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Average Monthly Bill (₹)</label>
                    <input
                      type="number"
                      min="0"
                      value={step2.monthly_bill}
                      onChange={e => s2('monthly_bill', e.target.value)}
                      placeholder="e.g. 3000"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Average Monthly Units (kWh)</label>
                    <input
                      type="number"
                      min="0"
                      value={step2.monthly_units}
                      onChange={e => s2('monthly_units', e.target.value)}
                      placeholder="e.g. 400"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Required Capacity if Known (kW)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={step2.required_capacity}
                      onChange={e => s2('required_capacity', e.target.value)}
                      placeholder="e.g. 5 (optional)"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Roof Type</label>
                    <select value={step2.roof_type} onChange={e => s2('roof_type', e.target.value)} className={inputCls}>
                      <option value="">Select roof type…</option>
                      <option value="rcc">RCC Flat Roof</option>
                      <option value="sheet">Sheet / Tin Roof</option>
                      <option value="ground_mount">Ground Mount</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Available Roof Area (sq.ft)</label>
                    <input
                      type="number"
                      min="0"
                      value={step2.roof_area}
                      onChange={e => s2('roof_area', e.target.value)}
                      placeholder="e.g. 600"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Current Connection Phase</label>
                    <select value={step2.connection_phase} onChange={e => s2('connection_phase', e.target.value)} className={inputCls}>
                      <option value="">Select phase…</option>
                      <option value="single">Single Phase</option>
                      <option value="three">Three Phase</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3 ── */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="space-y-6">

                {/* Preliminary Estimate Card */}
                {step2HasData && (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5 mb-2">
                    <h3 className="text-sm font-bold text-green-800 mb-4 flex items-center gap-2">
                      <Sun size={16} className="text-orange-500" />
                      Your Preliminary Estimate
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'System Size', value: `${estimate.capacityKw} kW` },
                        { label: 'Monthly Generation', value: `${Math.round(estimate.monthlyGen)} kWh` },
                        { label: 'Monthly Savings', value: `₹${Math.round(estimate.monthlySavings).toLocaleString('en-IN')}` },
                        { label: 'Estimated Cost', value: `₹${(Math.round(estimate.totalCost / 1000)).toLocaleString('en-IN')}K` },
                        ...(estimate.centralSubsidy > 0 ? [{ label: 'Central Subsidy', value: `₹${(estimate.centralSubsidy / 1000).toFixed(0)}K` }] : []),
                        ...(estimate.stateSubsidy > 0 ? [{ label: step2.region === 'tamilnadu' ? 'TN State Subsidy' : 'Puducherry Subsidy', value: `₹${(estimate.stateSubsidy / 1000).toFixed(0)}K` }] : []),
                        { label: 'Net Cost', value: `₹${(Math.round(estimate.netCost / 1000)).toLocaleString('en-IN')}K` },
                        { label: 'Payback Period', value: `${estimate.payback.toFixed(1)} yrs` },
                        { label: '25-yr Savings', value: `₹${(Math.round(estimate.savings25yr / 100000)).toFixed(1)}L` },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-xl p-3 text-center shadow-sm">
                          <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                          <p className="text-sm font-bold text-slate-900">{value}</p>
                        </div>
                      ))}
                    </div>
                    {listPrice?.available && (
                      <p className="text-xs text-slate-600 mt-3">
                        Based on {listPrice.panels} × {listPrice.panelBrand} {listPrice.wp} Wp panels ({listPrice.kwp} kWp) with a {listPrice.inverterLabel} inverter — our {listPrice.priceList ?? 'current'} price list, incl. GST. Final price after a free site visit.
                      </p>
                    )}
                    {estimate.subsidy > 0 && (
                      <p className="text-[10px] text-green-700 mt-3 flex items-center gap-1">
                        <Shield size={10} />
                        PM Surya Ghar central subsidy plus the {step2.region === 'tamilnadu' ? 'Tamil Nadu' : 'Puducherry'} state subsidy, credited to your bank account after installation
                      </p>
                    )}
                  </div>
                )}

                {/* Preferences */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div>
                    <label className={labelCls}>Loan Required?</label>
                    <div className="flex gap-3 mt-2">
                      {['yes', 'no'].map(v => (
                        <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="loan_required"
                            value={v}
                            checked={step3.loan_required === v}
                            onChange={() => s3('loan_required', v)}
                            className="accent-orange-500"
                          />
                          <span className="text-sm text-slate-700 capitalize">{v}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      Government Subsidy?
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">(domestic on-grid only)</span>
                    </label>
                    <div className="flex gap-3 mt-2">
                      {['yes', 'no'].map(v => (
                        <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="subsidy_required"
                            value={v}
                            checked={step3.subsidy_required === v}
                            onChange={() => s3('subsidy_required', v)}
                            className="accent-orange-500"
                          />
                          <span className="text-sm text-slate-700 capitalize">{v}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Site Visit?</label>
                    <div className="flex flex-col gap-1.5 mt-2">
                      {[
                        { v: 'yes', label: 'Yes — Schedule a free visit' },
                        { v: 'no', label: 'No — I have the details' },
                      ].map(({ v, label }) => (
                        <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="site_visit"
                            value={v}
                            checked={step3.site_visit === v}
                            onChange={() => s3('site_visit', v)}
                            className="accent-orange-500"
                          />
                          <span className="text-xs text-slate-700">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Additional Notes</label>
                  <textarea
                    value={step3.notes}
                    onChange={e => s3('notes', e.target.value)}
                    placeholder="Any specific requirements, questions, or details you'd like to share…"
                    rows={3}
                    className={inputCls + ' resize-none'}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className={labelCls}>Upload Electricity Bill</label>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={e => s3('bill_file', e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">JPEG, PNG or PDF</p>
                  </div>

                  <div>
                    <label className={labelCls}>Upload Roof Photo</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => s3('roof_file', e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">JPEG or PNG</p>
                  </div>
                </div>

                {apiError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                    {apiError}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold px-8 py-3 rounded-xl hover:shadow-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <><Loader2 size={16} className="animate-spin" /> Submitting…</>
                    ) : (
                      <>Submit Quotation Request <ChevronRight size={16} /></>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Navigation for steps 1 & 2 */}
            {step < 3 && (
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                {step > 1 ? (
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                ) : <div />}
                <button
                  onClick={handleNext}
                  className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold px-8 py-3 rounded-xl hover:shadow-lg transition"
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          greENERGY Solar Solutions · Pondicherry · +91 99432 56109 · info@greenergypdy.com
        </p>
      </div>
    </div>
  )
}
