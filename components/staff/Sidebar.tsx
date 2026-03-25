'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, CheckSquare, MapPin, Briefcase,
  FileText, Calendar, Users, BarChart3, Settings,
  LogOut, ChevronLeft, ChevronRight, Bell,
  ClipboardList, UserCheck
} from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

type Role = 'admin' | 'task_manager' | 'employee'

interface NavItem {
  label: string
  href:  string
  icon:  React.ElementType
  adminOnly?: boolean
  managerOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',        href: '/staff/dashboard',      icon: LayoutDashboard },
  { label: 'My Tasks',         href: '/staff/tasks',          icon: CheckSquare },
  { label: 'Attendance',       href: '/staff/attendance',     icon: MapPin },
  { label: 'My Projects',      href: '/staff/projects',       icon: Briefcase },
  { label: 'Job Cards',        href: '/staff/job-cards',      icon: FileText },
  { label: 'Leave',            href: '/staff/leave',          icon: Calendar },
  // Manager/Admin extras
  { label: 'Admin Dashboard',  href: '/staff/admin',          icon: BarChart3,    adminOnly: true },
  { label: 'User Management',  href: '/staff/admin/users',    icon: UserCheck,    adminOnly: true },
  { label: 'All Projects',     href: '/staff/admin/projects', icon: ClipboardList, adminOnly: true },
  { label: 'Reports',          href: '/staff/admin/reports',  icon: BarChart3,    adminOnly: true },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  const [collapsed,  setCollapsed]  = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profile,    setProfile]    = useState<{ full_name: string; role: Role; designation?: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('full_name,role,designation').eq('id', user.id).single()
        .then(({ data }) => { if (data) setProfile(data as { full_name: string; role: Role; designation?: string }) })
    })
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/staff/login')
    router.refresh()
  }

  const role: Role = profile?.role ?? 'employee'

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.adminOnly   && role !== 'admin') return false
    if (item.managerOnly && role === 'employee') return false
    return true
  })

  const isActive = (href: string) =>
    pathname === href || (href !== '/staff/dashboard' && pathname.startsWith(href))

  const sidebarContent = (
    <div className={`flex flex-col h-full bg-slate-900 text-white transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}>
      {/* Logo / Brand */}
      <div className={`flex items-center gap-3 px-4 py-4 border-b border-slate-700/50 bg-white ${collapsed ? 'justify-center' : ''}`}>
        {collapsed ? (
          <Image src="/logo.png" alt="Greenergy" width={32} height={32} className="rounded" />
        ) : (
          <Image src="/logo.png" alt="Greenergy Solar Solutions" width={130} height={55} />
        )}
      </div>

      {/* Collapse toggle (desktop) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex items-center justify-center absolute -right-3 top-16 w-6 h-6 bg-slate-700 border border-slate-600 rounded-full text-slate-300 hover:text-white hover:bg-slate-600 transition z-10"
        style={{ position: 'absolute', right: collapsed ? -12 : -12 }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {visibleItems.map(item => {
          const Icon   = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
                ${active
                  ? 'bg-green-600 text-white shadow-lg shadow-green-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User info + sign out */}
      <div className="border-t border-slate-700/50 p-3">
        {!collapsed && profile && (
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {profile.full_name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="text-white text-xs font-semibold truncate">{profile.full_name}</p>
              <p className="text-slate-400 text-[10px] capitalize">{profile.role?.replace('_', ' ')}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 transition ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Sign Out' : undefined}
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-screen sticky top-0 relative">
        {sidebarContent}
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-white shadow-lg"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="relative flex">
            {sidebarContent}
          </div>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  )
}
