import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/staff/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
      // If it's a password recovery, redirect to reset page
      if (next === '/staff/dashboard') {
        // Check if this is a password reset by looking at the next param
      }
      return NextResponse.redirect(`${siteUrl}${next}`)
    }
  }

  // Handle password recovery token in hash (legacy flow)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  if (token_hash && type === 'recovery') {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
    return NextResponse.redirect(`${siteUrl}/staff/reset-password`)
  }

  return NextResponse.redirect(`${origin}/staff/login?error=invite-expired`)
}
