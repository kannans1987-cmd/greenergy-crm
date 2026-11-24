import { redirect } from 'next/navigation'

// Quotations moved to /staff/quotations (open to all staff, scoped by role)
export default function OldQuotationDetail({ params }: { params: { id: string } }) {
  redirect(`/staff/quotations/${params.id}`)
}
