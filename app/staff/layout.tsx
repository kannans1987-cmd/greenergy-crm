import Sidebar from '@/components/staff/Sidebar'

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden min-w-0">
        {children}
      </main>
    </div>
  )
}
