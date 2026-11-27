'use client'

export default function PrintButton() {
  return <button onClick={() => window.print()} className="mt-1 text-xs text-green-700 underline print:hidden">Print / save as PDF</button>
}
