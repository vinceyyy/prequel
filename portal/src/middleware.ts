import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  // Skip authentication if disabled
  if (process.env.ENABLE_AUTH === 'false') {
    return NextResponse.next()
  }

  // Skip authentication for specific routes
  if (
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/api/auth') ||
    // ALB health check endpoints
    request.nextUrl.pathname.startsWith('/api/health') ||
    // Take-home test routes (candidates should access without auth)
    request.nextUrl.pathname.startsWith('/take-home') ||
    request.nextUrl.pathname.startsWith('/api/takehome') ||
    request.nextUrl.pathname.startsWith('/api/interviews/by-passcode')
  ) {
    return NextResponse.next()
  }

  // Check for authentication cookie
  const authCookie = request.cookies.get('auth-token')

  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
