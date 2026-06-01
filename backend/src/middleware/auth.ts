import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { validateSessionToken } from '../lib/auth'
import { config } from '../lib/config'

export const AUTH_COOKIE = 'auth-token'

/**
 * Paths under /api that are always reachable without a session.
 *
 * - auth login/logout: how a session is obtained/cleared
 * - health: ALB target-group probe
 * - /api/apikey/:token/* and /api/takehome/:token/*: candidate-facing links
 *   shared with people who never log into the portal. Note the singular
 *   segment — the plural management routes (/api/apikeys, /api/takehomes) are
 *   NOT public and require a session.
 */
function isPublicPath(path: string): boolean {
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/health') {
    return true
  }
  return path.startsWith('/api/apikey/') || path.startsWith('/api/takehome/')
}

/**
 * Passcode auth gate. When auth is disabled (ENABLE_AUTH=false) every request
 * passes. Otherwise non-public /api paths require a valid HMAC session cookie.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  if (!config.auth.enabled) {
    return next()
  }

  if (isPublicPath(c.req.path)) {
    return next()
  }

  const token = getCookie(c, AUTH_COOKIE)
  if (!token || !validateSessionToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return next()
})
