import { createAdminClient } from '@/lib/supabase/server'
import { mailConfigured, sendAuthLinkEmail } from '@/lib/mailer'

// Staff "set your password" links, made by the CRM itself and emailed through the company Gmail.
// Supabase's built-in mailer (free plan) only delivers to the Supabase team's own addresses, and its
// invite links use a format the CRM's browser login cannot read; these links are checked on the
// server instead (/auth/callback?token_hash=…), so they open in any browser or phone.

export type LinkKind = 'invite' | 'recovery'

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://greenergy-crm.vercel.app'

export function linkFromHash(hashedToken: string, kind: LinkKind): string {
  const q = new URLSearchParams({ token_hash: hashedToken, type: kind, next: '/staff/reset-password' })
  return `${siteUrl()}/auth/callback?${q}`
}

/** A one-time link that lets an existing user set a new password (valid for the Supabase OTP expiry, 1 hour by default). */
export async function passwordLink(email: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message || 'Could not create the link.')
  return linkFromHash(data.properties.hashed_token, 'recovery')
}

/** Creates the staff login (if new) and returns a link to set the first password. */
export async function inviteLink(email: string, meta: Record<string, unknown>): Promise<{ link: string; userId: string | null }> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { data: meta } })
  if (!error && data?.properties?.hashed_token) {
    return { link: linkFromHash(data.properties.hashed_token, 'invite'), userId: data.user?.id ?? null }
  }
  // Already has a login (e.g. invited before): a password link does the same job
  if (error && /already|registered|exists/i.test(error.message)) return { link: await passwordLink(email), userId: null }
  throw new Error(error?.message || 'Could not create the invite.')
}

/** Emails the link when Gmail is set up; returns whether it was sent. */
export async function emailLink(to: string, name: string, kind: LinkKind, link: string): Promise<boolean> {
  if (!mailConfigured()) return false
  try {
    const ok = await sendAuthLinkEmail({ to, name, kind, link })
    await logMail('email_sent', `${kind === 'invite' ? 'Invite' : 'Password'} email sent to ${to}.`)
    return ok
  } catch (err) {
    console.error('[auth-links] email failed:', err)
    await logMail('email_failed', `${kind === 'invite' ? 'Invite' : 'Password'} email to ${to} failed: ${mailError(err)}`)
    return false
  }
}

/** Readable reason from a Gmail / SMTP error (never contains the password). */
export function mailError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string }
  return [e?.code, e?.responseCode, (e?.response || e?.message || String(err)).slice(0, 300)].filter(Boolean).join(' · ')
}

/** Email outcomes go to the audit log so delivery problems can be diagnosed. */
export async function logMail(action_type: 'email_sent' | 'email_failed', description: string) {
  try { await createAdminClient().from('audit_log').insert({ action_type, target_entity: 'email', description }) }
  catch { /* logging must never break the request */ }
}
