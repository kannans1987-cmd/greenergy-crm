'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sun, CheckCircle, ArrowLeft } from 'lucide-react'

const DEPARTMENTS = [
  'Installation & Commissioning',
  'Electrical & Wiring',
  'Civil & Structural',
  'Operations & Maintenance',
  'Sales & Business Development',
  'Finance & Accounts',
  'Administration',
  'Project Management',
]

const DESIGNATIONS = [
  'Site Engineer',
  'Electrical Engineer',
  'Project Manager',
  'Solar Technician',
  'Helper / Labour',
  'Site Supervisor',
  'Sales Executive',
  'Accounts Executive',
  'Admin Executive',
  'Operations Manager',
  'MD / Director',
  'Other',
]

export default function RegisterPage() {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '',
    designation: '', department: '', date_of_joining: '',
  })
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Registration failed')
      setSubmitted(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Request Submitted!</h2>
          <p className="text-slate-600 text-sm leading-relaxed mb-6">
            Your registration request has been sent to the admin for approval.
            Once approved, you will receive an email at{' '}
            <strong className="text-slate-800">{form.email}</strong> with a link to set your password.
          </p>
          <p className="text-xs text-slate-400 mb-6">
            This usually takes 1 business day. Please check your inbox and spam folder.
          </p>
          <Link
            href="/staff/login"
            className="inline-flex items-center gap-2 text-green-600 font-semibold text-sm hover:text-green-700 transition"
          >
            <ArrowLeft size={16} /> Back to Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-t-2xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 bg-green-600/20 border border-green-500/30 rounded-xl flex items-center justify-center">
            <Sun size={20} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg">Request Portal Access</h1>
            <p className="text-slate-400 text-xs">Greenergy Solar Solutions — Employee Registration</p>
          </div>
        </div>

        <div className="p-6">
          <p className="text-slate-500 text-sm mb-6 bg-amber-50 border border-amber-100 rounded-lg p-3">
            ℹ️ Your request will be reviewed by the admin. You will receive an email invitation to set your password once approved.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name <span className="text-red-500">*</span></label>
              <input
                name="full_name" type="text" required
                value={form.full_name} onChange={handleChange}
                placeholder="Your full name"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address <span className="text-red-500">*</span></label>
              <input
                name="email" type="email" required
                value={form.email} onChange={handleChange}
                placeholder="your.email@example.com"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone Number <span className="text-red-500">*</span></label>
              <input
                name="phone" type="tel" required
                value={form.phone} onChange={handleChange}
                placeholder="+91 98765 43210"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
              />
            </div>

            {/* Designation */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Designation <span className="text-red-500">*</span></label>
              <select
                name="designation" required
                value={form.designation} onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition bg-white"
              >
                <option value="">— Select Designation —</option>
                {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Department <span className="text-red-500">*</span></label>
              <select
                name="department" required
                value={form.department} onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition bg-white"
              >
                <option value="">— Select Department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Date of Joining */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Date of Joining</label>
              <input
                name="date_of_joining" type="date"
                value={form.date_of_joining} onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-2 shadow-lg shadow-green-600/20"
            >
              {loading
                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : 'Submit Registration Request'
              }
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Already have an account?{' '}
            <Link href="/staff/login" className="text-green-600 font-medium hover:text-green-700">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
