import { lstat, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { ArtifactCleanup } from './artifact-cleanup.js'
import { ArtifactStore } from './artifact-store.js'
import { fixture, id, NOW } from './test-helpers.js'
import type { Result } from './types.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

const roots: string[] = []

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `simproof-${name}-`))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('artifact cleanup consistency', () => {
  it('recomputes protected hashes after a second connection writes between cleanup phases', async () => {
    const context = await fixture('cleanup-cross-process-gap')
    const object = await context.store.putSource('committed in the phase gap', {
      normalizationVersion: 1,
    })
    if (!object.ok) throw new TypeError('fixture setup failed')
    const coordinator = new DatabaseSync(context.database.path)
    const cleanup = new ArtifactCleanup(
      coordinator,
      async (operation) => await operation(),
      async <T, U>(
        metadata: () => Result<T> | Promise<Result<T>>,
        collect: (value: T) => Promise<Result<U>>,
      ): Promise<Result<U>> => {
        coordinator.exec('BEGIN IMMEDIATE')
        const first = await metadata()
        coordinator.exec(first.ok ? 'COMMIT' : 'ROLLBACK')
        if (!first.ok) return first

        const observer = new DatabaseSync(context.database.path)
        try {
          observer
            .prepare(`INSERT INTO stored_artifacts(
              id,role,content_hash,media_type,byte_length,normalization_version,created_at
            ) VALUES (?,?,?,?,?,?,?)`)
            .run(
              id(),
              'core-source',
              object.value.hash,
              'text/javascript',
              object.value.byteLength,
              1,
              NOW,
            )
        } finally {
          observer.close()
        }

        coordinator.exec('BEGIN IMMEDIATE')
        try {
          return await collect(first.value)
        } finally {
          coordinator.exec('ROLLBACK')
        }
      },
    )
    try {
      const result = await cleanup.auditAndCollect(context.store, {
        dryRun: false,
        minimumAgeMs: 0,
      })
      expect(result).toMatchObject({
        ok: true,
        value: { deletedArtifacts: [], deferredArtifacts: [] },
      })
      expect(await context.store.get(object.value.hash)).toMatchObject({ ok: true })
      expect(
        coordinator
          .prepare('SELECT 1 FROM stored_artifacts WHERE content_hash=?')
          .get(object.value.hash),
      ).toBeDefined()
    } finally {
      coordinator.close()
      await context.cleanup()
    }
  })

  it('commits unreferenced metadata before destructive CAS cleanup starts', async () => {
    const context = await fixture('cleanup-commit-order')
    const object = await context.store.putSource('unreferenced metadata', {
      normalizationVersion: 1,
    })
    if (!object.ok) throw new TypeError('fixture setup failed')
    await context.database.records.insertStoredArtifact(
      {
        id: id(),
        role: 'core-source',
        contentHash: object.value.hash,
        mediaType: 'text/javascript',
        byteLength: object.value.byteLength,
        normalizationVersion: 1,
        createdAt: NOW,
      },
      context.store,
    )
    let metadataVisibleWhenDeleteStarted: boolean | undefined
    class CommitObservingStore extends ArtifactStore {
      override async delete(hash: `sha256:${string}`) {
        const observer = new DatabaseSync(context.database.path)
        try {
          metadataVisibleWhenDeleteStarted =
            observer
              .prepare('SELECT 1 FROM stored_artifacts WHERE content_hash=? LIMIT 1')
              .get(hash) !== undefined
        } finally {
          observer.close()
        }
        return await super.delete(hash)
      }
    }
    try {
      const result = await context.database.maintenance.auditAndCollect(
        new CommitObservingStore(context.store.root),
        { dryRun: false, minimumAgeMs: 0 },
      )
      expect(result).toMatchObject({
        ok: true,
        value: { deletedArtifacts: [object.value.hash], deferredArtifacts: [] },
      })
      expect(metadataVisibleWhenDeleteStarted).toBe(false)
    } finally {
      await context.cleanup()
    }
  })

  it('serializes metadata insertion across asynchronous CAS verification', async () => {
    const context = await fixture('insert-cas-serialization')
    const object = await context.store.putSource('candidate metadata', {
      normalizationVersion: 1,
    })
    if (!object.ok) throw new TypeError('fixture setup failed')
    let enteredVerification!: () => void
    let releaseVerification!: () => void
    const verificationStarted = new Promise<void>((resolve) => {
      enteredVerification = resolve
    })
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve
    })
    class SuspendedVerificationStore extends ArtifactStore {
      override async verifyMetadata(input: Parameters<ArtifactStore['verifyMetadata']>[0]) {
        const result = await super.verifyMetadata(input)
        enteredVerification()
        await verificationGate
        return result
      }
    }
    let enteredCleanup!: () => void
    const cleanupStarted = new Promise<'entered'>((resolve) => {
      enteredCleanup = () => resolve('entered')
    })
    class ObservedCleanupStore extends ArtifactStore {
      override async identities() {
        enteredCleanup()
        return await super.identities()
      }
    }
    const insertion = context.database.records.insertStoredArtifact(
      {
        id: id(),
        role: 'core-source',
        contentHash: object.value.hash,
        mediaType: 'text/javascript',
        byteLength: object.value.byteLength,
        normalizationVersion: 1,
        createdAt: NOW,
      },
      new SuspendedVerificationStore(context.store.root),
    )
    let cleanup: Promise<unknown> | undefined
    try {
      await verificationStarted
      cleanup = context.database.maintenance.auditAndCollect(
        new ObservedCleanupStore(context.store.root),
        { dryRun: false, minimumAgeMs: 0 },
      )
      const first = await Promise.race([
        cleanupStarted,
        new Promise<'blocked'>((resolve) => setImmediate(() => resolve('blocked'))),
      ])
      expect(first).toBe('blocked')
      releaseVerification()
      await expect(insertion).resolves.toMatchObject({ ok: true })
      await expect(cleanup).resolves.toMatchObject({
        ok: true,
        value: {
          orphanedArtifacts: [object.value.hash],
          deletedArtifacts: [object.value.hash],
        },
      })
      await expect(context.store.get(object.value.hash)).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
    } finally {
      releaseVerification()
      await insertion.catch(() => undefined)
      await cleanup?.catch(() => undefined)
      await context.cleanup()
    }
  })

  it('classifies grace-skipped orphans and safely ages owned temporary files', async () => {
    const store = new ArtifactStore(await temporaryRoot('cleanup-classification'))
    const object = await store.putSource('young orphan', { normalizationVersion: 1 })
    if (!object.ok) throw new TypeError('fixture setup failed')
    const objectPath = store.pathForHash(object.value.hash)
    const temporaryPath = `${objectPath}.019f6bc1-0811-70c1-a139-938a3ad2dee0.tmp`
    await writeFile(temporaryPath, 'owned partial')
    const nowMs = (await lstat(temporaryPath)).mtimeMs

    const young = await store.auditAndCollect([], {
      dryRun: false,
      minimumAgeMs: 1_000,
      nowMs,
    })
    expect(young).toEqual({
      ok: true,
      value: {
        orphanedArtifacts: [object.value.hash],
        deletedArtifacts: [],
        skippedArtifacts: [object.value.hash],
        deferredArtifacts: [],
        temporaryFiles: { found: 1, deleted: 0, skipped: 1, deferred: 0 },
      },
    })
    await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('owned partial')

    await utimes(temporaryPath, 0, 0)
    const aged = await store.auditAndCollect([], {
      dryRun: false,
      minimumAgeMs: 0,
      nowMs,
    })
    expect(aged).toMatchObject({
      ok: true,
      value: {
        deletedArtifacts: [object.value.hash],
        skippedArtifacts: [],
        deferredArtifacts: [],
        temporaryFiles: { found: 1, deleted: 1, skipped: 0, deferred: 0 },
      },
    })
    await expect(readFile(temporaryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rediscovers deferred deletion from durable CAS state for operator retry', async () => {
    const context = await verifiedFixture('cleanup-retry')
    class FailingDeleteStore extends ArtifactStore {
      override delete(_hash: `sha256:${string}`) {
        return Promise.resolve({
          ok: false as const,
          error: { code: 'database-error' as const, message: 'injected failure' },
        })
      }
    }
    try {
      const first = await context.database.maintenance.deleteSimulation(
        context.simulationId,
        new FailingDeleteStore(context.store.root),
      )
      expect(first).toMatchObject({
        ok: true,
        value: {
          deletedArtifacts: [],
          deferredArtifacts: expect.arrayContaining([expect.any(String)]),
        },
      })
      const retry = await context.database.maintenance.auditAndCollect(context.store, {
        dryRun: false,
        minimumAgeMs: 0,
      })
      expect(retry).toMatchObject({
        ok: true,
        value: {
          deletedArtifacts: expect.arrayContaining(
            first.ok ? [...first.value.deferredArtifacts] : [],
          ),
          deferredArtifacts: [],
        },
      })
    } finally {
      await context.cleanup()
    }
  })
})
