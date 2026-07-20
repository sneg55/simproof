import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ArtifactStore, createPersistence } from '@simproof/persistence'
import { describe, expect, it, vi } from 'vitest'

import {
  activateRestore,
  deploymentCheck,
  parseOperation,
  rollbackRestore,
  validateRestoreCandidate,
  withExclusiveLease,
} from '../../../deployment/operations.mjs'

const imageId = `sha256:${'a'.repeat(64)}`

describe('deployment operation parsing', () => {
  it('accepts only bounded named maintenance paths and explicit stop confirmation', () => {
    expect(parseOperation(['backup', '--name', 'pre-upgrade-20260717'])).toEqual({
      command: 'backup',
      name: 'pre-upgrade-20260717',
    })
    expect(parseOperation(['migrate', '--confirm-stopped'])).toEqual({
      command: 'migrate',
      confirmStopped: true,
    })
    expect(
      parseOperation([
        'restore-activate',
        '--name',
        'validated',
        '--rollback',
        'before-restore',
        '--confirm-stopped',
      ]),
    ).toEqual({
      command: 'restore-activate',
      name: 'validated',
      rollback: 'before-restore',
      confirmStopped: true,
    })
    for (const input of [
      ['backup', '--name', '../escape'],
      ['backup', '--name', '/absolute'],
      ['restore-activate', '--name', 'validated', '--rollback', 'old'],
      ['migrate'],
      ['unknown'],
    ]) {
      expect(parseOperation(input)).toBeUndefined()
    }
  })
})

describe('maintenance exclusivity', () => {
  it('holds the application marker across maintenance and releases it afterward', async () => {
    const root = await deploymentRoot('lease')
    await withExclusiveLease(root, async () => {
      expect(
        await readFile(join(root, '.application-running')).catch(() => undefined),
      ).toBeUndefined()
      await expect(mkdir(join(root, '.application-running'))).rejects.toMatchObject({
        code: 'EEXIST',
      })
    })
    await expect(mkdir(join(root, '.application-running'))).resolves.toBeUndefined()
  })

  it('refuses maintenance while the application marker exists', async () => {
    const root = await deploymentRoot('leased-running')
    await mkdir(join(root, '.application-running'))
    await expect(withExclusiveLease(root, () => undefined)).rejects.toThrow(
      'application is not stopped',
    )
  })
})

describe('first-run diagnostics', () => {
  it('checks every local dependency and reports presence booleans without calling a provider', async () => {
    const root = await deploymentRoot('check')
    const databasePath = join(root, 'current', 'metadata.sqlite')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    const fetchRunner = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ready', protocolVersion: '1', image: imageId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const provider = vi.fn()
    const result = await deploymentCheck(
      {
        databasePath,
        artifactRoot: join(root, 'current', 'artifacts'),
        observability: { diagnosticLogRoot: root },
        runner: { endpoint: 'http://runner-launcher:4318', token: 'sentinel', image: imageId },
        providers: { openaiApiKey: undefined, codexApiKey: undefined },
      },
      {
        fetch: fetchRunner,
        readiness: {
          probeConfiguration: () => ({ ok: true }),
          probeDatabase: (candidate: { readiness(): { ok: boolean } }) => candidate.readiness(),
          probeArtifactStore: async (store: ArtifactStore) => await store.readiness(),
        },
      },
    )
    expect(result).toEqual({
      ready: true,
      report: {
        configuration: 'ready',
        database: 'ready',
        artifacts: 'ready',
        runner: 'ready',
        administratorConfigured: false,
        providers: { openaiConfigured: false, codexConfigured: false },
      },
    })
    expect(fetchRunner).toHaveBeenCalledWith(
      new URL('http://runner-launcher:4318/v1/capabilities'),
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer sentinel' },
      }),
    )
    expect(provider).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('sentinel')
  })

  it.each([
    { status: 'ready', protocolVersion: '2', image: imageId },
    { status: 'ready', protocolVersion: '1', image: `sha256:${'b'.repeat(64)}` },
    { status: 'ready', protocolVersion: '1', image: imageId, extra: true },
  ])('fails readiness for a mismatched launcher capability', async (capability) => {
    const root = await deploymentRoot(`capability-${randomUUID()}`)
    const databasePath = join(root, 'current', 'metadata.sqlite')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    const result = await deploymentCheck(
      {
        databasePath,
        artifactRoot: join(root, 'current', 'artifacts'),
        observability: { diagnosticLogRoot: root },
        runner: { endpoint: 'http://runner-launcher:4318', token: 'sentinel', image: imageId },
        providers: { openaiApiKey: undefined, codexApiKey: undefined },
      },
      {
        fetch: vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify(capability), { status: 200 })),
        ),
        readiness: {
          probeConfiguration: () => ({ ok: true }),
          probeDatabase: (candidate: { readiness(): { ok: boolean } }) => candidate.readiness(),
          probeArtifactStore: async (store: ArtifactStore) => await store.readiness(),
        },
      },
    )
    expect(result.ready).toBe(false)
    expect(result.report.runner).toBe('not-ready')
    expect(JSON.stringify(result)).not.toContain('sentinel')
  })
})

