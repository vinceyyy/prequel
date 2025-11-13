/**
 * Generate a short unique ID for interviews, take-homes, and instances.
 * Returns an 8-character alphanumeric string.
 *
 * Uses Math.random().toString(36) for consistency with existing interview implementation.
 * Base36 encoding uses: 0-9 and a-z (36 characters)
 *
 * @returns 8-character alphanumeric ID (e.g., "a1b2c3d4")
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * Generate a secure random string for passwords and access tokens.
 * Returns a 10-character alphanumeric string.
 *
 * Uses Math.random().toString(36) for consistency with existing password generation.
 * Base36 encoding uses: 0-9 and a-z (36 characters)
 *
 * @returns 10-character alphanumeric string (e.g., "a1b2c3d4e5")
 */
export function generateSecureString(): string {
  return Math.random().toString(36).substring(2, 12)
}
