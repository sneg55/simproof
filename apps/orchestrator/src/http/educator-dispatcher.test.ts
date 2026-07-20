import { describe, expect, it, vi } from 'vitest'

import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { EducatorDispatcher } from './educator-dispatcher.js'
import { matchRequestTarget } from './route-url.js'
import { ROUTE_INVENTORY, type RouteDefinition, type RouteKey } from './routes.js'
import type { EducatorHttpCallbacks, HttpOperationResult } from './types.js'

const simulationId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const versionId = '029f6bc1-0811-70c1-a139-938a3ad2dee0'
const runId = '039f6bc1-0811-70c1-a139-938a3ad2dee0'
const educatorKeys = [
  'bootstrap-capability',
  'runtime-config',
  'seeds-list',
  'seed-detail',
  'seed-report',
  'seed-preview',
  'simulations-list',
  'simulation-detail',
  'simulation-create',
  'simulation-history',
  'simulation-compare',
  'simulation-version-create',
  'simulation-duplicate',
  'educator-generation-start',
  'educator-generation-status',
  'educator-generation-concept',
  'educator-generation-cancel',
  'version-report',
  'version-publish',
  'version-archive',
  'version-reverify',
  'simulation-export',
  'version-preview',
] as const satisfies readonly RouteKey[]

const ok = <T>(value: T): HttpOperationResult<T> => ({ ok: true, value })

function route(key: RouteKey): RouteDefinition {
  const found = ROUTE_INVENTORY.find((candidate) => candidate.key === key)
  if (found === undefined) throw new TypeError(`Missing route ${key}`)
  return found
}

function context(
  key: RouteKey,
  input: {
    readonly body?: unknown
    readonly parameters?: Readonly<Record<string, string>>
    readonly query?: Readonly<Record<string, string>>
  } = {},
) {
  return {
    route: route(key),
    body: input.body,
    parameters: input.parameters ?? {},
    query: input.query ?? {},
    sessionId: 'browser-session',
    origin: 'https://simproof.test',
  }
}

function callbacks(overrides: Partial<EducatorHttpCallbacks> = {}): EducatorHttpCallbacks {
  const unavailable = () =>
    Promise.resolve({
      ok: false as const,
      error: { code: 'operation-failed' as const, message: 'internal callback message' },
    })
  return {
    bootstrapCapability: unavailable,
    runtimeConfig: unavailable,
    listSeeds: unavailable,
    getSeed: unavailable,
    getSeedReport: unavailable,
    previewSeed: unavailable,
    listSimulations: unavailable,
    getSimulation: unavailable,
    createSimulation: unavailable,
    versionHistory: unavailable,
    compareVersions: unavailable,
    startBlankVersion: unavailable,
    duplicateSimulation: unavailable,
    startGeneration: unavailable,
    generationStatus: unavailable,
    decideConcept: unavailable,
    cancelGeneration: unavailable,
    getReport: unavailable,
    publishVersion: unavailable,
    archiveVersion: unavailable,
    reverifyVersion: unavailable,
    exportSimulation: unavailable,
    previewVersion: unavailable,
    ...overrides,
  }
}

