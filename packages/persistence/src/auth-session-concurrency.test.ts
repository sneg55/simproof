import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'
import { AuthRepository } from './auth-repository.js'
import { AuthSessionStore } from './auth-session-store.js'
import { createPersistence } from './database.js'

const NOW = '2026-07-16T16:00:00.000Z'
const ACTIVE_AT = '2026-07-16T16:00:10.000Z'
const LATER = '2026-07-16T17:00:00.000Z'
const roots: string[] = []
const credential = {
  passwordHash: 'a'.repeat(64),
  passwordSalt: 'c'.repeat(22),
  passwordHashVersion: 1 as const,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
}

async function repository(name: string): Promise<{
  repository: AuthRepository
  databasePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), `simproof-auth-${name}-`))
  roots.push(root)
  const databasePath = join(root, 'metadata.sqlite')
  const persistence = createPersistence(databasePath)
  expect(persistence.migrate()).toMatchObject({ ok: true })
  persistence.close()
  return { repository: new AuthRepository(databasePath), databasePath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('administrator session concurrency', () => {
  it('validates a recently active session without competing for the database write lock', async () => {
    const context = await repository('session-read-fast-path')
    const writer = new DatabaseSync(context.databasePath, { timeout: 0 })
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      expect(
        context.repository.createSession(session('recent-session', '7'), {
          idleSeconds: 900,
          maxActiveSessions: 2,
        }),
      ).toMatchObject({ ok: true })
      writer.exec('BEGIN IMMEDIATE')

      expect(
        context.repository.touchSession({
          tokenHash: '7'.repeat(64),
          activeAt: ACTIVE_AT,
          idleSeconds: 900,
        }),
      ).toMatchObject({ ok: true, value: { lastActivityAt: NOW } })
    } finally {
      if (writer.isTransaction) writer.exec('ROLLBACK')
      writer.close()
      context.repository.close()
    }
  })

  it('denies the read-only path to expired, idle, revoked, and stale-credential sessions', async () => {
    const context = await repository('session-read-fast-path-boundaries')
    const writer = new DatabaseSync(context.databasePath, { timeout: 0 })
    const reader = new DatabaseSync(context.databasePath, { timeout: 0 })
    const sessions = new AuthSessionStore(reader)
    try {
      context.repository.bootstrap({ credential, completedAt: NOW })
      for (const value of [
        session('expired-session', '1', '2026-07-16T16:00:05.000Z'),
        session('idle-session', '2'),
        session('revoked-session', '3'),
        session('stale-credential-session', '4'),
      ]) {
        expect(
          context.repository.createSession(value, { idleSeconds: 900, maxActiveSessions: 8 }),
        ).toMatchObject({ ok: true })
      }
      expect(context.repository.revokeSession('3'.repeat(64), '2026-07-16T16:00:05.000Z')).toEqual({
        ok: true,
        value: true,
      })
      writer.exec('BEGIN IMMEDIATE')
      for (const [tokenHash, idleSeconds] of [
        ['1'.repeat(64), 900],
        ['2'.repeat(64), 5],
        ['3'.repeat(64), 900],
      ] as const) {
        expect(sessions.touch({ tokenHash, activeAt: ACTIVE_AT, idleSeconds })).toMatchObject({
          ok: false,
          error: { code: 'database-error' },
        })
      }
      writer.exec('ROLLBACK')
      writer
        .prepare(
          'UPDATE local_administrator SET credential_version=2,updated_at=? WHERE singleton=1',
        )
        .run('2026-07-16T16:00:05.000Z')
      writer.exec('BEGIN IMMEDIATE')
      expect(
        sessions.touch({ tokenHash: '4'.repeat(64), activeAt: ACTIVE_AT, idleSeconds: 900 }),
      ).toMatchObject({ ok: false, error: { code: 'database-error' } })
    } finally {
      if (writer.isTransaction) writer.exec('ROLLBACK')
      reader.close()
      writer.close()
      context.repository.close()
    }
  })
})

function session(id: string, token: string, expiresAt = LATER) {
  return {
    id,
    tokenHash: token.repeat(64),
    csrfHash: '5'.repeat(64),
    credentialVersion: 1,
    createdAt: NOW,
    expiresAt,
    rotatedFromId: null,
  }
}
