'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    // Check if this is a password reset link (has #access_token in hash)
    const hash = window.location.hash
    if (hash && hash.includes('access_token') && hash.includes('type=recovery')) {
      router.replace('/staff/reset-password' + hash)
      return
    }
    if (hash && hash.includes('access_token')) {
      router.replace('/staff/reset-password' + hash)
      return
    }
    // Default redirect to login
    router.replace('/staff/login')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
