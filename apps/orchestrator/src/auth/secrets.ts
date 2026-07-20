import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function newOpaqueSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function keyedHash(secret: string, purpose: 'csrf' | 'session', value: string): string {
  return createHmac('sha256', secret).update(`simproof:${purpose}\0`).update(value).digest('hex')
}

export function csrfTokenForSession(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret)
    .update('simproof:csrf-token\0')
    .update(sessionToken)
    .digest('base64url')
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  if (!/^[\da-f]{64}$/u.test(left) || !/^[\da-f]{64}$/u.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
