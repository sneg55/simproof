import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StoredArtifactRole } from '@simproof/contracts'
import { expect } from 'vitest'

import { ArtifactStore } from './artifact-store.js'
import { createPersistence } from './database.js'
import type { InstalledEvidenceResolver } from './types.js'

export const NOW = '2026-07-16T12:00:00.000Z'
export const id = () => randomUUID()
export const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

export function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new TypeError(JSON.stringify(result.error))
  expect(result.ok).toBe(true)
  return result.value
}

export async function fixture(name: string, resolveInstalledEvidence?: InstalledEvidenceResolver) {
  const root = await mkdtemp(join(tmpdir(), `simproof-${name}-`))
  const database = createPersistence(join(root, 'metadata.sqlite'), resolveInstalledEvidence)
  expectOk(database.migrate())
  return {
    root,
    database,
    store: new ArtifactStore(join(root, 'artifacts')),
    cleanup: async () => {
      database.close()
      await rm(root, { force: true, recursive: true })
    },
  }
}

export async function stored(
  database: ReturnType<typeof createPersistence>,
  store: ArtifactStore,
  role: StoredArtifactRole,
  content: string,
) {
  const object = expectOk(
    role === 'core-source' || role === 'renderer-source'
      ? await store.putSource(content, { normalizationVersion: 1 })
      : await store.putJson(content, { normalizationVersion: 1 }),
  )
  const record = {
    id: id(),
    role,
    contentHash: object.hash,
    mediaType:
      role === 'core-source' || role === 'renderer-source'
        ? ('text/javascript' as const)
        : ('application/json' as const),
    byteLength: object.byteLength,
    normalizationVersion: 1,
    createdAt: NOW,
  }
  expectOk(await database.records.insertStoredArtifact(record, store))
  return record
}
