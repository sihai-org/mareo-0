import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** A fresh 256-bit random secret, shown to the issuer exactly once. */
export function generateTokenSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** Only the SHA-256 digest is ever stored or compared. */
export function hashToken(tokenSecret: string): string {
  return createHash('sha256').update(tokenSecret).digest('hex')
}

export function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}