describe('educator HTTP route inventory', () => {
  it('owns the complete authenticated resource surface plus public bootstrap capability', () => {
    expect(
      ROUTE_INVENTORY.filter(({ key }) =>
        educatorKeys.includes(key as (typeof educatorKeys)[number]),
      )
        .map(({ key }) => key)
        .sort(),
    ).toEqual([...educatorKeys].sort())
    expect(route('bootstrap-capability')).toMatchObject({ access: 'public', unsafe: false })
    for (const key of educatorKeys.filter((key) => key !== 'bootstrap-capability')) {
      expect(route(key).access).toBe('authenticated')
    }
  })

  it('matches canonical resource parameters and only declared query keys', () => {
    expect(
      matchRequestTarget(
        'GET',
        `/api/simulations/${simulationId}/compare?left=${versionId}&right=${simulationId}`,
        ROUTE_INVENTORY,
      ),
    ).toMatchObject({
      ok: true,
      match: {
        parameters: { simulationId },
        query: { left: versionId, right: simulationId },
        route: { key: 'simulation-compare' },
      },
    })
    expect(
      matchRequestTarget('GET', '/api/simulations?credential=secret', ROUTE_INVENTORY),
    ).toEqual({ ok: false, errorId: 'http.invalid-request-target' })
    expect(
      matchRequestTarget('GET', '/api/seeds/projectile.introduction', ROUTE_INVENTORY),
    ).toMatchObject({
      ok: true,
      match: { parameters: { seedId: 'projectile.introduction' }, route: { key: 'seed-detail' } },
    })
  })
})

