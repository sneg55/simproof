import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { sqliteFailure } from './sqlite.js'
import { NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('persistence filesystem and recovery hardening', () => {
  it('rejects configured artifact roots whose parent path traverses a symlink', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'simproof-root-policy-'))
    const real = join(parent, 'real')
    const alias = join(parent, 'alias')
    try {
      await mkdir(real)
      await symlink(real, alias, 'dir')
      const store = new ArtifactStore(join(alias, 'artifacts'))
      expect(await store.putSource('export default {}', { normalizationVersion: 1 })).toMatchObject(
        { ok: false },
      )
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('classifies a young owned temp file without corrupting the object inventory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'simproof-owned-temp-'))
    const store = new ArtifactStore(join(parent, 'artifacts'))
    try {
      const object = await store.putSource('owned', { normalizationVersion: 1 })
      if (!object.ok) throw new TypeError('fixture setup failed')
      const path = store.pathForHash(object.value.hash)
      await writeFile(`${path}.019f6bc1-0811-70c1-a139-938a3ad2dee0.tmp`, 'partial')
      expect(await store.identities()).toEqual({ ok: true, value: [object.value.hash] })
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('returns structured deferred CAS cleanup instead of losing retry information', async () => {
    const context = await verifiedFixture('delete-partial-failure')
    class FailingDeleteStore extends ArtifactStore {
      override delete(_hash: `sha256:${string}`) {
        return Promise.resolve({
          ok: false as const,
          error: { code: 'database-error' as const, message: 'injected CAS delete failure' },
        })
      }
    }
    try {
      expect(
        await context.database.maintenance.deleteSimulation(
          context.simulationId,
          new FailingDeleteStore(context.store.root),
        ),
      ).toMatchObject({
        ok: true,
        value: { deferredArtifacts: expect.arrayContaining([expect.any(String)]) },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects a backup with a forged SQLite application identity', async () => {
    const context = await verifiedFixture('sqlite-identity')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-sqlite-identity-'))
    const backup = join(parent, 'snapshot')
    try {
      const manifest = await backupPersistence({
        database: context.database,
        artifacts: context.store,
        destination: backup,
        createdAt: NOW,
      })
      expect(manifest).toMatchObject({ ok: true })
      const databasePath = join(backup, 'metadata.sqlite')
      const database = new DatabaseSync(databasePath)
      database.exec('PRAGMA application_id=0; PRAGMA user_version=0')
      database.close()
      const bytes = await readFile(databasePath)
      const manifestPath = join(backup, 'manifest.json')
      const document = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        database: { sha256: string; byteLength: number }
      }
      document.database.sha256 = sha256(bytes)
      document.database.byteLength = bytes.byteLength
      await writeFile(manifestPath, JSON.stringify(document))
      expect(
        await restorePersistence({ backup, destination: join(parent, 'destination') }),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('redacts host paths from stable restore errors', async () => {
    const secretPath = join(tmpdir(), 'simproof-sensitive-host-path', 'missing')
    const result = await restorePersistence({
      backup: secretPath,
      destination: `${secretPath}-out`,
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-backup' } })
    expect(JSON.stringify(result)).not.toContain(secretPath)
  })

  it('redacts raw SQLite and artifact filesystem errors from stable results', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'simproof-sensitive-error-path-'))
    const blocker = join(parent, 'not-a-directory')
    try {
      const sqlite = sqliteFailure(
        new Error(`SQLITE_IOERR while opening ${parent}/metadata.sqlite`),
      )
      expect(sqlite).toMatchObject({ ok: false, error: { code: 'database-error' } })
      expect(JSON.stringify(sqlite)).not.toContain(parent)

      await writeFile(blocker, 'file')
      const artifact = await new ArtifactStore(join(blocker, 'nested', 'objects')).putSource(
        'content',
        { normalizationVersion: 1 },
      )
      expect(artifact).toMatchObject({ ok: false, error: { code: 'database-error' } })
      expect(JSON.stringify(artifact)).not.toContain(parent)
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  })
})
