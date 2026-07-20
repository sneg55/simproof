import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

function draftRecords(title = 'Projectile lesson') {
  const simulationId = id()
  return {
    simulation: { id: simulationId, title, createdAt: NOW, updatedAt: NOW },
    version: {
      id: id(),
      simulationId,
      versionNumber: 1,
      state: 'draft' as const,
      revision: 0,
      activeConceptSpecId: null,
      activeGeneratedArtifactId: null,
      activeArtifactBundle: null,
      activeVerificationRunId: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  }
}

describe('educator persistence repository', () => {
  it('creates a simulation and initial draft atomically', async () => {
    const context = await fixture('educator-create')
    try {
      const records = draftRecords()
      expect(context.database.educator.createDraft(records)).toMatchObject({ ok: true })
      expect(context.database.getSimulation(records.simulation.id)).toMatchObject({ ok: true })
      expect(context.database.getVersion(records.version.id)).toMatchObject({ ok: true })

      const conflict = draftRecords('Conflict')
      conflict.version.id = records.version.id
      expect(context.database.educator.createDraft(conflict)).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      expect(context.database.getSimulation(conflict.simulation.id)).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('creates ordered new versions and evidence-free duplicates without crossing ownership', async () => {
    const context = await fixture('educator-versioning')
    try {
      const source = draftRecords('Source')
      expectOk(context.database.educator.createDraft(source))
      const next = expectOk(
        context.database.educator.createNextDraft({
          simulationId: source.simulation.id,
          sourceVersionId: source.version.id,
          expectedSourceRevision: 0,
          versionId: id(),
          createdAt: LATER,
        }),
      )
      expect(next).toMatchObject({ versionNumber: 2, state: 'draft', revision: 0 })

      const other = draftRecords('Other')
      expectOk(context.database.educator.createDraft(other))
      expect(
        context.database.educator.createNextDraft({
          simulationId: source.simulation.id,
          sourceVersionId: other.version.id,
          expectedSourceRevision: 0,
          versionId: id(),
          createdAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'not-found' } })
      expect(
        context.database.educator.createNextDraft({
          simulationId: source.simulation.id,
          sourceVersionId: source.version.id,
          expectedSourceRevision: 1,
          versionId: id(),
          createdAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })

      const duplicate = draftRecords('Source copy')
      const copiedRecordIds = duplicateRecordIds()
      expect(
        context.database.educator.duplicateToDraft({
          sourceVersionId: source.version.id,
          expectedSourceRevision: 1,
          simulation: duplicate.simulation,
          versionId: duplicate.version.id,
          createdAt: LATER,
          copiedRecordIds,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      const copied = expectOk(
        context.database.educator.duplicateToDraft({
          sourceVersionId: source.version.id,
          expectedSourceRevision: 0,
          simulation: duplicate.simulation,
          versionId: duplicate.version.id,
          createdAt: LATER,
          copiedRecordIds,
        }),
      )
      expect(copied.version).toMatchObject({
        state: 'draft',
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
      })
      expect(context.database.educator.duplicateLineage(copied.version.id)).toMatchObject({
        ok: true,
        value: {
          kind: 'duplicate',
          sourceSimulationId: source.simulation.id,
          sourceVersionId: source.version.id,
          sourceRevision: 0,
        },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('provides bounded filtered cursor pages and rejects malformed list input', async () => {
    const context = await fixture('educator-list')
    try {
      for (const [index, title] of ['Alpha projectile', 'Beta pendulum', 'Gamma'].entries()) {
        const records = draftRecords(title)
        const at = new Date(Date.parse(NOW) + index * 1_000).toISOString()
        expectOk(
          context.database.educator.createDraft({
            simulation: { ...records.simulation, createdAt: at, updatedAt: at },
            version: { ...records.version, createdAt: at, updatedAt: at },
          }),
        )
      }

      const first = expectOk(context.database.educator.list({ limit: 2 }))
      expect(first.items.map(({ title }) => title)).toEqual(['Gamma', 'Beta pendulum'])
      expect(first.nextCursor).not.toBeNull()
      const second = expectOk(
        context.database.educator.list({ limit: 2, cursor: first.nextCursor }),
      )
      expect(second.items.map(({ title }) => title)).toEqual(['Alpha projectile'])
      expect(
        expectOk(context.database.educator.list({ limit: 10, search: 'PENDULUM' })).items,
      ).toHaveLength(1)

      for (const invalid of [
        { limit: 0 },
        { limit: 51 },
        { limit: 1.5 },
        { limit: 2, cursor: 'not-a-cursor' },
        { limit: 2, unknown: true },
        { limit: 2, states: ['draft', 'draft'] },
      ]) {
        expect(context.database.educator.list(invalid)).toMatchObject({
          ok: false,
          error: { code: 'invalid-input' },
        })
      }
    } finally {
      await context.cleanup()
    }
  })

  it('scopes detail and ordered version history to one simulation', async () => {
    const context = await fixture('educator-detail')
    try {
      const first = draftRecords('First')
      const second = draftRecords('Second')
      expectOk(context.database.educator.createDraft(first))
      expectOk(context.database.educator.createDraft(second))
      expectOk(
        context.database.educator.createNextDraft({
          simulationId: first.simulation.id,
          sourceVersionId: first.version.id,
          expectedSourceRevision: 0,
          versionId: id(),
          createdAt: LATER,
        }),
      )

      expect(expectOk(context.database.educator.detail(first.simulation.id)).versions).toHaveLength(
        2,
      )
      expect(
        expectOk(context.database.educator.versions(first.simulation.id)).map(
          ({ versionNumber }) => versionNumber,
        ),
      ).toEqual([1, 2])
      expect(
        context.database.educator.versionForSimulation(second.version.id, first.simulation.id),
      ).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('archives with optimistic revision control and updates the aggregate projection', async () => {
    const context = await fixture('educator-archive')
    const contender = createPersistence(context.database.path)
    try {
      expectOk(contender.migrate())
      const records = draftRecords('Archive')
      expectOk(context.database.educator.createDraft(records))
      expectOk(
        context.database.educator.archive({
          versionId: records.version.id,
          expectedRevision: 0,
          archivedAt: LATER,
        }),
      )
      expect(
        contender.educator.archive({
          versionId: records.version.id,
          expectedRevision: 0,
          archivedAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(
        expectOk(context.database.educator.detail(records.simulation.id)).latestVersion,
      ).toMatchObject({
        state: 'archived',
        revision: 1,
      })
    } finally {
      contender.close()
      await context.cleanup()
    }
  })

  it('enforces immutable bundled-example metadata and restrictive ownership', async () => {
    const context = await fixture('educator-bundled')
    const records = draftRecords('Bundled')
    try {
      expectOk(context.database.educator.createDraft(records))
      const raw = new DatabaseSync(context.database.path)
      try {
        raw
          .prepare(`INSERT INTO bundled_examples(
            example_id,example_version,catalog_hash,simulation_id,domain,license_id,attribution,installed_at
          ) VALUES (?,?,?,?,?,?,?,?)`)
          .run(
            'projectile-basics',
            '1.0.0',
            `sha256:${'a'.repeat(64)}`,
            records.simulation.id,
            'projectile',
            'CC-BY-4.0',
            'SimProof contributors',
            NOW,
          )
        expect(() =>
          raw.prepare('UPDATE bundled_examples SET attribution=?').run('Changed'),
        ).toThrow()
        expect(() =>
          raw.prepare('DELETE FROM bundled_examples WHERE example_id=?').run('projectile-basics'),
        ).toThrow()
        expect(() =>
          raw.prepare('DELETE FROM simulations WHERE id=?').run(records.simulation.id),
        ).toThrow()
      } finally {
        raw.close()
      }
    } finally {
      await context.cleanup()
    }
  })
})

function duplicateRecordIds() {
  return {
    generationRunId: id(),
    conceptSpecId: id(),
    generationAttemptId: id(),
    generatedArtifactId: id(),
  }
}
