import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { fixture, id, NOW, sha } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('persistence fail-closed composition regressions', () => {
  it('rejects a verification run when immutable child findings differ from its report', async () => {
    const context = await verifiedFixture('insert-report-bindings')
    try {
      const verificationRunId = id()
      const run = { ...context.verificationRun, id: verificationRunId }
      const finding = {
        id: id(),
        verificationRunId,
        ordinal: 0,
        finding: {
          id: 'pendulum.period.mismatch',
          category: 'mismatch' as const,
          severity: 'error' as const,
          checkId: 'period.matches',
          quantity: 'periodS',
          inputs: { length: { value: 1, unit: 'm' } },
          expected: { value: 2, unit: 's' },
          actual: { value: 3, unit: 's' },
          tolerance: { mode: 'absolute' as const, absolute: 0.01, unit: 's' },
          error: { mode: 'absolute' as const, value: 1, unit: 's' },
          explanation: 'The persisted finding is absent from the immutable report.',
        },
        createdAt: NOW,
      }
      expect(
        await context.database.verification.insert(run, [finding], context.store),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
    }
  })

  it('fails export closed when duplicated verification columns diverge from evidence JSON', async () => {
    const context = await verifiedFixture('export-tamper')
    try {
      const tamper = new DatabaseSync(context.database.path)
      tamper.exec('DROP TRIGGER immutable_verification_run')
      tamper
        .prepare('UPDATE verification_runs SET runner_version=? WHERE id=?')
        .run('forged-runner', context.verificationRun.id)
      tamper.close()
      expect(
        await context.database.maintenance.exportSimulation(context.simulationId, context.store),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
    }
  })

  it('deletion never globally collects an unrelated in-flight CAS object', async () => {
    const context = await verifiedFixture('delete-candidates-only')
    try {
      const unrelated = await context.store.putSource('unrelated in-flight object', {
        normalizationVersion: 1,
      })
      expect(unrelated).toMatchObject({ ok: true })
      await context.database.maintenance.deleteSimulation(context.simulationId, context.store)
      if (!unrelated.ok) throw new TypeError('fixture setup failed')
      expect(await context.store.get(unrelated.value.hash)).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
    }
  })

  it('cannot enter generation without atomically creating its bounded run', async () => {
    const context = await fixture('generation-intent')
    try {
      const simulationId = id()
      const versionId = id()
      context.database.createSimulation({
        id: simulationId,
        title: 'Intent',
        createdAt: NOW,
        updatedAt: NOW,
      })
      context.database.createDraftVersion({
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
      })
      expect(
        context.database.transitionVersion({
          id: versionId,
          expectedRevision: 0,
          to: 'generating',
          updatedAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    } finally {
      await context.cleanup()
    }
  })

  it('blocks public writes while publication is suspended on CAS validation', async () => {
    const context = await verifiedFixture('publication-lock')
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    class SuspendedStore extends ArtifactStore {
      override async get(hash: string) {
        entered()
        await gate
        return await super.get(hash)
      }
    }
    const store = new SuspendedStore(context.store.root)
    let publishing: Promise<unknown> | undefined
    const publication = {
      id: id(),
      simulationVersionId: context.versionId,
      exportLicense: { kind: 'none' as const },
      publishedAt: NOW,
    }
    try {
      publishing = context.database.verification.publish(publication, 4, store)
      await started
      const concurrentWrite = context.database.createSimulation({
        id: id(),
        title: 'Blocked',
        createdAt: NOW,
        updatedAt: NOW,
      })
      release()
      await publishing
      expect(concurrentWrite).toMatchObject({ ok: false, error: { code: 'conflict' } })
    } finally {
      release()
      await publishing?.catch(() => undefined)
      await context.cleanup()
    }
  })

  it('keeps deletion coordinated through the retained-hash recheck and CAS delete', async () => {
    const context = await verifiedFixture('deletion-lock')
    const target = context.evidence.conceptSpecArtifact.contentHash
    const content = await context.store.get(target)
    if (!content.ok) throw new TypeError('fixture setup failed')
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    class SuspendedDeleteStore extends ArtifactStore {
      override async delete(hash: `sha256:${string}`) {
        if (hash === target) {
          entered()
          await gate
        }
        return await super.delete(hash)
      }
    }
    const store = new SuspendedDeleteStore(context.store.root)
    let deletion: Promise<unknown> | undefined
    try {
      deletion = context.database.maintenance.deleteSimulation(context.simulationId, store)
      await started
      let insertionSettled = false
      const insertion = context.database.records.insertStoredArtifact(
        {
          id: id(),
          role: 'concept-spec',
          contentHash: target,
          mediaType: 'application/json',
          byteLength: content.value.byteLength,
          normalizationVersion: 1,
          createdAt: NOW,
        },
        context.store,
      )
      void insertion.then(() => {
        insertionSettled = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(insertionSettled).toBe(false)
      release()
      await deletion
      await expect(insertion).resolves.toMatchObject({ ok: false })
    } finally {
      release()
      await deletion?.catch(() => undefined)
      await context.cleanup()
    }
  })

  it('derives publication evidence bindings from the active verified version', async () => {
    const context = await verifiedFixture('derived-publication')
    try {
      expect(
        await context.database.verification.publish(
          {
            id: id(),
            simulationVersionId: context.versionId,
            exportLicense: { kind: 'none' },
            publishedAt: NOW,
          },
          4,
          context.store,
        ),
      ).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
    }
  })

  it('exports schema-derived portable records instead of raw SQLite rows', async () => {
    const context = await verifiedFixture('portable-export')
    try {
      const exported = await context.database.maintenance.exportSimulation(
        context.simulationId,
        context.store,
      )
      expect(exported).toMatchObject({
        ok: true,
        value: {
          records: {
            verificationRuns: [{ simulationVersionId: context.versionId }],
          },
        },
      })
      expect(JSON.stringify(exported)).not.toContain('evidence_json')
    } finally {
      await context.cleanup()
    }
  })

  it('rechecks installed authority after deferred CAS reads before publication commit', async () => {
    const context = await verifiedFixture('authority-swap')
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    class SuspendedStore extends ArtifactStore {
      override async get(hash: string) {
        if (first) {
          first = false
          entered()
          await gate
        }
        return await super.get(hash)
      }
    }
    const store = new SuspendedStore(context.store.root)
    let publishing: Promise<unknown> | undefined
    try {
      publishing = context.database.verification.publish(
        {
          id: id(),
          simulationVersionId: context.versionId,
          exportLicense: { kind: 'none' },
          publishedAt: NOW,
        },
        4,
        store,
      )
      await started
      context.setInstalledEnvironment({
        ...context.environment,
        policyContentHash: sha('authority-swapped-during-cas'),
      })
      release()
      await expect(publishing).resolves.toMatchObject({ ok: false })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'stale' },
      })
    } finally {
      release()
      await publishing?.catch(() => undefined)
      await context.cleanup()
    }
  })

  it('never treats an unselected historical verification run as current or mutates lifecycle', async () => {
    const context = await verifiedFixture('historical-run-selection')
    try {
      const historical = { ...context.verificationRun, id: id() }
      expect(
        await context.database.verification.insert(historical, [], context.store),
      ).toMatchObject({ ok: true })
      expect(
        await context.database.verification.currentValidity(historical.id, context.store),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: {
          state: 'verified',
          revision: 4,
          activeVerificationRunId: context.verificationRun.id,
        },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('invalidates current evidence when the selected concept is not exact', async () => {
    const context = await verifiedFixture('selected-concept-binding')
    try {
      const raw = new DatabaseSync(context.database.path)
      const alternateConceptId = id()
      raw
        .prepare(`INSERT INTO concept_specs(
          id,simulation_version_id,generation_run_id,schema_version,domain,
          artifact_id,artifact_hash,created_at
        ) SELECT ?,simulation_version_id,generation_run_id,schema_version,domain,
          artifact_id,artifact_hash,created_at FROM concept_specs WHERE id=?`)
        .run(alternateConceptId, context.conceptSpecId)
      raw
        .prepare('UPDATE simulation_versions SET active_concept_spec_id=? WHERE id=?')
        .run(alternateConceptId, context.versionId)
      raw.close()
      expect(
        await context.database.verification.currentValidity(
          context.verificationRun.id,
          context.store,
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'stale', revision: 5 },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('enters generation only with a fresh running run and rolls back terminal input', async () => {
    const context = await fixture('fresh-generation-run')
    const simulationId = id()
    const versionId = id()
    const runId = id()
    try {
      context.database.createSimulation({
        id: simulationId,
        title: 'Fresh generation',
        createdAt: NOW,
        updatedAt: NOW,
      })
      context.database.createDraftVersion({
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
      })
      expect(
        context.database.beginGeneration({
          versionId,
          expectedRevision: 0,
          updatedAt: NOW,
          run: {
            id: runId,
            simulationVersionId: versionId,
            status: 'succeeded',
            maxAttempts: 3,
            codexSessionId: null,
            createdAt: NOW,
            completedAt: NOW,
          },
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(context.database.getVersion(versionId)).toMatchObject({
        ok: true,
        value: { state: 'draft', revision: 0 },
      })
      const raw = new DatabaseSync(context.database.path)
      expect(raw.prepare('SELECT 1 FROM generation_runs WHERE id=?').get(runId)).toBeUndefined()
      raw.close()
    } finally {
      await context.cleanup()
    }
  })
})
