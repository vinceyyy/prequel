import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { createSessionToken, validatePasscode } from '../lib/auth'
import { authLogger } from '../lib/logger'
import { AUTH_COOKIE } from '../middleware/auth'

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

export const authRouter = new Hono()

/**
 * POST /api/auth/login — exchange a passcode for a signed session cookie.
 */
authRouter.post('/login', async (c) => {
  const clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'

  try {
    const { passcode } = await c.req.json<{ passcode?: string }>()

    if (process.env.ENABLE_AUTH === 'false') {
      authLogger.info('Login attempt - auth disabled, allowing access', {
        clientIp,
      })
      return c.json({ success: true })
    }

    if (!passcode || !validatePasscode(passcode)) {
      authLogger.warn('Login attempt failed - invalid passcode', {
        clientIp,
        hasPasscode: !!passcode,
      })
      return c.json({ error: 'Invalid passcode' }, 401)
    }

    const sessionToken = createSessionToken()
    setCookie(c, AUTH_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    authLogger.info('Login successful - session token created', {
      clientIp,
      cookieMaxAge: '30d',
      secure: process.env.NODE_ENV === 'production',
    })

    return c.json({ success: true })
  } catch (error) {
    authLogger.error('Login error - unexpected exception', {
      clientIp,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * POST /api/auth/logout — clear the session cookie.
 */
authRouter.post('/logout', (c) => {
  setCookie(c, AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 0,
    path: '/',
  })
  return c.json({ success: true })
})
