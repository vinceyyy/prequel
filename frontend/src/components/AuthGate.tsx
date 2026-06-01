import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type GateState = 'checking' | 'ok' | 'redirecting'

// Routes reachable without a portal session: the login page itself and the
// candidate-facing activation links (which are shared with people who never
// log in). Everything else requires auth when it's enabled server-side.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' || pathname.startsWith('/apikey/') || pathname.startsWith('/takehome/')
  )
}

/**
 * Gates the app on the server's auth state. On each navigation it asks
 * GET /api/auth/me (the session cookie is httpOnly, so the client can't read it
 * directly); if auth is enabled and there's no valid session, it redirects to
 * /login. Public paths render immediately.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (isPublicPath(location.pathname)) {
      setState('ok')
      return
    }

    let cancelled = false
    setState('checking')
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { authEnabled?: boolean; authenticated?: boolean }) => {
        if (cancelled) return
        if (!d.authEnabled || d.authenticated) {
          setState('ok')
        } else {
          setState('redirecting')
          navigate('/login', { replace: true })
        }
      })
      .catch(() => {
        // On a network/parse error, fail closed to the login page rather than
        // rendering a shell that will only 401 on every API call.
        if (cancelled) return
        setState('redirecting')
        navigate('/login', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname, navigate])

  if (state === 'ok') return <>{children}</>
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>
  )
}
