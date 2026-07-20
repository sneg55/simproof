import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ArtifactStore, createPersistence } from '@simproof/persistence'
import { afterEach, describe, expect, it } from 'vitest'

import type { ServerConfig } from '../config/environment.js'
import { createEducatorService } from './service.js'

const IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000012',
]
const NOW = '2026-07-16T12:00:00.000Z'
const paths: string[] = []

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function context(options: { configured?: boolean; password?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-educator-'))
  paths.push(root)
  const database = createPersistence(join(root, 'metadata.sqlite'))
  expect(database.migrate()).toMatchObject({ ok: true })
  const artifacts = new ArtifactStore(join(root, 'artifacts'))
  let idIndex = 0
  const service = createEducatorService({
    database,
    artifacts,
    config: config(root, options.configured ?? false),
    bootstrapAvailable: () => true,
    authorizeSession: (sessionId) => sessionId === 'owned-session',
    confirmPassword: (password, sessionId) =>
      Promise.resolve(
        (options.password ?? true) &&
          password === 'correct horse battery staple' &&
          sessionId === 'owned-session',
      ),
    createId: () => IDS[idIndex++] ?? IDS.at(-1)!,
    now: () => NOW,
  })
  return { database, service }
}

describe('educator application service', () => {
  it('serves bootstrap/runtime diagnostics and bundled seeds without credentials', async () => {
    const { database, service } = await context()
    try {
      expect(await service.bootstrapCapability()).toEqual({
        ok: true,
        value: { bootstrapAvailable: true },
      })
      expect(await service.runtimeConfig('owned-session')).toMatchObject({
        ok: true,
        value: {
          runtime: { providerConfigured: false },
          generation: { available: false, reason: 'provider-not-configured' },
          seedLibraryReady: true,
        },
      })
      const seeds = await service.listSeeds('owned-session')
      expect(seeds.ok && seeds.value.map(({ seedId }) => seedId)).toEqual([
        'pendulum.small-angle',
        'projectile.introduction',
        'projectile.maximum-range',
        'projectile.complementary-angles',
        'projectile.speed-scaling',
        'pendulum.length-law',
        'pendulum.amplitude-assumption',
      ])
      if (!seeds.ok) throw new Error('seed catalog unavailable')
      expect(await service.getSeed(seeds.value[0]!.seedId, 'owned-session')).toMatchObject({
        ok: true,
        value: { simulation: { source: { kind: 'seed' } } },
      })
      expect(await service.getSeedReport(seeds.value[0]!.seedId, 'owned-session')).toMatchObject({
        ok: true,
        value: { badgeActive: true, validity: { status: 'current' } },
      })
      const report = await service.getSeedReport(seeds.value[0]!.seedId, 'owned-session')
      expect(JSON.stringify(report)).not.toMatch(
        /server-only|session-secret|bootstrap-secret|prompt|threadId|requestIds|sourceCode/u,
      )
    } finally {
      database.close()
    }
  })

  it('creates drafts and preserves CAS and aggregate ownership for versions and duplicates', async () => {
    const { database, service } = await context()
    try {
      const created = await service.createSimulation({ title: '  My lesson  ' }, 'owned-session')
      expect(created).toMatchObject({
        ok: true,
        value: {
          simulation: { title: 'My lesson' },
          selectedVersion: { summary: { revision: 0 } },
        },
      })
      if (!created.ok) throw new Error('draft not created')
      const simulationId = created.value.simulation.id
      const versionId = created.value.selectedVersion.summary.id
      const next = await service.startBlankVersion(
        simulationId,
        { sourceVersionId: versionId, expectedSourceRevision: 0 },
        'owned-session',
      )
      expect(next).toMatchObject({
        ok: true,
        value: { selectedVersion: { summary: { versionNumber: 2 } } },
      })
      expect(
        await service.startBlankVersion(
          simulationId,
          { sourceVersionId: versionId, expectedSourceRevision: 1 },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      const duplicate = await service.duplicateSimulation(
        simulationId,
        { title: 'Copy', sourceVersionId: versionId, expectedSourceRevision: 0 },
        'owned-session',
      )
      expect(duplicate).toMatchObject({
        ok: true,
        value: { simulation: { title: 'Copy' }, selectedVersion: { summary: { state: 'draft' } } },
      })
      expect(await service.versionHistory(simulationId, 'owned-session')).toMatchObject({
        ok: true,
        value: { versions: [{ summary: { versionNumber: 1 } }, { summary: { versionNumber: 2 } }] },
      })
      const teacherList = await service.listSimulations(
        { search: '', domains: [], states: [], sources: ['teacher'], limit: 50 },
        'owned-session',
      )
      expect(teacherList.ok && teacherList.value.items).toHaveLength(2)
      expect(
        teacherList.ok && teacherList.value.items.every(({ source }) => source.kind === 'teacher'),
      ).toBe(true)
      expect(
        await service.listSimulations(
          {
            search: '',
            domains: ['pendulum', 'projectile'],
            states: [],
            sources: ['teacher'],
            limit: 50,
          },
          'owned-session',
        ),
      ).toEqual({ ok: true, value: { items: [], nextCursor: null } })
      expect(
        await service.listSimulations(
          { search: '', domains: [], states: [], sources: ['seed', 'teacher'], limit: 50 },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    } finally {
      database.close()
    }
  })

  it('archives with expected revision, confirms exports, and strips session provenance', async () => {
    const { database, service } = await context()
    try {
      const created = await service.createSimulation({ title: 'Archive me' }, 'owned-session')
      if (!created.ok) throw new Error('draft not created')
      const versionId = created.value.selectedVersion.summary.id
      expect(
        await service.archiveVersion(versionId, { expectedRevision: 0 }, 'owned-session'),
      ).toMatchObject({
        ok: true,
        value: { selectedVersion: { summary: { state: 'archived', revision: 1 } } },
      })
      expect(
        await service.archiveVersion(versionId, { expectedRevision: 0 }, 'owned-session'),
      ).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      expect(
        await service.exportSimulation(
          { simulationId: created.value.simulation.id, currentPassword: 'wrong password value' },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'confirmation-failed' } })
      expect(
        await service.exportSimulation(
          {
            simulationId: created.value.simulation.id,
            currentPassword: 'correct horse battery staple',
          },
          'owned-session',
        ),
      ).toMatchObject({ ok: true, value: { records: { generationRuns: [] } } })
    } finally {
      database.close()
    }
  })

  it('fails closed for unowned sessions and unavailable generation/preview ports', async () => {
    const { database, service } = await context({ configured: true })
    try {
      const created = await service.createSimulation(
        { title: 'Needs coordinator' },
        'owned-session',
      )
      if (!created.ok) throw new Error('draft not created')
      const versionId = created.value.selectedVersion.summary.id
      expect(
        await service.listSimulations(
          { search: '', domains: [], states: [], sources: [], limit: 50 },
          'other-session',
        ),
      ).toMatchObject({
        ok: false,
        error: { code: 'operation-failed' },
      })
      expect(
        await service.startGeneration(
          {
            schemaVersion: '1',
            simulationVersionId: versionId,
            expectedVersionRevision: 0,
            idempotencyKey: 'educator-test-key',
            teacher: {
              prompt: 'Create a projectile simulation.',
              promptRetention: 'discard',
              externalProviderDisclosureAccepted: true,
            },
            maxAttempts: 1,
            budget: {
              maxProviderRequests: 1,
              maxInputTokens: 100,
              maxOutputTokens: 100,
              maxCostMicrousd: 100,
              maxArtifactBytes: 1_024,
            },
          },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'operation-failed' } })
      expect(
        await service.previewVersion(
          versionId,
          {
            domain: 'projectile',
            expectedVersionRevision: 0,
            input: { initialSpeedMps: 10, launchAngleDeg: 45 },
            sampleCount: 10,
          },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'not-found' } })
    } finally {
      database.close()
    }
  })

  it('guards report and publication commands with exact selected evidence', async () => {
    const { database, service } = await context()
    try {
      const created = await service.createSimulation({ title: 'Unverified draft' }, 'owned-session')
      if (!created.ok) throw new Error('draft not created')
      const versionId = created.value.selectedVersion.summary.id
      expect(await service.getReport(versionId, 'owned-session')).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
      expect(
        await service.publishVersion(
          versionId,
          {
            expectedRevision: 0,
            verificationRunId: '20000000-0000-4000-8000-000000000001',
            exportLicense: { kind: 'spdx', id: 'MIT' },
          },
          'owned-session',
        ),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(database.getVersion(versionId)).toMatchObject({
        ok: true,
        value: { state: 'draft', revision: 0 },
      })
    } finally {
      database.close()
    }
  })
})

function config(root: string, configured: boolean): ServerConfig {
  return {
    environment: 'test',
    deploymentMode: 'loopback',
    databasePath: join(root, 'metadata.sqlite'),
    artifactRoot: join(root, 'artifacts'),
    allowedOrigins: ['http://127.0.0.1:3000'],
    trustedProxyAddress: undefined,
    adminBootstrapSecret: 'bootstrap-secret-value',
    sessionSecret: 'session-secret-value-that-is-long-enough',
    localAuthBypass: false,
    providers: {
      openaiApiKey: configured ? 'server-only-openai-secret' : undefined,
      codexApiKey: undefined,
    },
    session: { ttlSeconds: 3_600, idleSeconds: 900, maxActiveSessions: 4 },
    request: { maxBytes: 1_048_576, maxPromptCharacters: 10_000 },
    privacy: {
      promptRetention: 'discard',
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    },
    externalDiagnostics: { endpoint: undefined, token: undefined },
    telemetry: { endpoint: undefined },
    observability: {
      diagnosticLogRoot: '/tmp/simproof-educator-service-diagnostics',
      maxFileBytes: 8_388_608,
      retainedFiles: 3,
    },
  }
}
