import { NextRequest, NextResponse } from 'next/server'
import { authLogger } from '@/lib/logger'
import { validatePasscode, createSessionToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  try {
    const { passcode } = await request.json()

    // Check if authentication is enabled
    if (process.env.ENABLE_AUTH === 'false') {
      authLogger.info('Login attempt - auth disabled, allowing access', {
        clientIp,
      })
      return NextResponse.json({ success: true })
    }

    // Validate passcode using constant-time comparison
    if (!passcode || !validatePasscode(passcode)) {
      authLogger.warn('Login attempt failed - invalid passcode', {
        clientIp,
        hasPasscode: !!passcode,
      })
      return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 })
    }

    // Create signed session token
    const sessionToken = createSessionToken()

    // Create response with authentication cookie
    const response = NextResponse.json({ success: true })

    // Set authentication cookie with signed token (expires in 24 hours)
    response.cookies.set('auth-token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60, // 24 hours in seconds
      path: '/',
    })

    authLogger.info('Login successful - session token created', {
      clientIp,
      cookieMaxAge: '24h',
      secure: process.env.NODE_ENV === 'production',
    })

    return response
  } catch (error) {
    authLogger.error('Login error - unexpected exception', {
      clientIp,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
