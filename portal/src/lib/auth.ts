import { createHmac, randomBytes } from 'crypto'

/**
 * Simple but secure session management for passcode authentication.
 * Uses HMAC-signed tokens with expiry timestamps.
 */

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSecret(): string {
  // Use AUTH_PASSCODE as part of the signing key
  // This means changing the passcode invalidates all existing sessions
  const passcode = process.env.AUTH_PASSCODE || ''
  const additionalSecret = process.env.AUTH_SECRET || 'default-secret-change-me'
  return `${passcode}:${additionalSecret}`
}

/**
 * Creates a signed session token with expiry timestamp.
 * Format: timestamp.signature
 */
export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_DURATION_MS
  const payload = String(expiresAt)
  const signature = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')

  return `${payload}.${signature}`
}

/**
 * Validates a session token.
 * Returns true if the token is valid and not expired.
 */
export function validateSessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return false
  }

  const [timestampStr, providedSignature] = parts
  const timestamp = parseInt(timestampStr, 10)

  // Check if timestamp is valid
  if (isNaN(timestamp)) {
    return false
  }

  // Check if token has expired
  if (Date.now() > timestamp) {
    return false
  }

  // Verify signature
  const expectedSignature = createHmac('sha256', getSecret())
    .update(timestampStr)
    .digest('hex')

  // Constant-time comparison to prevent timing attacks
  if (providedSignature.length !== expectedSignature.length) {
    return false
  }

  let isValid = true
  for (let i = 0; i < providedSignature.length; i++) {
    if (providedSignature[i] !== expectedSignature[i]) {
      isValid = false
    }
  }

  return isValid
}

/**
 * Generates a random token for CSRF protection if needed.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Validates the passcode against the environment variable.
 */
export function validatePasscode(passcode: string): boolean {
  const expectedPasscode = process.env.AUTH_PASSCODE
  if (!expectedPasscode || !passcode) {
    return false
  }

  // Constant-time comparison to prevent timing attacks
  if (passcode.length !== expectedPasscode.length) {
    return false
  }

  let isValid = true
  for (let i = 0; i < passcode.length; i++) {
    if (passcode[i] !== expectedPasscode[i]) {
      isValid = false
    }
  }

  return isValid
}
