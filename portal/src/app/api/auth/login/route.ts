import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { passcode } = await request.json()

    // Check if authentication is enabled
    if (process.env.ENABLE_AUTH === 'false') {
      return NextResponse.json({ success: true })
    }

    // Validate passcode
    if (!passcode || passcode !== process.env.AUTH_PASSCODE) {
      return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 })
    }

    // Create response with authentication cookie
    const response = NextResponse.json({ success: true })

    // Set authentication cookie (expires in 24 hours)
    response.cookies.set('auth-token', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
