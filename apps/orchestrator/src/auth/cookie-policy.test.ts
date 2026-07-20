import { describe, expect, it } from 'vitest'

import { clearSessionCookie, serializeSessionCookie } from './cookies.js'
import { resolveAuthenticationPolicy } from './policy.js'

describe('session cookies and deployment authentication policy', () => {
  it('uses a host-only secure cookie outside loopback deployments', () => {
    expect(
      serializeSessionCookie({ token: 'a'.repeat(43), maxAgeSeconds: 3_600, secure: true }),
    ).toBe(
      '__Host-simproof_session=' +
        `${'a'.repeat(43)}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Strict`,
    )
    expect(clearSessionCookie(true)).toBe(
      '__Host-simproof_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    )
  })

  it('permits a non-Secure development cookie only for exact loopback hosts', () => {
    expect(
      serializeSessionCookie({ token: 'b'.repeat(43), maxAgeSeconds: 900, secure: false }),
    ).toBe(`simproof_session=${'b'.repeat(43)}; Path=/; Max-Age=900; HttpOnly; SameSite=Strict`)
    expect(() =>
      serializeSessionCookie({ token: 'bad; Path=/admin', maxAgeSeconds: 900, secure: true }),
    ).toThrow('Session cookie input is invalid.')
    for (const hostname of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '[::1]']) {
      expect(resolveAuthenticationPolicy({ hostname, allowUnauthenticatedLoopback: true })).toEqual(
        {
          ok: true,
          value: { loopback: true, authenticationRequired: false, secureCookies: false },
        },
      )
    }
  })

  it('fails closed for LAN, wildcard, and deceptive hostnames', () => {
    for (const hostname of [
      '0.0.0.0',
      '192.168.1.9',
      'localhost.example.com',
      '::',
      'example.com',
    ]) {
      expect(resolveAuthenticationPolicy({ hostname, allowUnauthenticatedLoopback: true })).toEqual(
        {
          ok: true,
          value: { loopback: false, authenticationRequired: true, secureCookies: true },
        },
      )
    }
  })
})
