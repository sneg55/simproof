import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('backup and restore integrity hardening', () => {
  it('rejects restored concept provenance that crosses simulation-version aggregates', async () => {
    const context = await verifiedFixture('restore-cross-aggregate')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-cross-aggregate-'))
    const backup = join(parent, 'snapshot')
    const otherSimulationId = id()
    const otherVersionId = id()
    const otherRunId = id()
    try {
      expectOk(
        context.database.createSimulation({
          id: otherSimulationId,
          title: 'Other',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.createDraftVersion({
          id: otherVersionId,
          simulationId: otherSimulationId,
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
          versionId: otherVersionId,
          expectedRevision: 0,
          updatedAt: NOW,
          run: {
            id: otherRunId,
            simulationVersionId: otherVersionId,
            status: 'running',
            maxAttempts: 3,
            codexSessionId: null,
            createdAt: NOW,
            completedAt: null,
          },
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
      const tamper = new DatabaseSync(join(backup, 'metadata.sqlite'))
      tamper.exec('DROP TRIGGER immutable_concept_spec')
      tamper
        .prepare('UPDATE concept_specs SET generation_run_id=? WHERE id=?')
        .run(otherRunId, context.conceptSpecId)
      tamper.close()
      await rewriteDatabaseManifest(backup)
      expect(
        await restorePersistence({ backup, destination: join(parent, 'restored') }),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('retains immutable publication history when the version is no longer published', async () => {
    const context = await verifiedFixture('restore-publication-state')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-publication-state-'))
    const backup = join(parent, 'snapshot')
    try {
      expectOk(
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
      )
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const tamper = new DatabaseSync(join(backup, 'metadata.sqlite'))
      tamper
        .prepare("UPDATE simulation_versions SET state='verified' WHERE id=?")
        .run(context.versionId)
      tamper.close()
      await rewriteDatabaseManifest(backup)
      expect(
        await restorePersistence({ backup, destination: join(parent, 'restored') }),
      ).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects restored selected verification evidence whose active bindings are not exact', async () => {
    const context = await verifiedFixture('restore-selected-evidence')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-selected-evidence-'))
    const backup = join(parent, 'snapshot')
    try {
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const tamper = new DatabaseSync(join(backup, 'metadata.sqlite'))
      const alternateConceptId = id()
      tamper
        .prepare(`INSERT INTO concept_specs(
          id,simulation_version_id,generation_run_id,schema_version,domain,
          artifact_id,artifact_hash,created_at
        ) SELECT ?,simulation_version_id,generation_run_id,schema_version,domain,
          artifact_id,artifact_hash,created_at FROM concept_specs WHERE id=?`)
        .run(alternateConceptId, context.conceptSpecId)
      tamper
        .prepare('UPDATE simulation_versions SET active_concept_spec_id=? WHERE id=?')
        .run(alternateConceptId, context.versionId)
      tamper.close()
      await rewriteDatabaseManifest(backup)
      expect(
        await restorePersistence({ backup, destination: join(parent, 'restored') }),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects noncanonical normalization-v1 JSON bytes during restore', async () => {
    const context = await fixture('restore-canonical-json')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-canonical-json-'))
    const backup = join(parent, 'snapshot')
    try {
      const object = expectOk(
        await context.store.putJson('{"value":1}', { normalizationVersion: 1 }),
      )
      const artifactId = id()
      expectOk(
        await context.database.records.insertStoredArtifact(
          {
            id: artifactId,
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
      const bytes = Buffer.from('{"value": 1}', 'utf8')
      const replacementHash = `sha256:${sha256(bytes)}` as const
      const backupStore = new ArtifactStore(join(backup, 'artifacts'))
      await rm(backupStore.pathForHash(object.hash))
      await mkdir(dirname(backupStore.pathForHash(replacementHash)), { recursive: true })
      await writeFile(backupStore.pathForHash(replacementHash), bytes)
      const tamper = new DatabaseSync(join(backup, 'metadata.sqlite'))
      tamper.exec('DROP TRIGGER immutable_stored_artifact')
      tamper
        .prepare('UPDATE stored_artifacts SET content_hash=?,byte_length=? WHERE id=?')
        .run(replacementHash, bytes.byteLength, artifactId)
      tamper.close()
      const manifestPath = join(backup, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        database: { sha256: string; byteLength: number }
        artifacts: Array<{ hash: string; archiveSha256: string; byteLength: number }>
      }
      manifest.artifacts[0]!.hash = replacementHash
      manifest.artifacts[0]!.archiveSha256 = replacementHash.slice(7)
      manifest.artifacts[0]!.byteLength = bytes.byteLength
      await writeFile(manifestPath, JSON.stringify(manifest))
      await rewriteDatabaseManifest(backup)
      expect(
        await restorePersistence({ backup, destination: join(parent, 'restored') }),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects invalid creation dates and configured size/count overflow before publication', async () => {
    const context = await verifiedFixture('backup-limits')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-backup-limits-'))
    try {
      const invalidDate = join(parent, 'invalid-date')
      expect(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: invalidDate,
          createdAt: 'not-a-date',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
      const bounded = join(parent, 'bounded')
      expect(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: bounded,
          createdAt: NOW,
          limits: { maxArtifacts: 0, maxDatabaseBytes: 1, maxTotalBytes: 1 },
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
      expect(await readdir(parent)).toEqual([])
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('fsync failure leaves no published destination or staging residue and redacts its path', async () => {
    const context = await verifiedFixture('backup-fsync')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-backup-fsync-'))
    const destination = join(parent, 'snapshot')
    try {
      const result = await backupPersistence({
        database: context.database,
        artifacts: context.store,
        destination,
        createdAt: NOW,
        durability: {
          syncFile: () =>
            Promise.reject(new Error(`EIO while syncing ${destination}/manifest.json`)),
          syncDirectory: () => Promise.resolve(),
        },
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
      expect(JSON.stringify(result)).not.toContain(parent)
      expect(await readdir(parent)).toEqual([])
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('directory fsync failure also removes the owned backup attempt', async () => {
    const context = await verifiedFixture('backup-directory-fsync')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-backup-directory-fsync-'))
    const destination = join(parent, 'snapshot')
    try {
      const result = await backupPersistence({
        database: context.database,
        artifacts: context.store,
        destination,
        createdAt: NOW,
        durability: {
          syncFile: () => Promise.resolve(),
          syncDirectory: () => Promise.reject(new Error(`EIO while syncing ${destination}`)),
        },
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
      expect(JSON.stringify(result)).not.toContain(parent)
      expect(await readdir(parent)).toEqual([])
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects backup publication outside its configured app-owned operation root', async () => {
    const context = await verifiedFixture('backup-scope')
    const operationRoot = await mkdtemp(join(tmpdir(), 'simproof-operation-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'simproof-outside-root-'))
    try {
      expect(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: join(outside, 'escaped'),
          operationRoot,
          createdAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(
        await restorePersistence({
          backup: join(operationRoot, 'missing-backup'),
          destination: join(outside, 'restored'),
          operationRoot,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    } finally {
      await context.cleanup()
      await rm(operationRoot, { force: true, recursive: true })
      await rm(outside, { force: true, recursive: true })
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
