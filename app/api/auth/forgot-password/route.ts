import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { mailConfigured } from '@/lib/mailer'
import { passwordLink, emailLink } from '@/lib/auth-links'

// Public: "Forgot password" on the staff login page.
// The answer is the same whether or not the address has an account, so it cannot be used to find staff emails.
const recent = new Map<string, number>()

export async function POST(req: NextRequest) {
  const { email: raw } = await req.json().catch(() => ({ email: '' }))
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  // Gmail not set up: the page falls back to Supabase's own email
  if (!mailConfigured()) return NextResponse.json({ ok: true, viaCrm: false })

  const last = recent.get(email) ?? 0
  if (Date.now() - last < 60_000) return NextResponse.json({ ok: true, viaCrm: true })
  recent.set(email, Date.now())

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('full_name,email').ilike('email', email).maybeSingle()
  if (profile?.email) {
    try {
      const link = await passwordLink(profile.email)
      await emailLink(profile.email, profile.full_name ?? '', 'recovery', link)
    } catch (err) {
      console.error('[forgot-password]', err)
    }
  }
  return NextResponse.json({ ok: true, viaCrm: true })
}
