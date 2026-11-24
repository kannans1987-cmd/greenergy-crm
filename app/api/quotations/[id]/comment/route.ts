import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()

  const { id } = await params
  const body = await req.json()
  const { content, is_internal } = body as { content: string; is_internal?: boolean }

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content is required.' }, { status: 400 })
  }

  // Employees cannot post internal comments
  const internalFlag = profile?.role === 'employee' ? false : (is_internal ?? false)

  // Verify the quotation exists
  const { data: quotation } = await supabase
    .from('quotation_requests')
    .select('id')
    .eq('id', id)
    .single()

  if (!quotation) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 })

  const { data, error } = await supabase
    .from('quotation_comments')
    .insert({
      quotation_id: id,
      author_id:    user.id,
      author_name:  (profile as { full_name?: string }).full_name ?? 'Staff',
      content:      content.trim(),
      is_internal:  internalFlag,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
