import { redirect } from 'next/navigation'

// Quotations moved to /staff/quotations (open to all staff, scoped by role)
export default function OldQuotations() {
  redirect('/staff/quotations?view=all')
}
