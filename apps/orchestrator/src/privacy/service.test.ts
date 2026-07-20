import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ArtifactStore,
  createPersistence,
  type PersistenceDatabase,
  PrivacyRepository,
} from '@simproof/persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDiagnosticsDispatcher, PrivacyService } from './service.js'

const NOW = '2026-07-16T12:00:00.000Z'
const PASSWORD = 'correct teacher password'
const SECRET_SENTINEL = 'provider-secret-sentinel-never-export'
const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'simproof-privacy-service-'))
  roots.push(root)
  const database = createPersistence(join(root, 'metadata.sqlite'))
  expect(database.migrate()).toMatchObject({ ok: true })
  const artifacts = new ArtifactStore(join(root, 'artifacts'))
  const privacy = new PrivacyRepository(database.path)
  createDraft(database, 'First simulation')
  createDraft(database, 'Second simulation')
  const confirmPassword = vi.fn((password: string) => Promise.resolve(password === PASSWORD))
  const service = new PrivacyService({
    database,
    artifacts,
    privacy,
    confirmPassword,
    now: () => Date.parse(NOW),
    telemetryEnabled: false,
    externalDiagnosticsAllowed: false,
  })
  return { artifacts, confirmPassword, database, privacy, service }
}

function createDraft(database: PersistenceDatabase, title: string): string {
  const simulationId = randomUUID()
  const versionId = randomUUID()
  expect(
    database.createSimulation({ id: simulationId, title, createdAt: NOW, updatedAt: NOW }),
  ).toMatchObject({ ok: true })
  expect(
    database.createDraftVersion({
      id: versionId,
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
  return simulationId
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('teacher privacy service', () => {
  it('discards prompts by default and persists them only after explicit opt-in', async () => {
    const context = await fixture()
    try {
      const listed = context.database.maintenance.listSimulationIds()
      if (!listed.ok) throw new TypeError('simulation fixture failed')
      const [simulationId] = listed.value
      expect(simulationId).toBeDefined()
      expect(context.service.retainPrompt(simulationId!, 'discard sentinel')).toEqual({
        ok: true,
        value: { retained: false },
      })
      expect(context.privacy.exportPrompts()).toEqual({ ok: true, value: [] })

      expect(
        context.service.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
        }),
      ).toMatchObject({ ok: true })
      expect(context.service.retainPrompt(simulationId!, 'retained teacher prompt')).toMatchObject({
        ok: true,
        value: { retained: true },
      })
      expect(context.privacy.exportPrompts()).toMatchObject({
        ok: true,
        value: [{ simulationId, prompt: 'retained teacher prompt' }],
      })
    } finally {
      context.privacy.close()
      context.database.close()
    }
  })

  it('preserves optimistic revision conflicts while redacting operational failures', async () => {
    const context = await fixture()
    let privacyOpen = true
    try {
      expect(
        context.service.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
        }),
      ).toMatchObject({ ok: true })
      expect(
        context.service.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: false,
          externalDiagnosticsEnabled: false,
        }),
      ).toEqual({
        ok: false,
        error: { code: 'conflict', message: 'Privacy settings changed.' },
      })

      context.privacy.close()
      privacyOpen = false
      expect(
        context.service.updateSettings({
          expectedRevision: 1,
          promptRetentionEnabled: false,
          externalDiagnosticsEnabled: false,
        }),
      ).toEqual({
        ok: false,
        error: { code: 'operation-failed', message: 'Privacy operation failed.' },
      })
    } finally {
      if (privacyOpen) context.privacy.close()
      context.database.close()
    }
  })

  it('exports every simulation, setting, and retained prompt through an allowlist', async () => {
    const context = await fixture()
    try {
      const listed = context.database.maintenance.listSimulationIds()
      if (!listed.ok) throw new TypeError('simulation fixture failed')
      expect(
        context.service.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
        }),
      ).toMatchObject({ ok: true })
      context.service.retainPrompt(listed.value[0]!, 'exported teacher prompt')
      const exported = await context.service.exportAll(PASSWORD)
      expect(exported).toMatchObject({
        ok: true,
        value: {
          schemaVersion: '1',
          simulations: [{}, {}],
          retainedPrompts: [{ prompt: 'exported teacher prompt' }],
          privacySettings: {
            promptRetentionEnabled: true,
            externalDiagnosticsEnabled: false,
            telemetryEnabled: false,
          },
        },
      })
      expect(context.confirmPassword).toHaveBeenCalledWith(PASSWORD)
      const serialized = JSON.stringify(exported)
      expect(serialized).not.toContain(SECRET_SENTINEL)
      expect(serialized).not.toMatch(/passwordHash|tokenHash|csrfHash|bootstrapSecret/iu)
    } finally {
      context.privacy.close()
      context.database.close()
    }
  })

  it('fails closed before returning a full privacy export above its aggregate byte limit', async () => {
    const context = await fixture()
    const bounded = new PrivacyService({
      database: context.database,
      artifacts: context.artifacts,
      privacy: context.privacy,
      confirmPassword: context.confirmPassword,
      now: () => Date.parse(NOW),
      telemetryEnabled: false,
      externalDiagnosticsAllowed: false,
      maxExportBytes: 256,
    })
    try {
      await expect(bounded.exportAll(PASSWORD)).resolves.toEqual({
        ok: false,
        error: { code: 'operation-failed', message: 'Privacy operation failed.' },
      })
    } finally {
      context.privacy.close()
      context.database.close()
    }
  })

  it('requires recent password confirmation and cascades retained prompts on deletion', async () => {
    const context = await fixture()
    try {
      const listed = context.database.maintenance.listSimulationIds()
      if (!listed.ok) throw new TypeError('simulation fixture failed')
      const simulationId = listed.value[0]!
      context.service.updateSettings({
        expectedRevision: 0,
        promptRetentionEnabled: true,
        externalDiagnosticsEnabled: false,
      })
      context.service.retainPrompt(simulationId, 'delete with simulation')
      await expect(
        context.service.deleteSimulation(simulationId, 'wrong password'),
      ).resolves.toMatchObject({ ok: false, error: { code: 'confirmation-failed' } })
      expect(context.database.getSimulation(simulationId)).toMatchObject({ ok: true })
      await expect(context.service.deleteSimulation(simulationId, PASSWORD)).resolves.toMatchObject(
        {
          ok: true,
        },
      )
      expect(context.database.getSimulation(simulationId)).toMatchObject({ ok: false })
      expect(context.privacy.listPrompts(simulationId)).toEqual({ ok: true, value: [] })
    } finally {
      context.privacy.close()
      context.database.close()
    }
  })

  it('does not initialize or call diagnostics when external export is disabled', async () => {
    const factory = vi.fn(() => vi.fn(() => Promise.resolve()))
    const dispatcher = createDiagnosticsDispatcher(
      { telemetryEnabled: false, externalDiagnosticsEnabled: false },
      factory,
    )
    await dispatcher({ event: 'privacy-viewed' })
    expect(factory).not.toHaveBeenCalled()
  })
})
