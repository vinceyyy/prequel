import { NextRequest, NextResponse } from 'next/server'
import { authLogger } from '@/lib/logger'
import { validateSessionToken } from '@/lib/auth'

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Skip authentication if disabled
  if (process.env.ENABLE_AUTH === 'false') {
    return NextResponse.next()
  }

  // Skip authentication for specific routes
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    // ALB health check endpoints
    pathname.startsWith('/api/health') ||
    // Take-home candidate pages (use token-based access)
    pathname.startsWith('/takehome/') ||
    pathname.startsWith('/api/takehome/') ||
    // API key candidate pages (use token-based access)
    pathname.startsWith('/apikey/') ||
    pathname.startsWith('/api/apikey/')
  ) {
    return NextResponse.next()
  }

  // Check for authentication cookie
  const authCookie = request.cookies.get('auth-token')

  // Validate the signed session token
  if (!authCookie || !validateSessionToken(authCookie.value)) {
    // Log auth failures for protected routes (but not too verbosely for assets)
    if (!pathname.includes('.') && !pathname.startsWith('/_next')) {
      authLogger.debug('Auth check failed - redirecting to login', {
        pathname,
        hasCookie: !!authCookie,
        tokenValid: authCookie ? validateSessionToken(authCookie.value) : false,
      })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
