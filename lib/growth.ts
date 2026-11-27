// Shared lists for the growth features (database codes ↔ labels). Keep in step with supabase/growth_v1.sql.

export const LOST_REASONS: { code: string; label: string }[] = [
  { code: 'price_high',      label: 'Price too high' },
  { code: 'competitor',      label: 'Chose another installer' },
  { code: 'subsidy_doubt',   label: 'Subsidy doubts / delays' },
  { code: 'finance',         label: 'No funds / loan not arranged' },
  { code: 'site_unsuitable', label: 'Roof / site not suitable' },
  { code: 'no_response',     label: 'Stopped responding' },
  { code: 'postponed',       label: 'Postponed (maybe later)' },
  { code: 'other',           label: 'Other' },
]
export const lostLabel = (code?: string | null) => LOST_REASONS.find(r => r.code === code)?.label ?? (code ? code : 'Not recorded')

export const SOURCE_LABELS: Record<string, string> = {
  website: 'Website', phone: 'Phone call', walk_in: 'Walk-in', referral: 'Referral', social_media: 'Social media', other: 'Other',
}

// Commissioning checklist (same keys as commissioning_missing() in the database)
export const COMM_PHOTOS: { key: string; label: string; hint: string }[] = [
  { key: 'array',     label: 'Panel array',                    hint: 'Whole array, from a corner' },
  { key: 'structure', label: 'Mounting structure',             hint: 'Legs, anchoring / base' },
  { key: 'inverter',  label: 'Inverter (switched on)',         hint: 'Display showing power' },
  { key: 'acdb_dcdb', label: 'ACDB / DCDB',                    hint: 'Boxes open, labels visible' },
  { key: 'earthing',  label: 'Earthing & lightning arrester',  hint: 'Pits and LA' },
  { key: 'meter',     label: 'Net meter with reading',         hint: 'Reading readable' },
]
export const COMM_VALUES: { key: string; label: string; placeholder: string }[] = [
  { key: 'inverter_serial', label: 'Inverter serial number',               placeholder: 'e.g. 1234ABCD5678' },
  { key: 'panel_serials',   label: 'Panel serial numbers',                 placeholder: 'Comma-separated, or photo of the list' },
  { key: 'string_voc',      label: 'String voltage Voc (each string)',     placeholder: 'e.g. S1 412 V, S2 410 V' },
  { key: 'insulation_mohm', label: 'Insulation resistance (MΩ)',           placeholder: 'e.g. 40' },
  { key: 'earth_ohm',       label: 'Earth resistance (Ω)',                 placeholder: 'e.g. 1.2' },
  { key: 'meter_reading',   label: 'Meter reading at commissioning (kWh)', placeholder: 'Import / export' },
]
export const COMM_OPTIONAL: { key: string; label: string }[] = [
  { key: 'battery_serial', label: 'Battery serial number (hybrid)' },
  { key: 'net_meter_no',   label: 'Net meter number' },
  { key: 'notes',          label: 'Notes for the customer' },
]
export const COMM_CHECKS: { key: string; label: string }[] = [
  { key: 'check_monitoring', label: 'Monitoring app set up on the customer’s phone' },
  { key: 'check_training',   label: 'Customer shown how to switch off safely and clean the panels' },
  { key: 'check_warranty',   label: 'Warranty cards and manuals handed over' },
]

export const SITE_URL = 'https://www.greenergypdy.com'
export const referralLink = (code: string) => `${SITE_URL}/?ref=${encodeURIComponent(code)}#assessment`
export const groupLink = (code: string) => `${SITE_URL}/?group=${encodeURIComponent(code)}#assessment`

export const SERVICE_KINDS: Record<string, string> = {
  amc_visit: 'AMC visit', breakdown: 'Breakdown', cleaning: 'Cleaning', inspection: 'Inspection', installation_fix: 'Installation fix', other: 'Other',
}
export const SERVICE_STATUS: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled',
}
export const SERVICE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800', assigned: 'bg-blue-100 text-blue-800', in_progress: 'bg-indigo-100 text-indigo-800',
  resolved: 'bg-green-100 text-green-800', closed: 'bg-slate-100 text-slate-600', cancelled: 'bg-slate-100 text-slate-400',
}

export const daysBetween = (a: string | Date, b: string | Date = new Date()) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)

export function hoursAgo(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`
}

// Number in words (Indian system) for invoices, e.g. 1770 → "One thousand seven hundred seventy"
export function rupeesInWords(n: number): string {
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  const two = (x: number) => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '')
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '')
  let r = Math.round(n)
  if (r === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(r / 10000000); r %= 10000000
  const lakh = Math.floor(r / 100000); r %= 100000
  const thousand = Math.floor(r / 1000); r %= 1000
  if (crore) parts.push(three(crore) + ' crore')
  if (lakh) parts.push(two(lakh) + ' lakh')
  if (thousand) parts.push(two(thousand) + ' thousand')
  if (r) parts.push(three(r))
  const s = parts.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
