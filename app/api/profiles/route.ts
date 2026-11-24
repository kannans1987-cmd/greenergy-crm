import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lists active staff profiles, used by assignment dropdowns (e.g. quotation
// sales/engineer assignment). An optional ?role=a,b,c filter is accepted for
// forward-compatibility with a richer role model; today's 3-role enum means
// callers generally omit it and just pick from all active staff.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  if (url.searchParams.get('me')) {
    const { data: me } = await supabase.from('profiles').select('id, full_name, role, phone').eq('id', user.id).single()
    return NextResponse.json({ me })
  }
  const roleParam = url.searchParams.get('role')

  let q = supabase
    .from('profiles')
    .select('id, full_name, email, role, designation, status')
    .eq('status', 'active')
    .order('full_name', { ascending: true })

  if (roleParam) {
    const roles = roleParam.split(',').map(r => r.trim()).filter(Boolean)
    if (roles.length > 0) q = q.in('role', roles)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: data ?? [] })
}
