'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function AuthStatus() {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const router = useRouter()

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      })
      // Redirect to login page
      router.push('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setIsLoggingOut(false)
    }
  }

  // Only show logout button if authentication is enabled
  if (process.env.NEXT_PUBLIC_ENABLE_AUTH === 'false') {
    return null
  }

  return (
    <div className="flex items-center gap-4">
      <div className="text-sm text-slate-600">Authenticated</div>
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="btn-danger text-sm px-3 py-1"
      >
        {isLoggingOut ? 'Logging out...' : 'Logout'}
      </button>
    </div>
  )
}
