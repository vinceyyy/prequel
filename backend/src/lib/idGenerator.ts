/**
 * Build a base36 (0-9a-z) string of EXACTLY `length` characters.
 *
 * A single `Math.random().toString(36).substring(2)` can yield fewer digits
 * than expected (short fractions / dropped trailing zeros), so a naive
 * `substring(2, 2 + length)` occasionally returns a too-short string. We
 * concatenate chunks until we have enough, then slice to the exact length.
 */
function randomBase36(length: number): string {
  let out = ''
  while (out.length < length) {
    out += Math.random().toString(36).substring(2)
  }
  return out.substring(0, length)
}

/**
 * Generate a short unique ID for interviews, take-homes, and instances.
 *
 * @returns 8-character alphanumeric ID (e.g., "a1b2c3d4")
 */
export function generateId(): string {
  return randomBase36(8)
}

/**
 * Generate a secure random string for passwords and access tokens.
 *
 * @returns 10-character alphanumeric string (e.g., "a1b2c3d4e5")
 */
export function generateSecureString(): string {
  return randomBase36(10)
}