describe('atomic restore activation', () => {
  it('swaps a validated restore and preserves the previous current root', async () => {
    const root = await deploymentRoot('activation')
    await writeFile(join(root, 'current', 'sentinel'), 'current')
    await mkdir(join(root, 'restores', 'validated'))
    await writeFile(join(root, 'restores', 'validated', 'sentinel'), 'restored')

    await activateRestore(
      { root, name: 'validated', rollback: 'before-restore' },
      { validate: () => Promise.resolve() },
    )

    expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('restored')
    expect(await readFile(join(root, 'rollbacks', 'before-restore', 'sentinel'), 'utf8')).toBe(
      'current',
    )
  })

  it('restores the prior root when publishing the candidate fails', async () => {
    const root = await deploymentRoot('interrupted')
    await writeFile(join(root, 'current', 'sentinel'), 'current')
    await mkdir(join(root, 'restores', 'validated'))
    let renameCalls = 0

    await expect(
      activateRestore(
        { root, name: 'validated', rollback: 'before-restore' },
        {
          validate: () => Promise.resolve(),
          rename: async (from: string, to: string) => {
            renameCalls += 1
            if (renameCalls === 2) throw new Error('injected failure')
            const { rename } = await import('node:fs/promises')
            await rename(from, to)
          },
        },
      ),
    ).rejects.toThrow('Restore activation failed')
    expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('current')
  })

  it.each([1, 3])(
    'restores both activation trees when directory sync call %i fails',
    async (failedCall) => {
      const root = await deploymentRoot(`activation-sync-${failedCall}`)
      const candidate = join(root, 'restores', 'validated')
      await writeFile(join(root, 'current', 'sentinel'), 'current')
      await mkdir(candidate)
      await writeFile(join(candidate, 'sentinel'), 'restored')
      let syncCalls = 0

      await expect(
        activateRestore(
          { root, name: 'validated', rollback: 'before-restore' },
          {
            validate: () => Promise.resolve(),
            syncDirectory: () => {
              syncCalls += 1
              if (syncCalls === failedCall)
                return Promise.reject(new Error('injected sync failure'))
              return Promise.resolve()
            },
          },
        ),
      ).rejects.toThrow('Restore activation failed')

      expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('current')
      expect(await readFile(join(candidate, 'sentinel'), 'utf8')).toBe('restored')
      expect(await lstat(join(root, 'rollbacks', 'before-restore')).catch(() => undefined)).toBe(
        undefined,
      )
    },
  )

  it('fails closed for a live marker, symlink candidate, or occupied rollback', async () => {
    const running = await deploymentRoot('running')
    await mkdir(join(running, '.application-running'))
    await mkdir(join(running, 'restores', 'validated'))
    await expect(
      activateRestore({ root: running, name: 'validated', rollback: 'before' }),
    ).rejects.toThrow('application is not stopped')

    const linked = await deploymentRoot('linked')
    await symlink(join(linked, 'current'), join(linked, 'restores', 'validated'))
    await expect(
      activateRestore({ root: linked, name: 'validated', rollback: 'before' }),
    ).rejects.toThrow('Restore candidate is invalid')

    const collision = await deploymentRoot('collision')
    await mkdir(join(collision, 'restores', 'validated'))
    await mkdir(join(collision, 'rollbacks', 'before'))
    await expect(
      activateRestore({ root: collision, name: 'validated', rollback: 'before' }),
    ).rejects.toThrow('Rollback destination already exists')
  })

  it('can atomically roll back while retaining the failed root for inspection', async () => {
    const root = await deploymentRoot('rollback')
    await writeFile(join(root, 'current', 'sentinel'), 'failed-upgrade')
    await mkdir(join(root, 'rollbacks', 'known-good'))
    await writeFile(join(root, 'rollbacks', 'known-good', 'sentinel'), 'known-good')

    await rollbackRestore(
      { root, name: 'known-good', failed: 'failed-release' },
      { validate: () => Promise.resolve() },
    )

    expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('known-good')
    expect(await readFile(join(root, 'rollbacks', 'failed-release', 'sentinel'), 'utf8')).toBe(
      'failed-upgrade',
    )
  })

  it.each([1, 3])(
    'restores both rollback trees when directory sync call %i fails',
    async (failedCall) => {
      const root = await deploymentRoot(`rollback-sync-${failedCall}`)
      const knownGood = join(root, 'rollbacks', 'known-good')
      await writeFile(join(root, 'current', 'sentinel'), 'failed-upgrade')
      await mkdir(knownGood)
      await writeFile(join(knownGood, 'sentinel'), 'known-good')
      let syncCalls = 0

      await expect(
        rollbackRestore(
          { root, name: 'known-good', failed: 'failed-release' },
          {
            validate: () => Promise.resolve(),
            syncDirectory: () => {
              syncCalls += 1
              if (syncCalls === failedCall)
                return Promise.reject(new Error('injected sync failure'))
              return Promise.resolve()
            },
          },
        ),
      ).rejects.toThrow('Rollback activation failed')

      expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('failed-upgrade')
      expect(await readFile(join(knownGood, 'sentinel'), 'utf8')).toBe('known-good')
      expect(await lstat(join(root, 'rollbacks', 'failed-release')).catch(() => undefined)).toBe(
        undefined,
      )
    },
  )

  it('revalidates immediately before activation and rejects a tampered candidate', async () => {
    const root = await deploymentRoot('tamper')
    await writeFile(join(root, 'current', 'sentinel'), 'current')
    const candidate = join(root, 'restores', 'validated')
    await mkdir(candidate)
    const databasePath = join(candidate, 'metadata.sqlite')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    expect(await new ArtifactStore(join(candidate, 'artifacts')).identities()).toMatchObject({
      ok: true,
    })
    await expect(validateRestoreCandidate(candidate)).resolves.toBeUndefined()
    await writeFile(databasePath, 'tampered')

    await expect(activateRestore({ root, name: 'validated', rollback: 'before' })).rejects.toThrow(
      'Restore candidate is invalid',
    )
    expect(await readFile(join(root, 'current', 'sentinel'), 'utf8')).toBe('current')
  })

  it('syncs every rename parent during activation', async () => {
    const root = await deploymentRoot('durability')
    await mkdir(join(root, 'restores', 'validated'))
    const synced: string[] = []
    await activateRestore(
      { root, name: 'validated', rollback: 'before' },
      {
        validate: () => Promise.resolve(),
        syncDirectory: (path: string) => {
          synced.push(path)
          return Promise.resolve()
        },
      },
    )
    expect(new Set(synced)).toEqual(
      new Set([root, join(root, 'restores'), join(root, 'rollbacks')]),
    )
  })

  it('rejects extra and missing artifact identities before activation', async () => {
    const root = await deploymentRoot('artifact-set')
    const candidate = join(root, 'restores', 'validated')
    await mkdir(candidate)
    const database = createPersistence(join(candidate, 'metadata.sqlite'))
    expect(database.migrate()).toMatchObject({ ok: true })
    const store = new ArtifactStore(join(candidate, 'artifacts'))
    const object = await store.putJson({ candidate: true }, { normalizationVersion: 1 })
    expect(object).toMatchObject({ ok: true })
    if (!object.ok) throw new Error('fixture artifact failed')
    await expect(validateRestoreCandidate(candidate)).rejects.toThrow(
      'Restore candidate is invalid',
    )

    expect(
      await database.records.insertStoredArtifact(
        {
          id: randomUUID(),
          role: 'manifest',
          contentHash: object.value.hash,
          mediaType: 'application/json',
          byteLength: object.value.byteLength,
          normalizationVersion: 1,
          createdAt: '2026-07-17T12:00:00.000Z',
        },
        store,
      ),
    ).toMatchObject({ ok: true })
    await expect(validateRestoreCandidate(candidate)).resolves.toBeUndefined()
    expect(await store.delete(object.value.hash)).toMatchObject({ ok: true })
    database.close()
    await expect(validateRestoreCandidate(candidate)).rejects.toThrow(
      'Restore candidate is invalid',
    )
  })

  it.each(['metadata-link', 'artifact-link', 'metadata-directory'])(
    'rejects a restore candidate containing a nested %s',
    async (kind) => {
      const root = await deploymentRoot(`nested-${kind}`)
      const candidate = join(root, 'restores', 'validated')
      const external = join(root, 'external')
      await mkdir(candidate)
      await mkdir(external)

      const externalDatabase = join(external, 'metadata.sqlite')
      const database = createPersistence(externalDatabase)
      expect(database.migrate()).toMatchObject({ ok: true })
      database.close()
      const externalArtifacts = join(external, 'artifacts')
      expect(await new ArtifactStore(externalArtifacts).identities()).toMatchObject({ ok: true })

      if (kind === 'metadata-link') {
        await symlink(externalDatabase, join(candidate, 'metadata.sqlite'))
        await mkdir(join(candidate, 'artifacts'))
      } else if (kind === 'artifact-link') {
        const candidateDatabase = createPersistence(join(candidate, 'metadata.sqlite'))
        expect(candidateDatabase.migrate()).toMatchObject({ ok: true })
        candidateDatabase.close()
        await symlink(externalArtifacts, join(candidate, 'artifacts'))
      } else {
        await mkdir(join(candidate, 'metadata.sqlite'))
        await mkdir(join(candidate, 'artifacts'))
      }

      await expect(validateRestoreCandidate(candidate)).rejects.toThrow(
        'Restore candidate is invalid',
      )
    },
  )

  it.each(['extra', 'missing'])(
    'rejects %s top-level restore content introduced after staging',
    async (kind) => {
      const root = await deploymentRoot(`exact-entries-${kind}`)
      const candidate = join(root, 'restores', 'validated')
      await mkdir(candidate)
      const database = createPersistence(join(candidate, 'metadata.sqlite'))
      expect(database.migrate()).toMatchObject({ ok: true })
      database.close()
      const artifactRoot = join(candidate, 'artifacts')
      expect(await new ArtifactStore(artifactRoot).identities()).toMatchObject({ ok: true })
      if (kind === 'extra') await writeFile(join(candidate, 'unexpected'), 'late content')
      else await rm(artifactRoot, { recursive: true })

      await expect(validateRestoreCandidate(candidate)).rejects.toThrow(
        'Restore candidate is invalid',
      )
    },
  )

  it('rejects a restored administrator session even when the record is structurally valid', async () => {
    const root = await deploymentRoot('session')
    const candidate = join(root, 'restores', 'validated')
    await mkdir(candidate)
    const databasePath = join(candidate, 'metadata.sqlite')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    expect(await new ArtifactStore(join(candidate, 'artifacts')).identities()).toMatchObject({
      ok: true,
    })
    const raw = new DatabaseSync(databasePath)
    const now = '2026-07-17T12:00:00.000Z'
    raw.prepare('INSERT INTO auth_bootstrap(singleton,completed_at) VALUES (1,?)').run(now)
    raw
      .prepare(`INSERT INTO local_administrator(
        singleton,password_hash,password_salt,password_hash_version,scrypt_cost,scrypt_block_size,
        scrypt_parallelization,scrypt_key_length,credential_version,created_at,updated_at
      ) VALUES (1,?,?,1,16384,8,1,32,1,?,?)`)
      .run('a'.repeat(64), 'abcdefghijklmnopqrstuv', now, now)
    raw
      .prepare(`INSERT INTO administrator_sessions(
        id,administrator_id,token_hash,csrf_hash,credential_version,created_at,last_activity_at,
        expires_at,rotated_from_id,revoked_at
      ) VALUES (?,1,?,?,1,?,?,?,NULL,NULL)`)
      .run('session-00000001', 'b'.repeat(64), 'c'.repeat(64), now, now, '2026-07-17T13:00:00.000Z')
    raw.close()

    await expect(validateRestoreCandidate(candidate)).rejects.toThrow(
      'Restore candidate is invalid',
    )
  })
})

async function deploymentRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `simproof-${label}-`))
  await mkdir(join(root, 'current'))
  await mkdir(join(root, 'restores'))
  await mkdir(join(root, 'rollbacks'))
  return root
}
