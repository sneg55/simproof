import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { AuthRepository } from './auth-repository.js'
import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { PrivacyRepository } from './privacy-repository.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'

describe('authentication backup safety', () => {
  it('backs up credentials and opted-in prompts without reviving active sessions', async () => {
    const context = await fixture('auth-backup')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-auth-backup-parent-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    const simulationId = id()
    const promptId = id()
    const tokenHash = 'b'.repeat(64)
    const auth = new AuthRepository(context.database.path)
    const privacy = new PrivacyRepository(context.database.path)
    try {
      expectOk(
        context.database.createSimulation({
          id: simulationId,
          title: 'Private prompt owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      expectOk(
        auth.bootstrap({
          credential: {
            passwordHash: 'a'.repeat(64),
            passwordSalt: 'c'.repeat(22),
            passwordHashVersion: 1,
            scryptCost: 16_384,
            scryptBlockSize: 8,
            scryptParallelization: 1,
            scryptKeyLength: 32,
          },
          completedAt: NOW,
        }),
      )
      expectOk(
        auth.createSession(
          {
            id: 'captured-session',
            tokenHash,
            csrfHash: 'd'.repeat(64),
            credentialVersion: 1,
            createdAt: NOW,
            expiresAt: '2026-07-17T12:00:00.000Z',
            rotatedFromId: null,
          },
          { idleSeconds: 900, maxActiveSessions: 2 },
        ),
      )
      expectOk(
        privacy.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
          updatedAt: NOW,
        }),
      )
      expectOk(
        privacy.storePrompt({
          id: promptId,
          simulationId,
          prompt: 'Retain locally for recovery.',
          createdAt: NOW,
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
      expect(auth.findSession(tokenHash)).toMatchObject({ ok: true, value: { revokedAt: null } })

      const snapshot = new DatabaseSync(join(backup, 'metadata.sqlite'))
      expect(snapshot.prepare('SELECT COUNT(*) AS count FROM local_administrator').get()).toEqual({
        count: 1,
      })
      expect(
        snapshot.prepare('SELECT COUNT(*) AS count FROM administrator_sessions').get(),
      ).toEqual({ count: 0 })
      expect(snapshot.prepare('SELECT COUNT(*) AS count FROM retained_prompts').get()).toEqual({
        count: 1,
      })
      snapshot.close()

      expectOk(await restorePersistence({ backup, destination: restored }))
      const restoredAuth = new AuthRepository(join(restored, 'metadata.sqlite'))
      const restoredPrivacy = new PrivacyRepository(join(restored, 'metadata.sqlite'))
      expect(restoredAuth.administrator()).toMatchObject({
        ok: true,
        value: { credentialVersion: 1 },
      })
      expect(restoredAuth.findSession(tokenHash)).toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      })
      expect(restoredPrivacy.settings()).toMatchObject({
        ok: true,
        value: { promptRetentionEnabled: true },
      })
      expect(restoredPrivacy.listPrompts(simulationId)).toMatchObject({
        ok: true,
        value: [{ id: promptId }],
      })
      restoredAuth.close()
      restoredPrivacy.close()
    } finally {
      auth.close()
      privacy.close()
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a checksum-valid backup tampered to contain an active session', async () => {
    const context = await fixture('auth-backup-injected-session')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-auth-injected-session-'))
    const backup = join(parent, 'snapshot')
    const restored = join(parent, 'restored')
    const auth = new AuthRepository(context.database.path)
    try {
      expectOk(
        auth.bootstrap({
          credential: {
            passwordHash: 'a'.repeat(64),
            passwordSalt: 'c'.repeat(22),
            passwordHashVersion: 1,
            scryptCost: 16_384,
            scryptBlockSize: 8,
            scryptParallelization: 1,
            scryptKeyLength: 32,
          },
          completedAt: NOW,
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
      const databasePath = join(backup, 'metadata.sqlite')
      const tampered = new DatabaseSync(databasePath)
      tampered
        .prepare(`INSERT INTO administrator_sessions(
          id,administrator_id,token_hash,csrf_hash,credential_version,created_at,last_activity_at,
          expires_at,rotated_from_id,revoked_at
        ) VALUES (?,1,?,?,1,?,?,?,NULL,NULL)`)
        .run(
          'injected-active-session',
          'e'.repeat(64),
          'f'.repeat(64),
          NOW,
          NOW,
          '2026-07-17T12:00:00.000Z',
        )
      tampered.close()
      const databaseBytes = await readFile(databasePath)
      const manifestPath = join(backup, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        database: { sha256: string; byteLength: number }
      }
      manifest.database.sha256 = sha256(databaseBytes)
      manifest.database.byteLength = databaseBytes.byteLength
      await writeFile(manifestPath, JSON.stringify(manifest))

      await expect(restorePersistence({ backup, destination: restored })).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-backup' },
      })
      await expect(access(restored)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      auth.close()
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })
})
