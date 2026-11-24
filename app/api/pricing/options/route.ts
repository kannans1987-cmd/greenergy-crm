import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/staff'
import { loadPricing } from '@/lib/pricing-server'
import { catalogueOptions } from '@/lib/pricing-engine'

// Brands, panel wattages and batteries on offer — no prices
export async function GET() {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const p = await loadPricing().catch(() => null)
  if (!p) return NextResponse.json({ available: false })
  return NextResponse.json({ available: true, version: p.catalogueVersion, ...catalogueOptions(p.catalogue) })
}
