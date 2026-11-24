import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/workflow'

export type PriceAccess = 'prices' | 'prices_and_margin' | null
export interface Me { id: string; full_name: string; role: Role; phone: string | null; price_access: PriceAccess }

// Price list: the CEO always; others only if the CEO gave them access in User Management
export const canEditPrices = (me: Me) => me.role === 'admin' || !!me.price_access
export const canEditMargin = (me: Me) => me.role === 'admin' || me.price_access === 'prices_and_margin'

// The signed-in, active staff member — or a ready-made error response
export async function requireStaff(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; me: Me } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('id, full_name, role, phone, status, price_access').eq('id', user.id).single()
  if (!profile || profile.status !== 'active') {
    return { error: NextResponse.json({ error: 'Your staff account is not active.' }, { status: 403 }) }
  }
  return { supabase, me: { id: profile.id, full_name: profile.full_name, role: profile.role as Role, phone: profile.phone, price_access: (profile.price_access ?? null) as PriceAccess } }
}

// Database rule violations come back as plain messages — pass them on to the screen
export function dbError(error: { message: string; code?: string } | null, fallback = 'Could not save.') {
  const msg = error?.message ?? fallback
  const status = error?.code === '42501' || /row-level security/i.test(msg) ? 403 : 400
  return NextResponse.json({ error: /row-level security/i.test(msg) ? 'You do not have access to this quotation.' : msg }, { status })
}
