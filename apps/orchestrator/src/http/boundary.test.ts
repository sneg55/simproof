// LOC-EXEMPT: Security boundary cases stay together to audit one route matrix and shared fixture.

import { CorrelationContext, createStructuredLogger, LocalLogStore } from '@simproof/observability'
import { describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../config/environment.js'
import type { ReadinessReport } from '../operations/readiness.js'
import { createHttpApi, ROUTE_INVENTORY } from './boundary.js'
import type { HttpOperationResult, HttpRequest, RequestCorrelation } from './types.js'

const TOKEN = 's'.repeat(43)
const CSRF = 'c'.repeat(43)
const WRONG_CSRF = 'z'.repeat(43)
const ORIGIN = 'https://simproof.example.edu'
const ROUTE_ID = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const REQUEST_ID = '019f6bc1-0811-70c1-a139-938a3ad2dee1'

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    environment: 'production',
    deploymentMode: 'network',
    databasePath: '/data/metadata.sqlite',
    artifactRoot: '/data/artifacts',
    allowedOrigins: [ORIGIN],
    trustedProxyAddress: undefined,
    adminBootstrapSecret: 'bootstrap',
    sessionSecret: 'session',
    localAuthBypass: false,
    providers: { openaiApiKey: undefined, codexApiKey: undefined },
    session: { ttlSeconds: 28_800, idleSeconds: 3_600, maxActiveSessions: 8 },
    request: { maxBytes: 128, maxPromptCharacters: 64 },
    privacy: {
      promptRetention: 'discard',
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    },
    externalDiagnostics: { endpoint: undefined, token: undefined },
    telemetry: { endpoint: undefined },
    observability: {
      diagnosticLogRoot: '/tmp/simproof-http-boundary-diagnostics',
      maxFileBytes: 8_388_608,
      retainedFiles: 3,
    },
    ...overrides,
  }
}

function auth() {
  return {
    bootstrap: vi.fn(() => Promise.resolve({ ok: true as const, value: { credentialVersion: 1 } })),
    login: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { sessionToken: TOKEN, csrfToken: CSRF, expiresAt: '2026-07-16T20:00:00.000Z' },
      }),
    ),
    authenticate: vi.fn((token: string, csrf?: string) =>
      token !== TOKEN
        ? { ok: false as const, error: { code: 'session-invalid', message: 'raw secret?' } }
        : csrf !== undefined && csrf !== CSRF
          ? { ok: false as const, error: { code: 'csrf-invalid', message: 'raw csrf?' } }
          : { ok: true as const, value: { sessionId: 'session-id', expiresAt: 'x' } },
    ),
    session: vi.fn((token: string) =>
      token === TOKEN
        ? {
            ok: true as const,
            value: {
              authenticated: true as const,
              csrfToken: CSRF,
              expiresAt: '2026-07-16T20:00:00.000Z',
            },
          }
        : { ok: false as const, error: { code: 'session-invalid', message: 'raw secret?' } },
    ),
    rotate: vi.fn(() => ({
      ok: true as const,
      value: { sessionToken: TOKEN, csrfToken: CSRF, expiresAt: '2026-07-16T20:00:00.000Z' },
    })),
    logout: vi.fn(() => ({ ok: true as const, value: true as const })),
    changePassword: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { credentialVersion: 2 },
      }),
    ),
  }
}

function callbacks() {
  return {
    health: vi.fn((_correlation: RequestCorrelation) => ({ status: 'ok' })),
    readiness: vi.fn((_correlation: RequestCorrelation): ReadinessReport => ({ status: 'ready' })),
    getPrivacy: vi.fn(
      (): HttpOperationResult<unknown> => ({
        ok: true,
        value: { promptRetention: 'discard' },
      }),
    ),
    updatePrivacy: vi.fn((value: unknown): HttpOperationResult<unknown> => ({ ok: true, value })),
    exportData: vi.fn((): HttpOperationResult<unknown> => ({ ok: true, value: { export: true } })),
    deleteSimulation: vi.fn(
      (): HttpOperationResult<unknown> => ({ ok: true, value: { deleted: true } }),
    ),
    startGeneration: vi.fn((value: unknown): HttpOperationResult<unknown> => ({ ok: true, value })),
    cancelGeneration: vi.fn(
      (idempotencyKey: string): HttpOperationResult<unknown> => ({
        ok: true,
        value: { idempotencyKey },
      }),
    ),
  }
}

