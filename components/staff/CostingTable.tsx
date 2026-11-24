import { inr } from '@/lib/workflow'

export interface Costing {
  lines: { id: string; label: string; qty: number; unit: string; rate: number; amount: number; note?: string }[]
  subtotal: number; profit: number; profitPct?: number; band?: string
}

// Internal bill of materials with cost and margin — CEO / admin manager only
export default function CostingTable({ costing, preGstSold, total }: { costing: Costing; preGstSold: number | null; total: number | null }) {
  const margin = preGstSold != null ? preGstSold - costing.subtotal : null
  const marginPct = margin != null && preGstSold ? (margin / preGstSold) * 100 : null
  return (
    <details className="border border-amber-200 bg-amber-50/40 rounded-lg">
      <summary className="px-3 py-2 text-xs font-semibold text-amber-800 cursor-pointer">
        Internal costing (managers only) — cost {inr(costing.subtotal)}
        {margin != null && <> · margin {inr(margin)} ({marginPct?.toFixed(1)}%)</>}
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500 text-left">{['Item', 'Qty', 'Rate', 'Cost'].map(h => <th key={h} className="px-3 py-1.5">{h}</th>)}</tr></thead>
          <tbody>
            {costing.lines.map(l => (
              <tr key={l.id} className="border-t border-amber-100">
                <td className="px-3 py-1">{l.label}{l.note ? <span className="text-slate-400"> · {l.note}</span> : null}</td>
                <td className="px-3 py-1 whitespace-nowrap">{l.qty.toLocaleString('en-IN')} {l.unit}</td>
                <td className="px-3 py-1 whitespace-nowrap">{inr(l.rate)}</td>
                <td className="px-3 py-1 whitespace-nowrap text-right">{inr(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-amber-200 font-semibold"><td className="px-3 py-1" colSpan={3}>Cost (before GST){costing.band ? ` · size band ${costing.band}` : ''}</td><td className="px-3 py-1 text-right">{inr(costing.subtotal)}</td></tr>
            <tr><td className="px-3 py-1" colSpan={3}>List margin{costing.profitPct != null ? ` (${costing.profitPct}%)` : ''}</td><td className="px-3 py-1 text-right">{inr(costing.profit)}</td></tr>
            {preGstSold != null && <tr><td className="px-3 py-1" colSpan={3}>Quoted price before GST (after extras, discount, override)</td><td className="px-3 py-1 text-right">{inr(preGstSold)}</td></tr>}
            {total != null && <tr><td className="px-3 py-1" colSpan={3}>Customer pays (incl. GST)</td><td className="px-3 py-1 text-right">{inr(total)}</td></tr>}
          </tbody>
        </table>
      </div>
      {margin != null && margin < 0 && <p className="px-3 pb-2 text-xs font-semibold text-red-700">Below cost — check the discount or override before approving.</p>}
    </details>
  )
}
