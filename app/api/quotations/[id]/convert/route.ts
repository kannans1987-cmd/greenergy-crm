import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, dbError } from '@/lib/staff'
import { isManager } from '@/lib/workflow'

// Accepted + HOT quotation → numbered job card (GSS/JC/2026-27/0001), project,
// cradle-to-grave milestones and the 50/40/10 payment schedule — in one
// database transaction (convert_quotation_to_project in workflow_v2.sql).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { supabase, me } = auth
  if (!isManager(me.role)) {
    return NextResponse.json({ error: 'Only the CEO or admin manager can create a job card.' }, { status: 403 })
  }
  const { id } = await params
  const { data, error } = await supabase.rpc('convert_quotation_to_project', { p_quotation: id })
  if (error) return dbError(error)
  return NextResponse.json(data, { status: 201 })
}