describe('educator HTTP dispatcher', () => {
  it('strictly serves identifier-keyed seed detail, report, and preview resources', async () => {
    const catalog = createBundledSeedCatalog()
    const dispatcher = new EducatorDispatcher(
      callbacks({
        getSeed: (id) => catalog.detail(id),
        getSeedReport: (id) => catalog.report(id),
        previewSeed: (id, input) => catalog.preview(id, input),
      }),
    )
    const parameters = { seedId: 'projectile.introduction' }
    const detail = await dispatcher.dispatch(context('seed-detail', { parameters }))
    const report = await dispatcher.dispatch(context('seed-report', { parameters }))
    const preview = await dispatcher.dispatch(
      context('seed-preview', {
        parameters,
        body: {
          domain: 'projectile',
          expectedVersionRevision: 4,
          input: { initialSpeedMps: 30, launchAngleDeg: 45 },
          sampleCount: 25,
        },
      }),
    )
    expect(detail).toMatchObject({ status: 200, body: { ok: true } })
    expect(report).toMatchObject({ status: 200, body: { ok: true } })
    expect(preview).toMatchObject({
      status: 200,
      body: { ok: true, value: { domain: 'projectile', samples: { length: 25 } } },
    })
  })

  it('parses bounded list query values and validates the callback response', async () => {
    const list = vi.fn(() => ok({ items: [], nextCursor: null }))
    const dispatcher = new EducatorDispatcher(callbacks({ listSimulations: list }))
    const response = await dispatcher.dispatch(
      context('simulations-list', {
        query: {
          search: 'launch lab',
          domain: 'projectile,pendulum',
          state: 'verified,published',
          source: 'seed',
          limit: '25',
        },
      }),
    )
    expect(response).toMatchObject({ status: 200, body: { ok: true, value: { items: [] } } })
    expect(list).toHaveBeenCalledWith(
      {
        search: 'launch lab',
        domains: ['projectile', 'pendulum'],
        states: ['verified', 'published'],
        sources: ['seed'],
        limit: 25,
      },
      'browser-session',
    )
  })

  it('rejects unknown or malformed mutation bodies before callbacks run', async () => {
    const callback = vi.fn(() => ({
      ok: false as const,
      error: { code: 'operation-failed' as const, message: 'must not run' },
    }))
    const dispatcher = new EducatorDispatcher(
      callbacks({
        createSimulation: callback,
        previewSeed: callback,
        startBlankVersion: callback,
        duplicateSimulation: callback,
        startGeneration: callback,
        decideConcept: callback,
        cancelGeneration: callback,
        publishVersion: callback,
        archiveVersion: callback,
        reverifyVersion: callback,
        exportSimulation: callback,
        previewVersion: callback,
      }),
    )
    const cases: readonly [RouteKey, Readonly<Record<string, string>>][] = [
      ['seed-preview', { seedId: 'projectile.introduction' }],
      ['simulation-create', {}],
      ['simulation-version-create', { simulationId }],
      ['simulation-duplicate', { simulationId }],
      ['educator-generation-start', {}],
      ['educator-generation-concept', { runId }],
      ['educator-generation-cancel', { runId }],
      ['version-publish', { versionId }],
      ['version-archive', { versionId }],
      ['version-reverify', { versionId }],
      ['simulation-export', { simulationId }],
      ['version-preview', { versionId }],
    ]
    for (const [key, parameters] of cases) {
      const response = await dispatcher.dispatch(
        context(key, { body: { unexpected: 'secret' }, parameters }),
      )
      expect(response).toMatchObject({ status: 400, body: { error: { id: 'http.invalid-input' } } })
    }
    expect(callback).not.toHaveBeenCalled()
  })

  it('accepts asynchronous generation without returning prompt or internal provenance', async () => {
    const start = vi.fn(() => ok({ runId, created: true, state: 'queued' as const, revision: 0 }))
    const dispatcher = new EducatorDispatcher(callbacks({ startGeneration: start }))
    const response = await dispatcher.dispatch(
      context('educator-generation-start', {
        body: {
          schemaVersion: '1',
          simulationVersionId: versionId,
          expectedVersionRevision: 0,
          idempotencyKey: 'generation:lesson:1',
          teacher: {
            prompt: 'Create a projectile simulation.',
            externalProviderDisclosureAccepted: true,
            promptRetention: 'discard',
          },
          maxAttempts: 3,
          budget: {
            maxProviderRequests: 6,
            maxInputTokens: 20_000,
            maxOutputTokens: 8_000,
            maxCostMicrousd: 100_000,
            maxArtifactBytes: 1_000_000,
          },
        },
      }),
    )
    expect(response).toMatchObject({
      status: 202,
      body: { ok: true, value: { runId, state: 'queued' } },
    })
    expect(JSON.stringify(response)).not.toContain('Create a projectile')
  })

  it('fails closed on invalid callback values and redacts internal callback errors', async () => {
    const invalid = new EducatorDispatcher(
      callbacks({
        listSimulations: () => ok({ items: [], nextCursor: null, coreSource: 'secret' }),
      }),
    )
    const invalidResponse = await invalid.dispatch(context('simulations-list'))
    expect(invalidResponse).toMatchObject({
      status: 500,
      body: { error: { id: 'http.internal-error' } },
    })
    expect(JSON.stringify(invalidResponse)).not.toContain('coreSource')

    const failed = new EducatorDispatcher(callbacks())
    const failedResponse = await failed.dispatch(context('runtime-config'))
    expect(failedResponse).toMatchObject({
      status: 503,
      body: { error: { id: 'http.educator-unavailable' } },
    })
    expect(JSON.stringify(failedResponse)).not.toContain('internal callback message')
  })

  it('binds comparison and export identities to canonical resource parameters', async () => {
    const denied = () => ({
      ok: false as const,
      error: { code: 'operation-failed' as const, message: 'must not run' },
    })
    const compare = vi.fn(denied)
    const exportSimulation = vi.fn(denied)
    const dispatcher = new EducatorDispatcher(
      callbacks({ compareVersions: compare, exportSimulation }),
    )
    const badCompare = await dispatcher.dispatch(
      context('simulation-compare', {
        parameters: { simulationId },
        query: { left: 'not-a-uuid', right: versionId },
      }),
    )
    expect(badCompare?.status).toBe(400)
    const badExport = await dispatcher.dispatch(
      context('simulation-export', {
        parameters: { simulationId },
        body: { simulationId: versionId, currentPassword: 'teacher-password' },
      }),
    )
    expect(badExport?.status).toBe(400)
    expect(compare).not.toHaveBeenCalled()
    expect(exportSimulation).not.toHaveBeenCalled()
  })

  it('returns undefined for pre-existing non-educator routes', async () => {
    const dispatcher = new EducatorDispatcher(callbacks())
    await expect(dispatcher.dispatch(context('health'))).resolves.toBeUndefined()
  })
})
