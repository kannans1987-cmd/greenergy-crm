import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, canEditPrices, canEditMargin } from '@/lib/staff'
import { createAdminClient } from '@/lib/supabase/server'
import { validateCatalogue, validateModel, type Catalogue, type CostModel } from '@/lib/pricing-engine'

// Read and update the supplier price list (CEO or a delegated price editor) and the
// cost model / margin (CEO or an editor given 'prices & margin'). All prices exclude GST.
export async function GET() {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  if (!canEditPrices(auth.me)) return NextResponse.json({ error: 'You do not have access to the price list. The CEO can give access in User Management.' }, { status: 403 })
  const { data, error } = await auth.supabase.from('pricing_config').select('key, data, version, updated_by_name, updated_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: history } = await auth.supabase.from('pricing_history')
    .select('key, version, note, changed_by_name, created_at').order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ config: data ?? [], history: history ?? [], canEditMargin: canEditMargin(auth.me) })
}

export async function PUT(req: NextRequest) {
  const auth = await requireStaff()
  if ('error' in auth) return auth.error
  const { me } = auth
  if (!canEditPrices(me)) return NextResponse.json({ error: 'You do not have access to change the price list.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const note = typeof b.note === 'string' ? b.note.slice(0, 300) : null
  const admin = createAdminClient()

  const updates: { key: 'catalogue' | 'cost_model'; data: unknown; expected: number }[] = []
  if (b.catalogue) {
    const errs = validateCatalogue(b.catalogue as Catalogue)
    if (errs.length) return NextResponse.json({ error: errs.slice(0, 6).join('; ') }, { status: 400 })
    updates.push({ key: 'catalogue', data: b.catalogue, expected: Number(b.catalogueVersion) })
  }
  if (b.cost_model && !canEditMargin(me)) {
    return NextResponse.json({ error: 'Only the CEO (or someone given "prices & margin" access) can change the margin and cost model.' }, { status: 403 })
  }
  if (b.cost_model) {
    const errs = validateModel(b.cost_model as CostModel)
    if (errs.length) return NextResponse.json({ error: errs.slice(0, 6).join('; ') }, { status: 400 })
    updates.push({ key: 'cost_model', data: b.cost_model, expected: Number(b.modelVersion) })
  }
  if (!updates.length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })

  for (const u of updates) {
    // Optimistic check: refuse if someone else saved in the meantime
    const { data: cur } = await admin.from('pricing_config').select('version').eq('key', u.key).maybeSingle()
    const next = (cur?.version ?? 0) + 1
    if (cur && Number.isFinite(u.expected) && u.expected !== cur.version) {
      return NextResponse.json({ error: 'The price list was changed by someone else. Reload and try again.' }, { status: 409 })
    }
    const { error } = await admin.from('pricing_config').upsert({ key: u.key, data: u.data, version: next, updated_by: me.id,
      updated_by_name: me.full_name, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await admin.from('pricing_history').insert({ key: u.key, version: next, data: u.data, note, changed_by: me.id, changed_by_name: me.full_name })
  }
  return NextResponse.json({ ok: true })
}
