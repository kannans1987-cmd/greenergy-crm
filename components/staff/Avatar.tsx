'use client'

import { useState } from 'react'

// A staff member's photo, or their first letter when there is none (or it fails to load)
export default function Avatar({ name, url, size = 32, className = '', square = false }: {
  name?: string | null; url?: string | null; size?: number; className?: string; square?: boolean
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const shape = square ? 'rounded-2xl' : 'rounded-full'
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }
  if (url && broken !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name ? `Photo of ${name}` : 'Photo'} width={size} height={size} loading="lazy"
        onError={() => setBroken(url)} style={style}
        className={`${shape} object-cover bg-slate-100 shrink-0 ${className}`} />
    )
  }
  return (
    <div style={style} aria-hidden="true"
      className={`${shape} bg-green-700 text-white font-bold flex items-center justify-center shrink-0 ${className}`}>
      {name?.trim()?.[0]?.toUpperCase() ?? 'U'}
    </div>
  )
}
