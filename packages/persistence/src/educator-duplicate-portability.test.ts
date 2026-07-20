import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { createPersistence } from './database.js'
import { expectOk, id, NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

const DUPLICATED_AT = '2026-07-16T12:01:00.000Z'
const AFTER_DUPLICATION = '2026-07-16T12:02:00.000Z'

describe('educator duplicate portability', () => {
  it('includes immutable source lineage and no copied trust in selected-simulation export', async () => {
    const context = await verifiedFixture('duplicate-portable-export')
    try {
      const duplicate = duplicateVerifiedVersion(context)
      const exported = expectOk(
        await context.database.maintenance.exportSimulation(duplicate.simulationId, context.store),
      )

      expect(exported.records.lineages).toEqual([duplicate.lineage])
      expect(exported.versions).toEqual([
        expect.objectContaining({
          id: duplicate.versionId,
          state: 'draft',
          revision: 0,
          activeVerificationRunId: null,
        }),
      ])
      expect(exported.records.verificationRuns).toEqual([])
      expect(exported.records.findings).toEqual([])
      expect(exported.records.publications).toEqual([])
      expect(exported.records.generationRuns).toEqual([
        expect.objectContaining({ status: 'cancelled' }),
      ])
      expect(exported.records.generationAttempts).toEqual([
        expect.objectContaining({ outcome: 'cancelled' }),
      ])
      expect(exported.records.conceptSpecs[0]?.id).not.toBe(context.conceptSpecId)
      expect(exported.records.generatedArtifacts[0]?.id).not.toBe(context.generatedArtifactId)
    } finally {
      await context.cleanup()
    }
  })

  it('round-trips duplicate lineage and rejects a checksum-valid contradictory source identity', async () => {
    const context = await verifiedFixture('duplicate-backup-restore')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-duplicate-lineage-parent-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    try {
      const duplicate = duplicateVerifiedVersion(context)
      expectOk(
        context.database.educator.archive({
          versionId: context.versionId,
          expectedRevision: duplicate.lineage.sourceRevision,
          archivedAt: AFTER_DUPLICATION,
        }),
      )
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      expectOk(await restorePersistence({ backup, destination: restored }))

      const restoredDatabase = createPersistence(join(restored, 'metadata.sqlite'))
      try {
        const restoredStore = new ArtifactStore(join(restored, 'artifacts'))
        expectOk(await restoredDatabase.validateStoredRecords(restoredStore))
        expect(restoredDatabase.educator.duplicateLineage(duplicate.versionId)).toMatchObject({
          ok: true,
          value: {
            destinationVersionId: duplicate.versionId,
            kind: 'duplicate',
            sourceSimulationId: duplicate.lineage.sourceSimulationId,
            sourceVersionId: duplicate.lineage.sourceVersionId,
            sourceVersionNumber: duplicate.lineage.sourceVersionNumber,
            sourceRevision: duplicate.lineage.sourceRevision,
            createdAt: duplicate.lineage.duplicatedAt,
          },
        })
        const exported = expectOk(
          await restoredDatabase.maintenance.exportSimulation(
            duplicate.simulationId,
            restoredStore,
          ),
        )
        expect(exported.records.lineages).toEqual([duplicate.lineage])
        expect(exported.versions[0]).toMatchObject({
          state: 'draft',
          activeVerificationRunId: null,
        })
        expect(exported.records.verificationRuns).toEqual([])
        expect(exported.records.publications).toEqual([])
      } finally {
        restoredDatabase.close()
      }

      const tampered = new DatabaseSync(join(backup, 'metadata.sqlite'))
      try {
        tampered.exec('DROP TRIGGER immutable_version_lineage_update')
        tampered
          .prepare('UPDATE version_lineage SET source_version_number=source_version_number+1')
          .run()
      } finally {
        tampered.close()
      }
      await rewriteDatabaseManifest(backup)
      expect(
        await restorePersistence({ backup, destination: join(parent, 'rejected-restore') }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('retains exportable historical lineage after the source aggregate is deleted', async () => {
    const context = await verifiedFixture('duplicate-deleted-source')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-deleted-source-lineage-parent-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    try {
      const duplicate = duplicateVerifiedVersion(context)
      expectOk(
        await context.database.maintenance.deleteSimulation(context.simulationId, context.store),
      )
      expect(context.database.getSimulation(context.simulationId)).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
      expectOk(await context.database.validateStoredRecords(context.store))

      const exported = expectOk(
        await context.database.maintenance.exportSimulation(duplicate.simulationId, context.store),
      )
      expect(exported.records.lineages).toEqual([duplicate.lineage])
      expect(exported.versions[0]).toMatchObject({
        state: 'draft',
        activeVerificationRunId: null,
      })
      expect(exported.records.verificationRuns).toEqual([])
      expect(exported.records.publications).toEqual([])

      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      expectOk(await restorePersistence({ backup, destination: restored }))

      const restoredDatabase = createPersistence(join(restored, 'metadata.sqlite'))
      try {
        const restoredStore = new ArtifactStore(join(restored, 'artifacts'))
        expectOk(await restoredDatabase.validateStoredRecords(restoredStore))
        expect(restoredDatabase.getSimulation(context.simulationId)).toMatchObject({
          ok: false,
          error: { code: 'not-found' },
        })
        const restoredExport = expectOk(
          await restoredDatabase.maintenance.exportSimulation(
            duplicate.simulationId,
            restoredStore,
          ),
        )
        expect(restoredExport.records.lineages).toEqual([duplicate.lineage])
        expect(restoredExport.records.verificationRuns).toEqual([])
        expect(restoredExport.records.publications).toEqual([])
      } finally {
        restoredDatabase.close()
      }
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })
})

function duplicateVerifiedVersion(context: Awaited<ReturnType<typeof verifiedFixture>>) {
  const source = expectOk(context.database.getVersion(context.versionId))
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.educator.duplicateToDraft({
      sourceVersionId: source.id,
      expectedSourceRevision: source.revision,
      simulation: {
        id: simulationId,
        title: 'Portable duplicate',
        createdAt: DUPLICATED_AT,
        updatedAt: DUPLICATED_AT,
      },
      versionId,
      copiedRecordIds: {
        generationRunId: id(),
        conceptSpecId: id(),
        generationAttemptId: id(),
        generatedArtifactId: id(),
      },
      createdAt: DUPLICATED_AT,
    }),
  )
  return {
    simulationId,
    versionId,
    lineage: {
      id: versionId,
      kind: 'duplicate' as const,
      sourceSimulationId: source.simulationId,
      sourceVersionId: source.id,
      sourceVersionNumber: source.versionNumber,
      sourceRevision: source.revision,
      duplicatedAt: DUPLICATED_AT,
    },
  }
}

async function rewriteDatabaseManifest(backup: string): Promise<void> {
  const database = await readFile(join(backup, 'metadata.sqlite'))
  const path = join(backup, 'manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    database: { sha256: string; byteLength: number }
  }
  manifest.database.sha256 = sha256(database)
  manifest.database.byteLength = database.byteLength
  await writeFile(path, JSON.stringify(manifest))
}