function request(input: {
  method: string
  path: string
  body?: string | AsyncIterable<Uint8Array>
  headers?: Record<string, string>
  peerAddress?: string
}): HttpRequest {
  const body =
    input.body === undefined || typeof input.body !== 'string'
      ? input.body
      : Buffer.from(input.body)
  return {
    method: input.method,
    path: input.path,
    headers: input.headers ?? {},
    peerAddress: input.peerAddress ?? '203.0.113.5',
    ...(body === undefined ? {} : { body }),
  }
}

const jsonHeaders = (extra: Record<string, string> = {}) => ({
  origin: ORIGIN,
  'content-type': 'application/json',
  ...extra,
})

const authenticatedHeaders = (extra: Record<string, string> = {}) =>
  jsonHeaders({ cookie: `__Host-simproof_session=${TOKEN}`, 'x-csrf-token': CSRF, ...extra })

describe('framework-neutral HTTP security boundary', () => {
  it('allows password-free local test access while preserving CSRF enforcement', async () => {
    const localOrigin = 'http://127.0.0.1:4173'
    const authentication = auth()
    const handlers = callbacks()
    const api = createHttpApi({
      auth: authentication,
      config: config({
        environment: 'test',
        deploymentMode: 'loopback',
        allowedOrigins: [localOrigin],
        localAuthBypass: true,
      }),
      callbacks: handlers,
    })

    const restored = await api.handle(request({ method: 'GET', path: '/api/session' }))
    expect(restored).toMatchObject({
      status: 200,
      body: {
        value: {
          authenticated: true,
          authenticationMode: 'local-bypass',
          csrfToken: expect.stringMatching(/^[\w-]{43}$/u),
        },
      },
    })
    expect(authentication.authenticate).not.toHaveBeenCalled()

    const denied = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: jsonHeaders({ origin: localOrigin }),
        body: '{"expectedRevision":0,"promptRetention":"discard","externalDiagnosticsEnabled":false}',
      }),
    )
    expect(denied).toMatchObject({ status: 403, body: { error: { id: 'http.csrf-denied' } } })

    const csrfToken = (restored.body as { value: { csrfToken: string } }).value.csrfToken
    const accepted = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: jsonHeaders({ origin: localOrigin, 'x-csrf-token': csrfToken }),
        body: '{"expectedRevision":0,"promptRetention":"discard","externalDiagnosticsEnabled":false}',
      }),
    )
    expect(accepted.status).toBe(200)
    expect(handlers.updatePrivacy).toHaveBeenCalled()
  })

  it('assigns one server-owned UUID to every response and dispatch correlation', async () => {
    const handlers = callbacks()
    const correlationContext = new CorrelationContext()
    handlers.health.mockImplementation((correlation) => ({
      status: 'ok',
      correlation,
      active: correlationContext.current(),
    }))
    const api = createHttpApi({
      auth: auth(),
      config: config(),
      callbacks: handlers,
      correlationContext,
      createRequestId: () => REQUEST_ID,
    })

    const health = await api.handle(request({ method: 'GET', path: '/health' }))
    const missing = await api.handle(request({ method: 'GET', path: '/unknown' }))
    const malformed = await api.handle(request({ method: 'GET', path: '/api/session/' }))

    for (const response of [health, missing, malformed]) {
      expect(response.headers['x-simproof-request-id']).toBe(REQUEST_ID)
    }
    expect(handlers.health).toHaveBeenCalledWith({ requestId: REQUEST_ID })
    expect(health.body).toMatchObject({
      value: {
        correlation: { requestId: REQUEST_ID },
        active: { requestId: REQUEST_ID },
      },
    })
  })

  it('logs only a registered route key, response class, stable ID, and request correlation', async () => {
    const store = new LocalLogStore({ maxEntries: 10, maxAgeMs: 60_000 })
    const api = createHttpApi({
      auth: auth(),
      config: config(),
      callbacks: callbacks(),
      createRequestId: () => REQUEST_ID,
      logger: createStructuredLogger({ sink: store }),
    })

    await api.handle(request({ method: 'GET', path: '/missing?secret=sentinel' }))

    expect(store.recent()).toEqual([
      expect.objectContaining({
        component: 'web-api',
        event: 'http.request.completed',
        errorId: 'http.route-not-found',
        correlation: { requestId: REQUEST_ID },
        attributes: { operation: 'http.unmatched', statusCode: 404 },
      }),
    ])
    expect(JSON.stringify(store.recent())).not.toContain('sentinel')
  })

  it('returns deterministic readiness failures without exposing dependency details', async () => {
    const handlers = callbacks()
    handlers.readiness.mockReturnValue({
      status: 'not-ready',
      errorId: 'artifact-store.unavailable',
    })
    const api = createHttpApi({
      auth: auth(),
      config: config(),
      callbacks: handlers,
      createRequestId: () => REQUEST_ID,
    })

    const response = await api.handle(
      request({ method: 'GET', path: '/ready', headers: { origin: ORIGIN } }),
    )

    expect(response).toMatchObject({
      status: 503,
      headers: {
        'access-control-expose-headers': 'x-simproof-request-id',
        'x-simproof-request-id': REQUEST_ID,
      },
      body: { ok: false, error: { id: 'artifact-store.unavailable' } },
    })
    expect(JSON.stringify(response)).not.toContain('path')
  })

  it('uses an explicit default-deny inventory and never mutates state through GET', async () => {
    expect(ROUTE_INVENTORY.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /health',
      'GET /ready',
      'GET /api/bootstrap-capability',
      'POST /api/auth/bootstrap',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/rotate',
      'POST /api/auth/password',
      'GET /api/session',
      'GET /api/privacy/settings',
      'PUT /api/privacy/settings',
      'POST /api/privacy/export',
      'DELETE /api/privacy/simulation',
      'POST /api/generation',
      'POST /api/generation/cancel',
      'GET /api/runtime-config',
      'GET /api/seeds',
      'GET /api/seeds/:seedId',
      'GET /api/seeds/:seedId/report',
      'POST /api/seeds/:seedId/preview',
      'GET /api/simulations',
      'POST /api/simulations',
      'GET /api/simulations/:simulationId',
      'GET /api/simulations/:simulationId/versions',
      'POST /api/simulations/:simulationId/versions',
      'GET /api/simulations/:simulationId/compare',
      'POST /api/simulations/:simulationId/duplicate',
      'POST /api/simulations/:simulationId/export',
      'POST /api/generations',
      'GET /api/generations/:runId',
      'POST /api/generations/:runId/concept-review',
      'POST /api/generations/:runId/cancellation',
      'GET /api/versions/:versionId/report',
      'POST /api/versions/:versionId/publish',
      'POST /api/versions/:versionId/archive',
      'POST /api/versions/:versionId/reverify',
      'POST /api/versions/:versionId/preview',
    ])
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: callbacks() })
    expect((await api.handle(request({ method: 'GET', path: '/health' }))).status).toBe(200)
    expect((await api.handle(request({ method: 'GET', path: '/unknown' }))).status).toBe(404)
    expect(
      (await api.handle(request({ method: 'GET', path: '/api/privacy/simulation' }))).status,
    ).toBe(404)
    expect((await api.handle(request({ method: 'GET', path: '/api/session' }))).status).toBe(401)
    expect(
      (
        await api.handle(
          request({
            method: 'pOsT',
            path: '/api/auth/login',
            headers: jsonHeaders(),
            body: '{"password":"secret"}',
          }),
        )
      ).status,
    ).toBe(404)
  })

  it('rejects malformed request targets before authentication or dispatch', async () => {
    const authentication = auth()
    const handlers = callbacks()
    const api = createHttpApi({ auth: authentication, config: config(), callbacks: handlers })
    for (const path of [
      '/api/session/',
      '/api//session',
      '/api/session?unknown=true',
      '/api/%73ession',
      '//example.test/api/session',
      '/api/session#fragment',
    ]) {
      const response = await api.handle(request({ method: 'GET', path }))
      expect(response).toMatchObject({
        status: 400,
        body: { error: { id: 'http.invalid-request-target' } },
      })
    }
    expect(authentication.authenticate).not.toHaveBeenCalled()
    expect(handlers.getPrivacy).not.toHaveBeenCalled()
  })

  it('answers exact credentialed CORS preflight without invoking a route callback', async () => {
    const authentication = auth()
    const api = createHttpApi({ auth: authentication, config: config(), callbacks: callbacks() })
    const allowed = await api.handle(
      request({
        method: 'OPTIONS',
        path: '/api/privacy/settings',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type, x-csrf-token',
        },
      }),
    )
    expect(allowed).toMatchObject({
      status: 204,
      headers: {
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'content-type, x-csrf-token',
      },
    })
    expect(authentication.authenticate).not.toHaveBeenCalled()
    const denied = await api.handle(
      request({
        method: 'OPTIONS',
        path: '/api/privacy/settings',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type, x-csrf-token',
        },
      }),
    )
    expect(denied.status).toBe(403)
    expect(denied.headers).not.toHaveProperty('access-control-allow-origin')

    const malformed = await api.handle(
      request({
        method: 'OPTIONS',
        path: '/api/privacy/settings/',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type, x-csrf-token',
        },
      }),
    )
    expect(malformed).toMatchObject({
      status: 400,
      body: { error: { id: 'http.invalid-request-target' } },
    })
  })

  it('requires an exact allowed Origin on every unsafe route, including login and bootstrap', async () => {
    const authentication = auth()
    const api = createHttpApi({ auth: authentication, config: config(), callbacks: callbacks() })
    for (const { method, path } of ROUTE_INVENTORY.filter((route) => route.unsafe)) {
      const target = path
        .replace(/:(?:simulationId|runId|versionId)/gu, ROUTE_ID)
        .replace(':seedId', 'projectile.introduction')
      for (const origin of [undefined, 'null', 'https://evil.example']) {
        const headers = { 'content-type': 'application/json' } as Record<string, string>
        if (origin !== undefined) headers.origin = origin
        const response = await api.handle(
          request({ method, path: target, headers, body: '{"password":"secret"}' }),
        )
        expect(response.status).toBe(403)
      }
    }
    expect(authentication.login).not.toHaveBeenCalled()
    expect(authentication.bootstrap).not.toHaveBeenCalled()
  })

  it('requires a live session everywhere except public routes and session-bound CSRF when unsafe', async () => {
    const handlers = callbacks()
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: handlers })
    const safe = await api.handle(
      request({
        method: 'GET',
        path: '/api/privacy/settings',
        headers: { cookie: `__Host-simproof_session=${TOKEN}` },
      }),
    )
    expect(safe.status).toBe(200)
    const missingCsrf = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: jsonHeaders({ cookie: `__Host-simproof_session=${TOKEN}` }),
        body: '{"expectedRevision":0,"promptRetention":"discard","externalDiagnosticsEnabled":false}',
      }),
    )
    expect(missingCsrf.status).toBe(403)
    expect(handlers.updatePrivacy).not.toHaveBeenCalled()
    const wrongCsrf = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: jsonHeaders({
          cookie: `__Host-simproof_session=${TOKEN}`,
          'x-csrf-token': WRONG_CSRF,
        }),
        body: '{"promptRetention":"discard"}',
      }),
    )
    expect(wrongCsrf.status).toBe(403)
    expect(handlers.updatePrivacy).not.toHaveBeenCalled()
    const valid = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: authenticatedHeaders(),
        body: '{"expectedRevision":0,"promptRetention":"discard","externalDiagnosticsEnabled":false}',
      }),
    )
    expect(valid.status).toBe(200)
  })

  it('validates authenticated generation start and cancellation inputs', async () => {
    const handlers = callbacks()
    const api = createHttpApi({
      auth: auth(),
      config: config({ request: { maxBytes: 2_048, maxPromptCharacters: 64 } }),
      callbacks: handlers,
    })
    const generation = {
      schemaVersion: '1',
      simulationVersionId: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
      idempotencyKey: 'generation:http:test',
      prompt: 'Build a pendulum simulation.',
      maxAttempts: 3,
      budget: {
        maxProviderRequests: 6,
        maxInputTokens: 1_000,
        maxOutputTokens: 1_000,
        maxCostMicrousd: 10_000,
        maxArtifactBytes: 100_000,
      },
    }
    const started = await api.handle(
      request({
        method: 'POST',
        path: '/api/generation',
        headers: authenticatedHeaders(),
        body: JSON.stringify(generation),
      }),
    )
    const cancelled = await api.handle(
      request({
        method: 'POST',
        path: '/api/generation/cancel',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ idempotencyKey: generation.idempotencyKey }),
      }),
    )
    expect(started.status).toBe(200)
    expect(cancelled.status).toBe(200)
    expect(handlers.startGeneration).toHaveBeenCalledWith(generation, 'session-id')
    expect(handlers.cancelGeneration).toHaveBeenCalledWith(generation.idempotencyKey, 'session-id')

    const invalid = await api.handle(
      request({
        method: 'POST',
        path: '/api/generation',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ ...generation, prompt: 'x'.repeat(65) }),
      }),
    )
    expect(invalid.status).toBe(400)
    expect(handlers.startGeneration).toHaveBeenCalledTimes(1)
  })

  it('rejects encoded, unsupported, malformed, duplicate, unknown, declared-large, and streamed-large JSON', async () => {
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: callbacks() })
    const cases = [
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: { origin: ORIGIN, 'content-type': 'text/plain' },
        body: '{}',
      }),
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders({ 'content-encoding': 'gzip' }),
        body: '{}',
      }),
      request({ method: 'POST', path: '/api/auth/login', headers: jsonHeaders(), body: '{' }),
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders(),
        body: '{"password":"one","password":"two"}',
      }),
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders(),
        body: '{"password":"one","studentId":"forbidden"}',
      }),
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders({ 'content-length': '129' }),
        body: '{}',
      }),
    ]
    for (const value of cases) expect((await api.handle(value)).status).toBeGreaterThanOrEqual(400)

    let chunksRead = 0
    async function* oversized() {
      await Promise.resolve()
      chunksRead += 1
      yield Buffer.alloc(100)
      chunksRead += 1
      yield Buffer.alloc(100)
      chunksRead += 1
      yield Buffer.from('{"password":"not-read"}')
    }
    const streamed = await api.handle(
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders(),
        body: oversized(),
      }),
    )
    expect(streamed.status).toBe(413)
    expect(chunksRead).toBe(2)
  })

  it('reflects only the exact allowed origin and applies security/no-store headers to errors and success', async () => {
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: callbacks() })
    const response = await api.handle(
      request({
        method: 'POST',
        path: '/api/auth/login',
        headers: jsonHeaders(),
        body: '{"password":"secret"}',
      }),
    )
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      value: {
        authenticated: true,
        csrfToken: CSRF,
        expiresAt: '2026-07-16T20:00:00.000Z',
      },
    })
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-credentials': 'true',
      'cache-control': 'no-store',
      'content-security-policy': expect.stringContaining("frame-ancestors 'none'"),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    expect(Object.values(response.headers)).not.toContain('*')
    const denied = await api.handle(request({ method: 'GET', path: '/api/session' }))
    expect(denied.headers['cache-control']).toBe('no-store')
  })

  it('rate-limits auth attempts by the transport source rather than spoofed forwarding headers', async () => {
    const api = createHttpApi({
      auth: auth(),
      config: config(),
      callbacks: callbacks(),
      limiterOptions: { sourceAttempts: 1, globalAttempts: 10 },
    })
    const attempt = (peerAddress: string, forwardedFor: string) =>
      api.handle(
        request({
          method: 'POST',
          path: '/api/auth/login',
          peerAddress,
          headers: jsonHeaders({ 'x-forwarded-for': forwardedFor }),
          body: '{"password":"secret"}',
        }),
      )
    expect((await attempt('203.0.113.5', '198.51.100.1')).status).toBe(200)
    expect((await attempt('203.0.113.5', '198.51.100.2')).status).toBe(429)
    expect((await attempt('203.0.113.6', '198.51.100.2')).status).toBe(200)
  })

  it('rate-limits every route that performs expensive password verification', async () => {
    const expensive = [
      [
        'POST',
        '/api/auth/password',
        '{"currentPassword":"old-password","newPassword":"new-password-long"}',
        200,
      ],
      ['POST', '/api/privacy/export', '{"currentPassword":"old-password"}', 200],
      [
        'DELETE',
        '/api/privacy/simulation',
        '{"currentPassword":"old-password","simulationId":"019f6bc1-0811-70c1-a139-938a3ad2dee0","confirmation":"delete"}',
        200,
      ],
      [
        'POST',
        '/api/simulations/019f6bc1-0811-70c1-a139-938a3ad2dee0/export',
        '{"currentPassword":"old-password","simulationId":"019f6bc1-0811-70c1-a139-938a3ad2dee0"}',
        503,
      ],
    ] as const
    for (const [method, path, body, expectedStatus] of expensive) {
      const isolated = createHttpApi({
        auth: auth(),
        config: config(),
        callbacks: callbacks(),
        limiterOptions: { sourceAttempts: 1, globalAttempts: 20 },
      })
      expect(
        (await isolated.handle(request({ method, path, headers: authenticatedHeaders(), body })))
          .status,
      ).toBe(expectedStatus)
      expect(
        (await isolated.handle(request({ method, path, headers: authenticatedHeaders(), body })))
          .status,
      ).toBe(429)
    }
  })

  it('invokes rotation, logout, password, privacy, export, and deletion callbacks', async () => {
    const authentication = auth()
    const handlers = callbacks()
    const api = createHttpApi({ auth: authentication, config: config(), callbacks: handlers })
    const calls = [
      ['POST', '/api/auth/logout', '{}'],
      ['POST', '/api/auth/rotate', '{}'],
      [
        'POST',
        '/api/auth/password',
        '{"currentPassword":"old-password","newPassword":"new-password-long"}',
      ],
      ['POST', '/api/privacy/export', '{"currentPassword":"old-password"}'],
      [
        'DELETE',
        '/api/privacy/simulation',
        '{"currentPassword":"old-password","simulationId":"019f6bc1-0811-70c1-a139-938a3ad2dee0","confirmation":"delete"}',
      ],
    ] as const
    for (const [method, path, body] of calls) {
      expect(
        (await api.handle(request({ method, path, headers: authenticatedHeaders(), body }))).status,
      ).toBe(200)
    }
    expect(authentication.logout).toHaveBeenCalled()
    expect(authentication.rotate).toHaveBeenCalled()
    expect(authentication.changePassword).toHaveBeenCalled()
    const passwordResponse = await api.handle(
      request({
        method: 'POST',
        path: '/api/auth/password',
        headers: authenticatedHeaders(),
        body: '{"currentPassword":"old-password","newPassword":"new-password-long"}',
      }),
    )
    expect(passwordResponse.headers['set-cookie']).toContain('Max-Age=0')
    expect(handlers.exportData).toHaveBeenCalled()
    expect(handlers.deleteSimulation).toHaveBeenCalled()
  })

  it('maps privacy operation failures to stable non-success responses', async () => {
    const handlers = callbacks()
    handlers.updatePrivacy.mockReturnValue({
      ok: false,
      error: { code: 'conflict', message: 'private revision detail' },
    })
    handlers.exportData.mockReturnValue({
      ok: false,
      error: { code: 'confirmation-failed', message: 'secret detail' },
    })
    handlers.deleteSimulation.mockReturnValue({
      ok: false,
      error: { code: 'operation-failed', message: 'private storage path' },
    })
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: handlers })
    const conflict = await api.handle(
      request({
        method: 'PUT',
        path: '/api/privacy/settings',
        headers: authenticatedHeaders(),
        body: '{"expectedRevision":0,"promptRetention":"discard","externalDiagnosticsEnabled":false}',
      }),
    )
    const denied = await api.handle(
      request({
        method: 'POST',
        path: '/api/privacy/export',
        headers: authenticatedHeaders(),
        body: '{"currentPassword":"wrong password"}',
      }),
    )
    const failed = await api.handle(
      request({
        method: 'DELETE',
        path: '/api/privacy/simulation',
        headers: authenticatedHeaders(),
        body: '{"currentPassword":"old-password","simulationId":"019f6bc1-0811-70c1-a139-938a3ad2dee0","confirmation":"delete"}',
      }),
    )
    expect(conflict).toMatchObject({
      status: 409,
      body: { error: { id: 'http.privacy-conflict' } },
    })
    expect(denied).toMatchObject({ status: 403, body: { error: { id: 'http.password-denied' } } })
    expect(failed).toMatchObject({ status: 500, body: { error: { id: 'http.internal-error' } } })
    expect(JSON.stringify([conflict, denied, failed])).not.toMatch(
      /private revision detail|secret detail|private storage path/u,
    )
  })

  it('returns stable redacted errors when callbacks throw', async () => {
    const handlers = callbacks()
    handlers.getPrivacy.mockImplementation(() => {
      throw new Error('OPENAI_KEY=secret at /Users/operator/private')
    })
    const api = createHttpApi({ auth: auth(), config: config(), callbacks: handlers })
    const response = await api.handle(
      request({
        method: 'GET',
        path: '/api/privacy/settings',
        headers: { cookie: `__Host-simproof_session=${TOKEN}` },
      }),
    )
    expect(response).toMatchObject({
      status: 500,
      body: { ok: false, error: { id: 'http.internal-error' } },
    })
    expect(JSON.stringify(response)).not.toMatch(/OPENAI|secret|\/Users/u)
  })
})
