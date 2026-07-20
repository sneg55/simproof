// LOC-EXEMPT: End-to-end application security, generation wiring, and startup recovery share one authenticated fixture.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MIN_REQUEST_BODY_BYTES } from '@simproof/contracts'
import { createPersistence, err, PrivacyRepository } from '@simproof/persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ApplicationOptions,
  createApplication,
  createOrchestratorApplication,
} from './application.js'
import { parseEnvironment } from './config/environment.js'
import { createNodeHttpServer, nodeRequestToHttpRequest } from './http/node-server.js'
import type { HttpRequest } from './http/types.js'
import { createObservabilityRuntime } from './operations/observability-runtime.js'

const ORIGIN = 'https://simproof.example.edu'
const SURROGATE_PATTERN = '\ud800\ud801\ud802\ud803\ud804\ud805\ud806\ud807\ud808\ud809\ud80a\ud80b'
const BOOTSTRAP_SECRET = `${SURROGATE_PATTERN.repeat(85)}\ud800\ud801\ud802\ud803`
const SESSION_SECRET = 'session-secret-that-is-at-least-32-bytes-long'
const PASSWORD = '\u0001'.repeat(1_024)
const NOW = '2026-07-16T12:00:00.000Z'
const REQUEST_ID = '019f6bc1-0811-70c1-a139-938a3ad2dee1'
const roots: string[] = []

async function fixture(options: ApplicationOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-orchestrator-app-'))
  roots.push(root)
  const databasePath = join(root, 'metadata.sqlite')
  const artifactRoot = join(root, 'artifacts')
  const seeded = createPersistence(databasePath)
  expect(seeded.migrate()).toMatchObject({ ok: true })
  const simulationId = randomUUID()
  expect(
    seeded.createSimulation({
      id: simulationId,
      title: 'Teacher simulation',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  ).toMatchObject({ ok: true })
  seeded.close()
  const application = createOrchestratorApplication(
    {
      NODE_ENV: 'production',
      SIMPROOF_DEPLOYMENT_MODE: 'network',
      SIMPROOF_DATABASE_PATH: databasePath,
      SIMPROOF_ARTIFACT_ROOT: artifactRoot,
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
      SIMPROOF_SESSION_SECRET: SESSION_SECRET,
      SIMPROOF_ALLOWED_ORIGINS: ORIGIN,
      SIMPROOF_MAX_REQUEST_BYTES: String(MIN_REQUEST_BODY_BYTES),
    },
    options,
  )
  return { application, databasePath, simulationId }
}

function apiRequest(input: {
  method: string
  path: string
  body?: unknown
  cookie?: string
  csrf?: string
}): HttpRequest {
  const encoded = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body))
  return {
    method: input.method,
    path: input.path,
    peerAddress: '203.0.113.10',
    headers: {
      origin: ORIGIN,
      ...(encoded === undefined
        ? {}
        : { 'content-type': 'application/json', 'content-length': String(encoded.byteLength) }),
      ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
      ...(input.csrf === undefined ? {} : { 'x-csrf-token': input.csrf }),
    },
    ...(encoded === undefined ? {} : { body: encoded }),
  }
}

