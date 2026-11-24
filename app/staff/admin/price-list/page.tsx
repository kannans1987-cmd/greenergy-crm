import { redirect } from 'next/navigation'

// The Price List moved to /staff/price-list so the CEO can delegate it
export default function OldPriceList() {
  redirect('/staff/price-list')
}
