'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Header from '@/components/staff/Header'
import OngoingJobCardForm from '@/components/staff/OngoingJobCardForm'
import { createClient } from '@/lib/supabase/client'
import { isManager, type Role } from '@/lib/workflow'

// Enter a project that is already running (started before the CRM) and give it a numbered job card
export default function OngoingProjectPage() {
  const [role, setRole] = useState<Role | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => user &&
      supabase.from('profiles').select('role').eq('id', user.id).single().then(({ data }) => setRole((data?.role as Role) ?? 'employee')))
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Add an ongoing project" subtitle="A project already running — it gets a numbered job card starting from where the work is now" />
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
        <Link href="/staff/projects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Projects</Link>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          {role === null ? <p className="text-sm text-slate-400">Loading…</p>
            : !isManager(role) ? <p className="text-sm text-amber-800">Only the CEO or admin manager can add ongoing projects.</p>
            : <OngoingJobCardForm role={role} />}
        </div>
      </div>
    </div>
  )
}
