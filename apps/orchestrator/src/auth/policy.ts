import { type AuthResult, authOk } from './types.js'

export interface AuthenticationPolicy {
  readonly loopback: boolean
  readonly authenticationRequired: boolean
  readonly secureCookies: boolean
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  const octets = normalized.split('.').map(Number)
  return (
    octets.length === 4 &&
    octets[0] === 127 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  )
}

export function resolveAuthenticationPolicy(input: {
  readonly hostname: string
  readonly allowUnauthenticatedLoopback: boolean
}): AuthResult<AuthenticationPolicy> {
  const loopback = isLoopback(input.hostname)
  return authOk({
    loopback,
    authenticationRequired: !loopback || !input.allowUnauthenticatedLoopback,
    secureCookies: !loopback,
  })
}
