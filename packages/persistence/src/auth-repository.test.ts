import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'
import { validateAuthAndPrivacyRecords } from './auth-privacy-record-validator.js'
import { AuthRepository } from './auth-repository.js'
import { createPersistence } from './database.js'

const NOW = '2026-07-16T16:00:00.000Z'
const LATER = '2026-07-16T17:00:00.000Z'
const roots: string[] = []

async function repository(name: string): Promise<{
  repository: AuthRepository
  databasePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), `simproof-auth-${name}-`))
  roots.push(root)
  const databasePath = join(root, 'metadata.sqlite')
  const persistence = createPersistence(databasePath)
  expect(persistence.migrate()).toMatchObject({ ok: true, value: { applied: [1, 2, 3, 4, 5] } })
  persistence.close()
  return { repository: new AuthRepository(databasePath), databasePath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

const credential = {
  passwordHash: 'a'.repeat(64),
  passwordSalt: 'c'.repeat(22),
  passwordHashVersion: 1 as const,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
}

describe('administrator authentication repository', () => {
  it('bootstraps exactly one administrator and makes completion irreversible', async () => {
    const context = await repository('bootstrap')
    try {
      expect(context.repository.bootstrap({ credential, completedAt: NOW })).toMatchObject({
        ok: true,
        value: { credentialVersion: 1 },
      })
      expect(context.repository.bootstrap({ credential, completedAt: LATER })).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })

      const direct = new DatabaseSync(context.databasePath)
      expect(() => direct.exec('DELETE FROM local_administrator')).toThrow()
      expect(() => direct.exec('DELETE FROM auth_bootstrap')).toThrow()
      direct.close()
    } finally {
      context.repository.close()
    }
  })

  it('allows only one concurrent bootstrap across independent connections', async () => {
    const context = await repository('bootstrap-race')
    const second = new AuthRepository(context.databasePath)
    try {
      const results = await Promise.all([
        Promise.resolve(context.repository.bootstrap({ credential, completedAt: NOW })),
        Promise.resolve(second.bootstrap({ credential, completedAt: NOW })),
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toHaveLength(1)
    } finally {
      second.close()
      context.repository.close()
    }
  })

  it('rotates credentials and revokes every existing session transactionally', async () => {
    const context = await repository('credential-rotation')
    try {
      const administrator = context.repository.bootstrap({ credential, completedAt: NOW })
      if (!administrator.ok) throw new TypeError('fixture setup failed')
      expect(
        context.repository.createSession(
          {
            id: 'session-before-rotation',
            tokenHash: 'b'.repeat(64),
            csrfHash: 'c'.repeat(64),
            credentialVersion: administrator.value.credentialVersion,
            createdAt: NOW,
            expiresAt: LATER,
            rotatedFromId: null,
          },
          { idleSeconds: 900, maxActiveSessions: 2 },
        ),
      ).toMatchObject({ ok: true })

      expect(
        context.repository.rotateCredential({
          expectedVersion: 1,
          credential: { ...credential, passwordHash: 'd'.repeat(64) },
          updatedAt: LATER,
        }),
      ).toMatchObject({ ok: true, value: { credentialVersion: 2, revokedSessions: 1 } })
      expect(context.repository.findSession('b'.repeat(64))).toMatchObject({
        ok: true,
        value: { revokedAt: LATER },
      })
    } finally {
      context.repository.close()
    }
  })

  it('atomically revokes a prior session when rotating to fresh hashes', async () => {
    const context = await repository('session-rotation')
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      context.repository.createSession(
        {
          id: 'old-session',
          tokenHash: 'e'.repeat(64),
          csrfHash: 'f'.repeat(64),
          credentialVersion: 1,
          createdAt: NOW,
          expiresAt: '2026-07-16T18:00:00.000Z',
          rotatedFromId: null,
        },
        { idleSeconds: 900, maxActiveSessions: 2 },
      )
      expect(
        context.repository.rotateSession({
          currentTokenHash: 'e'.repeat(64),
          replacement: {
            id: 'new-session',
            tokenHash: '1'.repeat(64),
            csrfHash: '2'.repeat(64),
            credentialVersion: 1,
            createdAt: LATER,
            expiresAt: '2026-07-16T19:00:00.000Z',
            rotatedFromId: 'old-session',
          },
          rotatedAt: LATER,
          idleSeconds: 7_200,
          maxActiveSessions: 2,
        }),
      ).toMatchObject({ ok: true })
      expect(context.repository.findSession('e'.repeat(64))).toMatchObject({
        ok: true,
        value: { revokedAt: LATER },
      })
      expect(context.repository.findSession('1'.repeat(64))).toMatchObject({
        ok: true,
        value: { revokedAt: null, rotatedFromId: 'old-session' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('revokes every active session through an explicit administrative action', async () => {
    const context = await repository('revoke-all')
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      for (const [id, tokenHash] of [
        ['first', '3'.repeat(64)],
        ['second', '4'.repeat(64)],
      ] as const) {
        context.repository.createSession(
          {
            id,
            tokenHash,
            csrfHash: '5'.repeat(64),
            credentialVersion: 1,
            createdAt: NOW,
            expiresAt: LATER,
            rotatedFromId: null,
          },
          { idleSeconds: 900, maxActiveSessions: 2 },
        )
      }
      expect(context.repository.revokeAllSessions(LATER)).toEqual({ ok: true, value: 2 })
      expect(context.repository.revokeAllSessions(LATER)).toEqual({ ok: true, value: 0 })
    } finally {
      context.repository.close()
    }
  })

  it('touches only live sessions and revokes records at the idle boundary', async () => {
    const context = await repository('session-idle')
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      expect(
        context.repository.createSession(
          {
            id: 'idle-session',
            tokenHash: '8'.repeat(64),
            csrfHash: '9'.repeat(64),
            credentialVersion: 1,
            createdAt: NOW,
            expiresAt: '2026-07-16T19:00:00.000Z',
            rotatedFromId: null,
          },
          { idleSeconds: 900, maxActiveSessions: 2 },
        ),
      ).toMatchObject({ ok: true })
      expect(
        context.repository.touchSession({
          tokenHash: '8'.repeat(64),
          activeAt: '2026-07-16T16:00:10.000Z',
          idleSeconds: 900,
        }),
      ).toMatchObject({ ok: true, value: { lastActivityAt: NOW } })
      const direct = new DatabaseSync(context.databasePath)
      expect(
        direct
          .prepare('SELECT last_activity_at FROM administrator_sessions WHERE id=?')
          .get('idle-session'),
      ).toEqual({ last_activity_at: NOW })
      direct.close()
      expect(
        context.repository.touchSession({
          tokenHash: '8'.repeat(64),
          activeAt: '2026-07-16T16:01:00.000Z',
          idleSeconds: 900,
        }),
      ).toMatchObject({ ok: true, value: { lastActivityAt: '2026-07-16T16:01:00.000Z' } })
      expect(
        context.repository.touchSession({
          tokenHash: '8'.repeat(64),
          activeAt: '2026-07-16T16:16:00.000Z',
          idleSeconds: 900,
        }),
      ).toMatchObject({ ok: false, error: { code: 'not-found' } })
      expect(context.repository.findSession('8'.repeat(64))).toMatchObject({
        ok: true,
        value: { revokedAt: '2026-07-16T16:16:00.000Z' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('serializes independent connections so the active-session cap cannot be exceeded', async () => {
    const context = await repository('session-cap')
    const second = new AuthRepository(context.databasePath)
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      const make = (id: string, hash: string) => ({
        id,
        tokenHash: hash.repeat(64),
        csrfHash: 'a'.repeat(64),
        credentialVersion: 1,
        createdAt: NOW,
        expiresAt: LATER,
        rotatedFromId: null,
      })
      const results = await Promise.all([
        Promise.resolve(
          context.repository.createSession(make('cap-first', 'b'), {
            idleSeconds: 900,
            maxActiveSessions: 1,
          }),
        ),
        Promise.resolve(
          second.createSession(make('cap-second', 'c'), {
            idleSeconds: 900,
            maxActiveSessions: 1,
          }),
        ),
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toHaveLength(1)
      const direct = new DatabaseSync(context.databasePath)
      expect(
        direct
          .prepare('SELECT COUNT(*) AS count FROM administrator_sessions WHERE revoked_at IS NULL')
          .get(),
      ).toEqual({ count: 1 })
      direct.close()
    } finally {
      second.close()
      context.repository.close()
    }
  })

  it('deterministically bounds inactive metadata across login, rotation, logout, and expiry', async () => {
    const context = await repository('session-pruning')
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      const origin = Date.parse(NOW)
      for (let index = 0; index < 300; index += 1) {
        const createdAt = new Date(origin + index * 10).toISOString()
        const expiresAt = new Date(
          origin + index * 10 + (index % 10 === 0 ? 1 : 60_000),
        ).toISOString()
        const tokenHash = hash(`session-${index}`)
        expect(
          context.repository.createSession(
            {
              id: `session-${index}`,
              tokenHash,
              csrfHash: hash(`csrf-${index}`),
              credentialVersion: 1,
              createdAt,
              expiresAt,
              rotatedFromId: null,
            },
            { idleSeconds: 900, maxActiveSessions: 2 },
          ),
        ).toMatchObject({ ok: true })
        if (index % 10 === 0) continue
        if (index % 3 === 0) {
          const rotatedAt = new Date(origin + index * 10 + 1).toISOString()
          const replacementHash = hash(`replacement-${index}`)
          expect(
            context.repository.rotateSession({
              currentTokenHash: tokenHash,
              replacement: {
                id: `replacement-${index}`,
                tokenHash: replacementHash,
                csrfHash: hash(`replacement-csrf-${index}`),
                credentialVersion: 1,
                createdAt: rotatedAt,
                expiresAt: new Date(origin + index * 10 + 60_000).toISOString(),
                rotatedFromId: `session-${index}`,
              },
              rotatedAt,
              idleSeconds: 900,
              maxActiveSessions: 2,
            }),
          ).toMatchObject({ ok: true })
          context.repository.revokeSession(
            replacementHash,
            new Date(origin + index * 10 + 2).toISOString(),
          )
        } else {
          context.repository.revokeSession(
            tokenHash,
            new Date(origin + index * 10 + 1).toISOString(),
          )
        }
      }
      const direct = new DatabaseSync(context.databasePath, { enableForeignKeyConstraints: true })
      expect(direct.prepare('SELECT COUNT(*) AS count FROM administrator_sessions').get()).toEqual({
        count: 256,
      })
      expect(direct.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() => validateAuthAndPrivacyRecords(direct)).not.toThrow()
      direct.close()
    } finally {
      context.repository.close()
    }
  })

  it('fails closed when directly written authentication timestamps are malformed', async () => {
    const context = await repository('malformed-auth-records')
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      const direct = new DatabaseSync(context.databasePath)
      direct
        .prepare(`INSERT INTO administrator_sessions(
          id,administrator_id,token_hash,csrf_hash,credential_version,created_at,last_activity_at,
          expires_at
        ) VALUES (?,1,?,?,1,?,?,?)`)
        .run('malformed-session', '6'.repeat(64), '7'.repeat(64), NOW, NOW, 'not-a-timestamp')
      expect(context.repository.findSession('6'.repeat(64))).toMatchObject({
        ok: false,
        error: { code: 'database-error' },
      })
      direct.prepare('UPDATE local_administrator SET updated_at=?').run('not-a-timestamp')
      direct.close()
      expect(context.repository.administrator()).toMatchObject({
        ok: false,
        error: { code: 'database-error' },
      })
    } finally {
      context.repository.close()
    }
  })
})
