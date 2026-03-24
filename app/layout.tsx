import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Greenergy CRM — Staff Portal',
  description: 'Employee operations portal for Greenergy Solar Solutions',
  robots: 'noindex, nofollow', // Keep CRM out of search engines
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  )
}
