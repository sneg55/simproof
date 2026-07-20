import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('backup, restore, export, deletion, and cleanup', () => {
  it('round-trips a consistent database and its exact referenced objects', async () => {
    const context = await verifiedFixture('backup')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-backup-parent-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    try {
      const manifest = expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      expect(manifest.artifacts.length).toBeGreaterThan(0)
      expectOk(await restorePersistence({ backup, destination: restored }))
      const database = createPersistence(join(restored, 'metadata.sqlite'))
      expect(database.migrate()).toEqual({ ok: true, value: { applied: [] } })
      expect(database.getSimulation(context.simulationId)).toMatchObject({
        ok: true,
        value: { title: 'Pendulum lab' },
      })
      expect(database.verification.get(context.verificationRun.id)).toMatchObject({
        ok: true,
        value: { verdict: 'verified' },
      })
      database.close()
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects database and manifest tampering without creating a destination', async () => {
    const context = await verifiedFixture('tamper')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-tamper-parent-'))
    const backup = join(parent, 'snapshot')
    const destination = join(parent, 'destination')
    try {
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      await writeFile(join(backup, 'metadata.sqlite'), 'not sqlite')
      expect(await restorePersistence({ backup, destination })).toMatchObject({
        ok: false,
        error: { code: 'invalid-backup' },
      })
      await expect(readFile(destination)).rejects.toThrow()
      await rm(backup, { force: true, recursive: true })
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as Record<
        string,
        unknown
      >
      manifest.unexpected = true
      await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest))
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
      await rm(backup, { force: true, recursive: true })
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const validManifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as {
        artifacts: Array<{ hash: `sha256:${string}` }>
      }
      const backupStore = new ArtifactStore(join(backup, 'artifacts'))
      await writeFile(backupStore.pathForHash(validManifest.artifacts[0]!.hash), 'tampered')
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
      await rm(backup, { force: true, recursive: true })
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      await writeFile(join(backup, 'unexpected'), 'extra')
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('exports allowlisted teacher data and removes only unreferenced objects', async () => {
    const context = await verifiedFixture('delete')
    try {
      const exported = expectOk(
        await context.database.maintenance.exportSimulation(context.simulationId, context.store),
      )
      expect(exported.simulation.title).toBe('Pendulum lab')
      expect(exported.records.verificationRuns).toHaveLength(1)
      expect(JSON.stringify(exported)).not.toMatch(/credential|api.?key|bearer|secret/iu)
      const hashes = expectOk(context.database.referencedArtifactHashes())
      const deleted = expectOk(
        await context.database.maintenance.deleteSimulation(context.simulationId, context.store),
      )
      expect([...deleted.orphanedArtifacts].sort()).toEqual([...hashes].sort())
      expect(context.database.getSimulation(context.simulationId)).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
      for (const hash of hashes)
        expect(await context.store.get(hash)).toMatchObject({
          ok: false,
          error: { code: 'not-found' },
        })
    } finally {
      await context.cleanup()
    }
  })

  it('dry-run integrity leaves valid orphans untouched when a reference is corrupt', async () => {
    const context = await verifiedFixture('cleanup')
    try {
      const orphan = expectOk(
        await context.store.putSource('valid orphan', { normalizationVersion: 1 }),
      )
      const referenced = expectOk(context.database.referencedArtifactHashes())[0]!
      await writeFile(context.store.pathForHash(referenced), 'corrupt')
      expect(await context.database.maintenance.auditAndCollect(context.store)).toMatchObject({
        ok: false,
      })
      expect(await context.store.get(orphan.hash)).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
    }
  })

  it('preserves a deduplicated object still referenced by another simulation', async () => {
    const context = await verifiedFixture('shared-delete')
    try {
      const sharedHash = context.evidence.conceptSpecArtifact.contentHash
      const sharedBytes = expectOk(await context.store.get(sharedHash))
      const secondSimulationId = id()
      const secondVersionId = id()
      const secondRunId = id()
      expectOk(
        context.database.createSimulation({
          id: secondSimulationId,
          title: 'Shared',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.createDraftVersion({
          id: secondVersionId,
          simulationId: secondSimulationId,
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
      )
      expectOk(
        context.database.beginGeneration({
          versionId: secondVersionId,
          expectedRevision: 0,
          updatedAt: NOW,
          run: {
            id: secondRunId,
            simulationVersionId: secondVersionId,
            status: 'running',
            maxAttempts: 3,
            codexSessionId: null,
            createdAt: NOW,
            completedAt: null,
          },
        }),
      )
      const secondStoredId = id()
      expectOk(
        await context.database.records.insertStoredArtifact(
          {
            id: secondStoredId,
            role: 'concept-spec',
            contentHash: sharedHash,
            mediaType: 'application/json',
            byteLength: sharedBytes.byteLength,
            normalizationVersion: 1,
            createdAt: NOW,
          },
          context.store,
        ),
      )
      expectOk(
        context.database.records.insertConceptSpec({
          id: id(),
          simulationVersionId: secondVersionId,
          generationRunId: secondRunId,
          schemaVersion: '1',
          domain: 'pendulum',
          artifact: { artifactId: secondStoredId, role: 'concept-spec', contentHash: sharedHash },
          createdAt: NOW,
        }),
      )
      const exported = expectOk(
        await context.database.maintenance.exportSimulation(context.simulationId, context.store),
      )
      expect(exported.artifacts.some(({ id: artifactId }) => artifactId === secondStoredId)).toBe(
        false,
      )
      expectOk(
        await context.database.maintenance.deleteSimulation(context.simulationId, context.store),
      )
      expect(await context.store.get(sharedHash)).toMatchObject({ ok: true })
      expect(context.database.getSimulation(secondSimulationId)).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
    }
  })

  it('round-trips a valid standalone stored-artifact row and its bytes', async () => {
    const context = await fixture('standalone-backup')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-standalone-parent-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    try {
      const object = expectOk(
        await context.store.putJson('{"standalone":true}', { normalizationVersion: 1 }),
      )
      expectOk(
        await context.database.records.insertStoredArtifact(
          {
            id: id(),
            role: 'manifest',
            contentHash: object.hash,
            mediaType: 'application/json',
            byteLength: object.byteLength,
            normalizationVersion: 1,
            createdAt: NOW,
          },
          context.store,
        ),
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
      expect(expectOk(restoredDatabase.records.storedArtifactFormats())).toHaveLength(1)
      expect(await new ArtifactStore(join(restored, 'artifacts')).get(object.hash)).toMatchObject({
        ok: true,
      })
      restoredDatabase.close()
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects unsupported normalization metadata and a missing migration journal entry', async () => {
    const context = await verifiedFixture('restore-semantics')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-restore-semantics-'))
    const backup = join(parent, 'snapshot')
    const destination = join(parent, 'destination')
    try {
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const mutate = new DatabaseSync(join(backup, 'metadata.sqlite'))
      mutate.exec('DROP TRIGGER immutable_stored_artifact')
      mutate.exec('UPDATE stored_artifacts SET normalization_version=999')
      mutate.close()
      await rewriteDatabaseManifest(backup)
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
      await rm(backup, { force: true, recursive: true })
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const journal = new DatabaseSync(join(backup, 'metadata.sqlite'))
      journal.exec('DELETE FROM schema_migrations')
      journal.close()
      await rewriteDatabaseManifest(backup)
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a physically oversized manifest before parsing it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'simproof-oversized-manifest-'))
    const backup = join(parent, 'snapshot')
    const destination = join(parent, 'destination')
    try {
      await mkdir(backup)
      await mkdir(join(backup, 'artifacts'))
      await writeFile(join(backup, 'metadata.sqlite'), 'SQLite format 3\0')
      await writeFile(join(backup, 'manifest.json'), ' '.repeat(16_777_217))
      expect(await restorePersistence({ backup, destination })).toMatchObject({ ok: false })
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  })
})

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
