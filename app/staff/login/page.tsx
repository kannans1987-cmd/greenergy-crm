'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Eye, EyeOff, Zap } from 'lucide-react'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const inviteError = searchParams.get('error') === 'invite-expired'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Incorrect email or password. Please try again.'
        : authError.message)
      setLoading(false)
      return
    }

    // Fetch role and redirect
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const next = searchParams.get('next') ?? (profile?.role === 'admin' ? '/staff/admin' : '/staff/dashboard')
    router.push(next)
    router.refresh()
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel — Branding ── */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-1/4 -left-20 w-72 h-72 rounded-full bg-green-400 blur-3xl" />
          <div className="absolute bottom-1/4 -right-10 w-56 h-56 rounded-full bg-emerald-300 blur-2xl" />
          <div className="absolute top-3/4 left-1/3 w-40 h-40 rounded-full bg-teal-400 blur-2xl" />
        </div>

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'40\' height=\'40\' viewBox=\'0 0 40 40\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M0 40L40 0H20L0 20M40 40V20L20 40\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}
        />

        <div className="relative z-10 text-center max-w-sm w-full">
          {/* Logo on white card */}
          <div className="mb-8 flex justify-center">
            <div className="bg-white rounded-2xl px-8 py-5 shadow-2xl">
              <Image src="/logo.png" alt="Greenergy Solar Solutions" width={200} height={110} />
            </div>
          </div>

          {/* Address */}
          <p className="text-green-300/70 text-xs mb-8 tracking-wide">
            📍 No.234, Lawspet Main Road, Pondicherry
          </p>

          {/* Divider */}
          <div className="border-t border-white/10 pt-8 mb-6">
            <h2 className="text-white text-2xl font-bold mb-2">Employee Operations Portal</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Manage daily tasks, track attendance with GPS, monitor project progress, and access job cards — all from one place.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: 'Task Tracking',  icon: '✅' },
              { label: 'GPS Attendance', icon: '📍' },
              { label: 'Job Cards',      icon: '📋' },
            ].map(item => (
              <div key={item.label} className="bg-white/8 border border-white/15 rounded-xl p-4 hover:bg-white/10 transition">
                <p className="text-2xl mb-2">{item.icon}</p>
                <p className="text-green-300 text-[10px] font-semibold tracking-wide">{item.label}</p>
              </div>
            ))}
          </div>

          {/* Certifications */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {['MNRE Certified', 'CII Certified', 'Est. 2011'].map(tag => (
              <span key={tag} className="text-[10px] text-slate-500 border border-slate-700 rounded-full px-3 py-1">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — Login form ── */}
      <div className="w-full lg:w-7/12 xl:w-1/2 flex items-center justify-center p-6 sm:p-10 bg-white">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Image src="/logo.png" alt="Greenergy Solar Solutions" width={120} height={60} />
          </div>

          {/* Error banners */}
          {inviteError && (
            <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              ⚠️ Your invite link has expired or is invalid. Please ask admin to resend.
            </div>
          )}

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
          <p className="text-slate-500 text-sm mb-8">Sign in to your Greenergy staff account</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
              <span className="text-red-400">⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="yourname@example.com"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition text-sm"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                href="/staff/forgot-password"
                className="text-xs text-green-600 hover:text-green-700 font-medium transition"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-lg shadow-green-600/20 hover:shadow-green-600/30"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Zap size={16} />
                  Sign In to Portal
                </>
              )}
            </button>
          </form>

          {/* Register link */}
          <p className="text-center text-sm text-slate-500 mt-8">
            New employee?{' '}
            <Link href="/staff/register" className="text-green-600 font-semibold hover:text-green-700 transition">
              Request Portal Access
            </Link>
          </p>

          {/* Back to public site */}
          <p className="text-center text-xs text-slate-400 mt-4">
            <Link href="/" className="hover:text-slate-600 transition">
              ← Back to Greenergy Website
            </Link>
          </p>

          <p className="text-center text-xs text-slate-300 mt-6">
            © 2025 Greenergy Solar Solutions · Authorized employees only
          </p>
        </div>
      </div>
    </div>
  )
}

