// Builds supabase/pricing/pricing_seed.sql from the private price files in supabase/pricing/:
//   price-list-*.json (newest is used)   supplier purchase prices from the PDFs
//   cost-model.json                      profit %, GST %, bands, structure & installation rates
// The output contains your costs and margin — paste it into the Supabase SQL editor,
// never commit it (the folder is git-ignored because the repository is public).
// Run: node supabase/build-pricing-seed.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'pricing')
const listFile = readdirSync(dir).filter(f => /^price-list-.*\.json$/.test(f)).sort().pop()
if (!listFile) throw new Error('No price-list-*.json in supabase/pricing')
const list = JSON.parse(readFileSync(join(dir, listFile), 'utf8'))
const model = JSON.parse(readFileSync(join(dir, 'cost-model.json'), 'utf8'))

// Retired panels stay in the catalogue, switched off, so they can be re-enabled from the Price List page
const { retiredPanels, ...catalogue } = list
for (const [id, p] of Object.entries(retiredPanels?.items ?? {})) {
  if (!catalogue.panels[id]) catalogue.panels[id] = { ...p, active: false, note: 'Not in the latest price list' }
}
for (const p of Object.values(catalogue.panels)) p.active = p.active !== false
for (const i of Object.values(catalogue.inverters)) i.active = i.active !== false

const q = s => "'" + JSON.stringify(s).replace(/'/g, "''") + "'"
const sql = `-- PRIVATE: Greenergy supplier prices and cost model (${listFile}, cost-model.json).
-- Generated ${new Date().toISOString().slice(0, 10)} by supabase/build-pricing-seed.mjs. Do not commit or share.
-- Paste into Supabase → SQL Editor and run once after SETUP_NEW_PROJECT.sql.
insert into pricing_config (key, data, version, updated_by_name) values
  ('catalogue',  ${q(catalogue)}::jsonb, 1, 'Initial load (${listFile})'),
  ('cost_model', ${q(model)}::jsonb,     1, 'Initial load (cost-model.json)')
on conflict (key) do update set data = excluded.data, version = pricing_config.version + 1,
  updated_by_name = excluded.updated_by_name, updated_at = now();
insert into pricing_history (key, version, data, note, changed_by_name)
select key, version, data, 'Loaded from ${listFile}', updated_by_name from pricing_config;
`
writeFileSync(join(dir, 'pricing_seed.sql'), sql)
console.log(`Wrote supabase/pricing/pricing_seed.sql — ${Object.keys(catalogue.panels).length} panels, ${Object.keys(catalogue.inverters).length} inverters, ${Object.keys(catalogue.batteries ?? {}).length} batteries`)