function session(
  response: Awaited<ReturnType<ReturnType<typeof createOrchestratorApplication>['api']['handle']>>,
) {
  const body = response.body as { value: { csrfToken: string } }
  const cookie = response.headers['set-cookie']?.split(';')[0]
  if (cookie === undefined) throw new TypeError('Login did not issue a session cookie.')
  return { cookie, csrf: body.value.csrfToken }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('composed orchestrator application', () => {
  it('keeps liveness dependency-free and derives readiness from local dependency probes', async () => {
    const context = await fixture()
    try {
      const health = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/health' }),
      )
      const readiness = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/ready' }),
      )

      expect(health).toMatchObject({ status: 200, body: { value: { status: 'ok' } } })
      expect(readiness).toMatchObject({
        status: 200,
        body: { value: { status: 'ready' } },
      })
      expect(health.headers['x-simproof-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )
      expect(readiness.headers['x-simproof-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )
    } finally {
      await context.application.close()
    }
  })

  it('keeps health live while an injected local readiness dependency fails', async () => {
    const context = await fixture({
      readiness: {
        artifacts: () => ({ ok: false, errorId: 'artifact-store.unavailable' }),
      },
    })
    try {
      const health = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/health' }),
      )
      const readiness = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/ready' }),
      )

      expect(health.status).toBe(200)
      expect(readiness).toMatchObject({
        status: 503,
        body: { error: { id: 'artifact-store.unavailable' } },
      })
    } finally {
      await context.application.close()
    }
  })

  it('composes the browser-safe educator seed and draft services', async () => {
    const context = await fixture()
    try {
      const capability = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/api/bootstrap-capability' }),
      )
      expect(capability).toMatchObject({
        status: 200,
        body: { ok: true, value: { bootstrapAvailable: true } },
      })
      await context.application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/auth/bootstrap',
          body: { bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD },
        }),
      )
      const login = await context.application.api.handle(
        apiRequest({ method: 'POST', path: '/api/auth/login', body: { password: PASSWORD } }),
      )
      const authenticated = session(login)
      const seeds = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/api/seeds', cookie: authenticated.cookie }),
      )
      expect(seeds).toMatchObject({
        status: 200,
        body: {
          ok: true,
          value: [
            { seedId: 'pendulum.small-angle' },
            { seedId: 'projectile.introduction' },
            { seedId: 'projectile.maximum-range' },
            { seedId: 'projectile.complementary-angles' },
            { seedId: 'projectile.speed-scaling' },
            { seedId: 'pendulum.length-law' },
            { seedId: 'pendulum.amplitude-assumption' },
          ],
        },
      })
      const created = await context.application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/simulations',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: { title: 'Browser-created lesson' },
        }),
      )
      expect(created).toMatchObject({
        status: 201,
        body: {
          ok: true,
          value: {
            simulation: { title: 'Browser-created lesson', source: { kind: 'teacher' } },
            selectedVersion: { summary: { state: 'draft', revision: 0 } },
          },
        },
      })
      const afterBootstrap = await context.application.api.handle(
        apiRequest({ method: 'GET', path: '/api/bootstrap-capability' }),
      )
      expect(afterBootstrap).toMatchObject({
        status: 200,
        body: { ok: true, value: { bootstrapAvailable: false } },
      })
    } finally {
      await context.application.close()
    }
  })

  it('wires real bootstrap, authentication, privacy update/export, and deletion services', async () => {
    const context = await fixture()
    try {
      const bootstrapBody = { bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD }
      const encodedBootstrap = Buffer.from(JSON.stringify(bootstrapBody))
      expect(BOOTSTRAP_SECRET).toHaveLength(1_024)
      expect(new TextEncoder().encode(PASSWORD)).toHaveLength(1_024)
      expect(encodedBootstrap.byteLength).toBeGreaterThan(12_288)
      expect(encodedBootstrap.byteLength).toBeLessThanOrEqual(MIN_REQUEST_BODY_BYTES)
      const bootstrap = await context.application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/auth/bootstrap',
          body: bootstrapBody,
        }),
      )
      expect(bootstrap.status).toBe(200)
      const login = await context.application.api.handle(
        apiRequest({ method: 'POST', path: '/api/auth/login', body: { password: PASSWORD } }),
      )
      expect(login.status).toBe(200)
      const authenticated = session(login)

      const initial = await context.application.api.handle({
        ...apiRequest({
          method: 'GET',
          path: '/api/privacy/settings',
          cookie: authenticated.cookie,
        }),
        headers: { cookie: authenticated.cookie },
      })
      expect(initial).toMatchObject({
        status: 200,
        body: {
          ok: true,
          value: { promptRetentionEnabled: false, telemetryEnabled: false, revision: 0 },
        },
      })
      const updated = await context.application.api.handle(
        apiRequest({
          method: 'PUT',
          path: '/api/privacy/settings',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: {
            expectedRevision: 0,
            promptRetention: 'persist',
            externalDiagnosticsEnabled: false,
          },
        }),
      )
      expect(updated).toMatchObject({ status: 200, body: { value: { revision: 1 } } })
      const staleUpdate = await context.application.api.handle(
        apiRequest({
          method: 'PUT',
          path: '/api/privacy/settings',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: {
            expectedRevision: 0,
            promptRetention: 'discard',
            externalDiagnosticsEnabled: false,
          },
        }),
      )
      expect(staleUpdate).toMatchObject({
        status: 409,
        body: { ok: false, error: { id: 'http.privacy-conflict' } },
      })
      expect(JSON.stringify(staleUpdate)).not.toMatch(/revision|concurrent|sqlite/iu)

      const deniedExport = await context.application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/privacy/export',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: { currentPassword: 'wrong password' },
        }),
      )
      expect(deniedExport).toMatchObject({
        status: 403,
        body: { ok: false, error: { id: 'http.password-denied' } },
      })
      expect(JSON.stringify(deniedExport)).not.toContain('confirmation-failed')

      const exported = await context.application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/privacy/export',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: { currentPassword: PASSWORD },
        }),
      )
      expect(exported).toMatchObject({
        status: 200,
        body: {
          value: {
            schemaVersion: '1',
            simulations: [{ simulation: { id: context.simulationId } }],
          },
        },
      })

      const deleted = await context.application.api.handle(
        apiRequest({
          method: 'DELETE',
          path: '/api/privacy/simulation',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: {
            currentPassword: PASSWORD,
            simulationId: context.simulationId,
            confirmation: 'delete',
          },
        }),
      )
      expect(deleted.status).toBe(200)
    } finally {
      await context.application.close()
    }
    const reopened = createPersistence(context.databasePath)
    expect(reopened.getSimulation(context.simulationId)).toMatchObject({ ok: false })
    reopened.close()
  })

  it('adapts Node transport metadata and rejects an oversized composed request stream', async () => {
    const context = await fixture()
    const server = createNodeHttpServer(context.application.api)
    try {
      expect(server.listening).toBe(false)
      const transport = {
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          'x-simproof-request-id': '019f6bc1-0811-70c1-a139-938a3ad2deff',
        },
        socket: { remoteAddress: '203.0.113.44' },
      } as unknown as IncomingMessage
      expect(nodeRequestToHttpRequest(transport, () => REQUEST_ID)).toMatchObject({
        method: 'POST',
        path: '/api/auth/login',
        peerAddress: '203.0.113.44',
        requestId: REQUEST_ID,
      })
      async function* oversized() {
        await Promise.resolve()
        yield Buffer.alloc(65_537, 120)
      }
      const response = await context.application.api.handle({
        method: 'POST',
        path: '/api/auth/login',
        peerAddress: '203.0.113.44',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: oversized(),
      })
      expect(response.status).toBe(413)
      expect(JSON.stringify(response.body)).toContain('http.body-too-large')
      expect(JSON.stringify(response.body)).not.toContain(SESSION_SECRET)
    } finally {
      await context.application.close()
    }
  })

  it('routes authenticated generation and cancellation through the injected server runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-generation-app-'))
    roots.push(root)
    const databasePath = join(root, 'metadata.sqlite')
    const simulationId = randomUUID()
    const simulationVersionId = randomUUID()
    const generationRunId = randomUUID()
    const seeded = createPersistence(databasePath)
    expect(seeded.migrate()).toMatchObject({ ok: true })
    expect(
      seeded.createSimulation({
        id: simulationId,
        title: 'Generation privacy integration',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toMatchObject({ ok: true })
    expect(
      seeded.createDraftVersion({
        id: simulationVersionId,
        simulationId,
        versionNumber: 1,
        state: 'draft',
        revision: 0,
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toMatchObject({ ok: true })
    seeded.close()
    const start = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          id: generationRunId,
          state: 'verified' as const,
          revision: 6,
          maxAttempts: 3,
          attemptCount: 1,
          budget: {
            limits: {
              maxProviderRequests: 6,
              maxInputTokens: 1_000,
              maxOutputTokens: 1_000,
              maxCostMicrousd: 10_000,
              maxArtifactBytes: 100_000,
            },
            consumed: {
              providerRequests: 2,
              inputTokens: 0,
              outputTokens: 0,
              costMicrousd: 0,
              artifactBytes: 1_000,
            },
          },
        },
      }),
    )
    const cancel = vi.fn(() => ({
      ok: true as const,
      value: { idempotencyKey: 'generation:application', cancellationRequested: true as const },
    }))
    const closeGeneration = vi.fn(() => Promise.resolve())
    const runnerReadiness = vi.fn(() => ({ ok: true as const }))
    const application = createApplication(
      parseEnvironment({
        NODE_ENV: 'production',
        SIMPROOF_DEPLOYMENT_MODE: 'network',
        SIMPROOF_DATABASE_PATH: databasePath,
        SIMPROOF_ARTIFACT_ROOT: join(root, 'artifacts'),
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
        SIMPROOF_SESSION_SECRET: SESSION_SECRET,
        SIMPROOF_ALLOWED_ORIGINS: ORIGIN,
        SIMPROOF_MAX_REQUEST_BYTES: String(MIN_REQUEST_BODY_BYTES),
      }),
      {
        generation: {
          resolveInstalledEvidence: () => err('invalid-state', 'No verification in this test.'),
          runnerReadiness,
          create: vi.fn(() => ({ start, cancel, close: closeGeneration })),
        },
      },
    )
    try {
      expect(
        await application.api.handle(apiRequest({ method: 'GET', path: '/ready' })),
      ).toMatchObject({ status: 200, body: { value: { status: 'ready' } } })
      expect(runnerReadiness).toHaveBeenCalledOnce()
      await application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/auth/bootstrap',
          body: { bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD },
        }),
      )
      const login = await application.api.handle(
        apiRequest({ method: 'POST', path: '/api/auth/login', body: { password: PASSWORD } }),
      )
      const authenticated = session(login)
      const generation = {
        schemaVersion: '1',
        simulationVersionId,
        idempotencyKey: 'generation:application',
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
      const started = await application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/generation',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: generation,
        }),
      )
      const beforeOptIn = new PrivacyRepository(databasePath)
      expect(beforeOptIn.exportPrompts()).toEqual({ ok: true, value: [] })
      beforeOptIn.close()
      const privacyUpdate = await application.api.handle(
        apiRequest({
          method: 'PUT',
          path: '/api/privacy/settings',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: {
            expectedRevision: 0,
            promptRetention: 'persist',
            externalDiagnosticsEnabled: false,
          },
        }),
      )
      expect(privacyUpdate.status).toBe(200)
      const retainedGeneration = {
        ...generation,
        idempotencyKey: 'generation:application:retained',
        prompt: 'Retain this pendulum prompt exactly once.',
      }
      for (let replay = 0; replay < 2; replay += 1) {
        const response = await application.api.handle(
          apiRequest({
            method: 'POST',
            path: '/api/generation',
            cookie: authenticated.cookie,
            csrf: authenticated.csrf,
            body: retainedGeneration,
          }),
        )
        expect(response.status).toBe(200)
      }
      const afterReplay = new PrivacyRepository(databasePath)
      expect(afterReplay.exportPrompts()).toMatchObject({
        ok: true,
        value: [
          {
            id: generationRunId,
            simulationId,
            prompt: retainedGeneration.prompt,
          },
        ],
      })
      afterReplay.close()
      const cancelled = await application.api.handle(
        apiRequest({
          method: 'POST',
          path: '/api/generation/cancel',
          cookie: authenticated.cookie,
          csrf: authenticated.csrf,
          body: { idempotencyKey: retainedGeneration.idempotencyKey },
        }),
      )
      expect(started).toMatchObject({ status: 200, body: { value: { state: 'verified' } } })
      expect(cancelled.status).toBe(200)
      expect(start).toHaveBeenNthCalledWith(1, generation)
      expect(start).toHaveBeenNthCalledWith(2, retainedGeneration)
      expect(start).toHaveBeenNthCalledWith(3, retainedGeneration)
      expect(cancel).toHaveBeenCalledWith(retainedGeneration.idempotencyKey)
    } finally {
      await application.close()
    }
    expect(closeGeneration).toHaveBeenCalledTimes(1)
  })

  it('recovers interrupted durable generation before serving requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-recovery-app-'))
    roots.push(root)
    const databasePath = join(root, 'metadata.sqlite')
    const versionId = randomUUID()
    const runId = randomUUID()
    const seeded = createPersistence(databasePath)
    expect(seeded.migrate()).toMatchObject({ ok: true })
    const simulation = seeded.createSimulation({
      id: randomUUID(),
      title: 'Interrupted generation',
      createdAt: NOW,
      updatedAt: NOW,
    })
    if (!simulation.ok) throw new TypeError('Simulation seed failed.')
    expect(
      seeded.createDraftVersion({
        id: versionId,
        simulationId: simulation.value.id,
        versionNumber: 1,
        state: 'draft',
        revision: 0,
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toMatchObject({ ok: true })
    expect(
      seeded.beginOrReplayGeneration({
        versionId,
        expectedRevision: 0,
        idempotencyKey: 'generation:recovery:application',
        updatedAt: NOW,
        run: { id: runId, maxAttempts: 3, codexSessionId: null, createdAt: NOW },
        budgets: {
          providerRequests: 6,
          inputTokens: 1_000,
          outputTokens: 1_000,
          costMicrousd: 10_000,
          artifactBytes: 100_000,
        },
      }),
    ).toMatchObject({ ok: true })
    seeded.close()

    const environment = {
      NODE_ENV: 'production',
      SIMPROOF_DEPLOYMENT_MODE: 'network',
      SIMPROOF_DATABASE_PATH: databasePath,
      SIMPROOF_ARTIFACT_ROOT: join(root, 'artifacts'),
      SIMPROOF_DIAGNOSTIC_LOG_ROOT: join(root, 'diagnostics'),
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
      SIMPROOF_SESSION_SECRET: SESSION_SECRET,
      SIMPROOF_ALLOWED_ORIGINS: ORIGIN,
    } as const
    const config = parseEnvironment(environment)
    const observability = createObservabilityRuntime(config)
    const application = createApplication(config, { observability })
    await application.close()

    const recoveryEvents = observability
      .recent(20)
      .filter(
        ({ event }) =>
          event === 'generation.transition' || event === 'generation.transition.persisted',
      )
    expect(recoveryEvents).toEqual([
      expect.objectContaining({
        component: 'orchestrator',
        event: 'generation.transition',
        correlation: { runId, simulationId: versionId },
        attributes: { fromState: 'queued', toState: 'invariant_failed' },
      }),
      expect.objectContaining({
        component: 'persistence',
        event: 'generation.transition.persisted',
        correlation: { runId, simulationId: versionId },
        attributes: { fromState: 'queued', toState: 'invariant_failed' },
      }),
    ])
    expect(observability.metrics.snapshot().transitions).toEqual([
      { from: 'queued', to: 'invariant_failed', count: 1 },
    ])

    const replayObservability = createObservabilityRuntime(config)
    const replay = createApplication(config, { observability: replayObservability })
    await replay.close()
    expect(replayObservability.metrics.snapshot().transitions).toEqual([])
    expect(
      replayObservability
        .recent(20)
        .filter(({ event }) => event === 'generation.transition.persisted'),
    ).toEqual([])

    const recovered = createPersistence(databasePath)
    expect(recovered.generation.get(runId)).toMatchObject({
      ok: true,
      value: {
        state: 'invariant_failed',
        stableErrorId: 'orchestration.interrupted',
      },
    })
    expect(recovered.getVersion(versionId)).toMatchObject({
      ok: true,
      value: { state: 'draft', activeGeneratedArtifactId: null },
    })
    recovered.close()
  })
})
