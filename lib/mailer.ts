import nodemailer from 'nodemailer'

// Email alerts sent through the company Gmail account (SMTP with a Google "app password").
// Set in Vercel → Settings → Environment Variables:
//   GMAIL_USER          greenergypdy@gmail.com
//   GMAIL_APP_PASSWORD  16-letter app password from myaccount.google.com/apppasswords
//   LEAD_EMAIL_TO       who receives new-enquiry emails (comma-separated; defaults to GMAIL_USER)
// Without GMAIL_USER / GMAIL_APP_PASSWORD no email is sent and nothing else is affected.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function mailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

function transport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s/g, '') },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  })
}

export interface AuthLinkEmail { to: string; name: string; kind: 'invite' | 'recovery'; link: string }

/** Staff invite / password-reset email (the link itself comes from lib/auth-links). */
export async function sendAuthLinkEmail(m: AuthLinkEmail): Promise<boolean> {
  if (!mailConfigured()) return false
  const invite = m.kind === 'invite'
  const subject = invite ? 'Your Greenergy staff login: set your password' : 'Reset your Greenergy staff password'
  const intro = invite
    ? 'Your Greenergy staff account has been approved. Press the button to set your password, then sign in with this email address.'
    : 'We received a request to reset the password of your Greenergy staff account. Press the button to choose a new password.'
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;max-width:520px">
<h2 style="color:#166534;margin:0 0 12px">${invite ? 'Welcome to Greenergy' : 'Password reset'}</h2>
<p>Hello ${esc(m.name || 'there')},</p><p>${intro}</p>
<p style="margin:22px 0"><a href="${esc(m.link)}" style="background:#166534;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Set my password</a></p>
<p style="color:#6b7280;font-size:13px">The link works once and expires in 1 hour. If it has expired, use <b>Forgot password</b> on the staff login page.<br>If you did not expect this email, you can ignore it.</p></div>`
  const text = `Hello ${m.name || 'there'},\n\n${intro}\n\n${m.link}\n\nThe link works once and expires in 1 hour.`
  await transport().sendMail({ from: `"Greenergy CRM" <${process.env.GMAIL_USER}>`, to: m.to, subject, text, html })
  return true
}

export interface LeadEmail {
  quotationId: string
  quotationNumber?: string | null
  name: string
  mobile: string
  city?: string | null
  notes?: string | null
}

export async function sendLeadEmail(lead: LeadEmail): Promise<boolean> {
  if (!mailConfigured()) return false
  const user = process.env.GMAIL_USER!
  const to = process.env.LEAD_EMAIL_TO || user
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://greenergy-crm.vercel.app'
  const link = `${site}/staff/quotations/${lead.quotationId}`
  const tel = lead.mobile.replace(/[^0-9+]/g, '')
  const wa = tel.replace(/^\+/, '')

  const rows: [string, string][] = [
    ['Name', esc(lead.name)],
    ['Mobile', `<a href="tel:${esc(tel)}">${esc(lead.mobile)}</a> · <a href="https://wa.me/${esc(wa)}">WhatsApp</a>`],
    ['Location', esc(lead.city || '—')],
    ['Quotation', esc(lead.quotationNumber || '—')],
    ['Details', esc(lead.notes || '—').replace(/\r?\n/g, '<br>')],
  ]
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937">
<h2 style="color:#166534;margin:0 0 12px">New website enquiry</h2>
<table cellpadding="8" style="border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><td style="border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;vertical-align:top">${k}</td><td style="border:1px solid #e5e7eb">${v}</td></tr>`).join('')}</table>
<p style="margin:18px 0"><a href="${esc(link)}" style="background:#166534;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open in the CRM</a></p>
<p style="color:#6b7280;font-size:13px">Sent automatically by the Greenergy CRM when the website form is submitted.</p></div>`
  const text = `New website enquiry\n\nName: ${lead.name}\nMobile: ${lead.mobile}\nLocation: ${lead.city || '-'}\nQuotation: ${lead.quotationNumber || '-'}\n\n${lead.notes || ''}\n\nOpen in the CRM: ${link}`

  await transport().sendMail({
    from: `"Greenergy Website" <${user}>`,
    to,
    subject: `New enquiry: ${lead.name}${lead.city ? ' · ' + lead.city : ''} (${lead.mobile})`,
    text, html,
  })
  return true
}
