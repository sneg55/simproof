import { educatorRuntimeConfigSchema, educatorSessionSchema } from '@simproof/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpClient } from '@/api/http-client'

const validSession = {
  authenticated: true as const,
  expiresAt: '2026-07-17T12:00:00.000Z',
  csrfToken: 'c'.repeat(43),
}

describe('browser HTTP boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses same-origin credentials and validates a strict success envelope', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, value: validSession }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await createHttpClient().request('/api/session', educatorSessionSchema)

    expect(result).toEqual({ ok: true, value: validSession })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
    )
  })

  it('rejects unknown or secret-looking response fields without returning their values', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            value: {
              runtime: {
                deploymentMode: 'loopback',
                providerConfigured: false,
                maxRequestBytes: 65_536,
                maxPromptCharacters: 16_384,
                promptRetentionDefault: 'discard',
                telemetryEnabled: false,
                externalDiagnosticsEnabled: false,
              },
              generation: { available: false, reason: 'provider-not-configured' },
              seedLibraryReady: true,
              supportedDomains: ['pendulum', 'projectile'],
              openaiApiKey: 'must-not-escape',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await createHttpClient().request(
      '/api/runtime-config',
      educatorRuntimeConfigSchema,
    )

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-response', id: 'web.invalid-response' },
    })
    expect(JSON.stringify(result)).not.toContain('must-not-escape')
  })

  it('maps a strict authentication failure to a stable typed result', async () => {
    const onAuthenticationFailure = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: { id: 'http.session-required', message: 'Authentication is required.' },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    )

    await expect(
      createHttpClient(fetch, onAuthenticationFailure).request(
        '/api/session',
        educatorSessionSchema,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'authentication', id: 'http.session-required' },
    })
    expect(onAuthenticationFailure).toHaveBeenCalledOnce()
  })

  it('sends JSON and the session CSRF token on unsafe calls', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, value: validSession }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetcher)

    await createHttpClient().request('/api/auth/rotate', educatorSessionSchema, {
      method: 'POST',
      body: {},
      csrfToken: validSession.csrfToken,
    })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/rotate',
      expect.objectContaining({
        credentials: 'same-origin',
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': validSession.csrfToken,
        },
      }),
    )
  })

  it('rejects noncanonical targets and missing session CSRF before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createHttpClient(fetcher)

    for (const path of [
      'https://example.test/api/session',
      '/api//session',
      '/api/session/',
      '/api/%73ession',
      '/api/session#fragment',
      '/api/session?search=bad+space',
      '/api/session?search=%',
      '/api/session?search=one&search=two',
    ]) {
      await expect(client.request(path, educatorSessionSchema)).resolves.toEqual({
        ok: false,
        error: { kind: 'invalid-request', id: 'web.invalid-request' },
      })
    }
    await expect(
      client.request('/api/auth/rotate', educatorSessionSchema, { method: 'POST', body: {} }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-request', id: 'web.invalid-request' },
    })
    await expect(
      client.request('/api/auth/rotate', educatorSessionSchema, {
        method: 'POST',
        body: {},
        csrfToken: 'too-short',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-request', id: 'web.invalid-request' },
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
