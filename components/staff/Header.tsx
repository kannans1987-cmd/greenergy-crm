'use client'

import { useEffect, useState } from 'react'
import { Bell, User, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Props {
  title: string
  subtitle?: string
}

export default function Header({ title, subtitle }: Props) {
  const supabase = createClient()
  const [profile, setProfile] = useState<{ full_name: string; role: string } | null>(null)
  const [unread,  setUnread]  = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('full_name,role').eq('id', user.id).single()
        .then(({ data }) => { if (data) setProfile(data as { full_name: string; role: string }) })
      supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_read', false)
        .then(({ count }) => setUnread(count ?? 0))
    })
  }, [])

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
      <div className="lg:pl-0 pl-12">
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* User menu */}
        <Link href="/staff/profile" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition">
          <div className="w-7 h-7 rounded-full bg-green-700 flex items-center justify-center text-white text-xs font-bold">
            {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <span className="text-sm font-medium text-slate-700 hidden sm:block">{profile?.full_name ?? 'Loading…'}</span>
          <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
        </Link>
      </div>
    </header>
  )
}
