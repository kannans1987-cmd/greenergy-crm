import QuotationDetailClient from '@/components/staff/QuotationDetailClient'

export default function QuotationDetailPage({ params }: { params: { id: string } }) {
  return <QuotationDetailClient id={params.id} />
}
