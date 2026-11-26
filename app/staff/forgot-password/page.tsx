'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // The CRM emails the link through the company Gmail; Supabase's own mailer only if that is not set up
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res && !res.ok) { setError(data.error ?? 'Could not send the link.'); setLoading(false); return }

    if (!data.viaCrm) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/staff/reset-password`,
      })
      if (resetError) {
        setError(resetError.message)
        setLoading(false)
        return
      }
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">

        <div className="flex justify-center mb-6">
          <Image src="/logo.png" alt="Greenergy Solar Solutions" width={140} height={70} />
        </div>

        <h1 className="text-2xl font-bold text-slate-900 text-center mb-1">Forgot Password</h1>
        <p className="text-slate-500 text-sm text-center mb-8">Enter your email to receive a reset link</p>

        {sent ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm text-center">
            ✅ If <b>{email}</b> is a staff login, a reset link is on its way. Check the inbox (and Spam) and open the link within 1 hour.
            <br /><span className="text-xs text-green-800/80">Nothing arrived? Check the spelling of the email, or ask the admin to send you a login link.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                ⚠ {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="yourname@example.com"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition disabled:opacity-60 text-sm"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-500 mt-6">
          <Link href="/staff/login" className="text-green-600 font-medium hover:text-green-700">
            ← Back to Login
          </Link>
        </p>
      </div>
    </div>
  )
}
