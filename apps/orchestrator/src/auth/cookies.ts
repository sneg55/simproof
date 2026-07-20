import { sessionTokenSchema } from '@simproof/contracts'

const SECURE_NAME = '__Host-simproof_session'
const LOOPBACK_NAME = 'simproof_session'

export function serializeSessionCookie(input: {
  readonly token: string
  readonly maxAgeSeconds: number
  readonly secure: boolean
}): string {
  if (
    !sessionTokenSchema.safeParse(input.token).success ||
    !Number.isSafeInteger(input.maxAgeSeconds) ||
    input.maxAgeSeconds < 1 ||
    input.maxAgeSeconds > 604_800
  ) {
    throw new TypeError('Session cookie input is invalid.')
  }
  return cookieValue(
    input.secure ? SECURE_NAME : LOOPBACK_NAME,
    input.token,
    input.maxAgeSeconds,
    input.secure,
  )
}

export function clearSessionCookie(secure: boolean): string {
  return cookieValue(secure ? SECURE_NAME : LOOPBACK_NAME, '', 0, secure)
}

function cookieValue(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict`
}
