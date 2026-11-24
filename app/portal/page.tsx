'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Sun, Loader2, Phone, ArrowRight, Shield, Zap } from 'lucide-react'

export default function PortalPage() {
  const router = useRouter()
  const [mobile, setMobile] = useState('')
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!/^[6-9]\d{9}$/.test(mobile.trim())) {
      setError('Please enter a valid 10-digit Indian mobile number.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/portal?mobile=${encodeURIComponent(mobile.trim())}&number=${encodeURIComponent(number.trim())}`)
      const data = await res.json()

      if (!res.ok || !data.portal_token) {
        setError(
          data.error ??
          'No account found with this mobile number. Please check and try again, or contact us at +91 99432 56109.'
        )
        return
      }

      router.push(`/portal/${data.portal_token}`)
    } catch {
      setError('Something went wrong. Please try again or contact support.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-green-900 flex flex-col">

      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Greenergy Solar Solutions" width={110} height={46} className="rounded-lg" />
        </div>
        <a
          href="tel:+919943256109"
          className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition"
        >
          <Phone size={14} />
          <span className="hidden sm:inline">+91 99432 56109</span>
        </a>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">

          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-orange-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-orange-900/40">
              <Sun size={40} className="text-white" />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Customer Portal</h1>
            <p className="text-slate-400 text-sm">
              Track your solar quotations and project status
            </p>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 px-6 py-4">
              <p className="text-sm font-semibold text-slate-700">Enter your mobile number and quotation number</p>
              <p className="text-xs text-slate-500 mt-0.5">The quotation number (e.g. GSS-QT-2026-1001) is on your quotation and in our message</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Phone size={16} className="text-slate-400" />
                  </div>
                  <input
                    type="tel"
                    value={mobile}
                    onChange={e => {
                      setError('')
                      setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                    }}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                    className="block w-full pl-11 pr-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-slate-900 text-sm outline-none transition text-base"
                    autoComplete="tel"
                    inputMode="numeric"
                  />
                </div>

                <label className="block text-sm font-medium text-slate-700 mb-2 mt-4" htmlFor="qnum">Quotation number</label>
                <input id="qnum" value={number} onChange={e => { setError(''); setNumber(e.target.value.toUpperCase().slice(0, 30)) }}
                  placeholder="GSS-QT-2026-1001" autoComplete="off"
                  className="block w-full px-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-slate-900 outline-none transition text-base" />

                {error && (
                  <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                    <span className="text-red-400 mt-0.5 shrink-0">!</span>
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || mobile.length !== 10 || number.trim().length < 6}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold px-6 py-3.5 rounded-xl hover:shadow-lg transition disabled:opacity-60 disabled:cursor-not-allowed text-sm"
              >
                {loading ? (
                  <><Loader2 size={16} className="animate-spin" /> Looking up…</>
                ) : (
                  <>View My Quotations <ArrowRight size={16} /></>
                )}
              </button>
            </form>
          </div>

          {/* Trust badges */}
          <div className="flex justify-center gap-4 mt-8">
            {[
              { icon: Shield, label: 'MNRE Certified' },
              { icon: Zap, label: '500+ Installations' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-white/50 text-xs">
                <Icon size={11} className="text-orange-400" />
                {label}
              </div>
            ))}
          </div>

          {/* Help link */}
          <p className="text-center text-xs text-slate-500 mt-6">
            Don&apos;t have an account?{' '}
            <a href="/quote" className="text-orange-400 hover:text-orange-300 font-medium transition">
              Request a free quotation
            </a>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 px-4">
        <p className="text-xs text-slate-600">
          greENERGY Solar Solutions · Pondicherry · Est. 2011
        </p>
      </footer>
    </div>
  )
}
