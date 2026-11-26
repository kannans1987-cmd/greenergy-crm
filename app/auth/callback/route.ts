import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

const OTP_TYPES: EmailOtpType[] = ['recovery', 'invite', 'magiclink', 'signup', 'email', 'email_change']

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
  const nextParam = searchParams.get('next')
  // Only redirect within the CRM
  const safeNext = (fallback: string) => (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : fallback)

  // PKCE flow (e.g. a reset requested from this browser through Supabase's own email)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${siteUrl}${safeNext('/staff/dashboard')}`)
  }

  // Invite / password links made by the CRM (lib/auth-links): verified here on the server,
  // so they work on any device, not only in the browser that asked for them
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  if (token_hash && type && OTP_TYPES.includes(type)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (!error) {
      const fallback = type === 'recovery' || type === 'invite' ? '/staff/reset-password' : '/staff/dashboard'
      return NextResponse.redirect(`${siteUrl}${safeNext(fallback)}`)
    }
    console.error('[auth/callback] link rejected:', error.message)
  }

  return NextResponse.redirect(`${siteUrl}/staff/login?error=invite-expired`)
}
