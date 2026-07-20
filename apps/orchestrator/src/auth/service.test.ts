import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  ArtifactStore,
  AuthRepository,
  backupPersistence,
  createPersistence,
} from '@simproof/persistence'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthService } from './service.js'

const BOOTSTRAP_SECRET = 'bootstrap-secret-with-enough-unique-characters-8421'
const SESSION_SECRET = 'session-secret-with-enough-unique-characters-1937'
const PASSWORD = 'teacher password phrase'
const roots: string[] = []

async function serviceFixture(options: { readonly advancingClock?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-auth-service-'))
  roots.push(root)
  const path = join(root, 'metadata.sqlite')
  const persistence = createPersistence(path)
  expect(persistence.migrate()).toMatchObject({ ok: true })
  persistence.close()
  const repository = new AuthRepository(path)
  let now = Date.parse('2026-07-16T12:00:00.000Z')
  const readClock = () => {
    const value = now
    if (options.advancingClock === true) now += 1
    return value
  }
  const service = new AuthService(repository, {
    bootstrapSecret: BOOTSTRAP_SECRET,
    sessionSecret: SESSION_SECRET,
    sessionTtlSeconds: 3_600,
    sessionIdleSeconds: 900,
    maxActiveSessions: 2,
    now: readClock,
  })
  return { path, repository, service, advance: (milliseconds: number) => (now += milliseconds) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local administrator authentication service', () => {
  it('uses an environment-only secret for one irreversible bootstrap', async () => {
    const context = await serviceFixture()
    try {
      expect(
        await context.service.bootstrap({
          bootstrapSecret: 'wrong-bootstrap-secret-that-is-still-long-enough',
          newPassword: PASSWORD,
        }),
      ).toEqual({
        ok: false,
        error: { code: 'bootstrap-denied', message: 'Administrator bootstrap was denied.' },
      })
      expect(
        await context.service.bootstrap({
          bootstrapSecret: BOOTSTRAP_SECRET,
          newPassword: PASSWORD,
        }),
      ).toMatchObject({ ok: true })
      expect(
        await context.service.bootstrap({
          bootstrapSecret: BOOTSTRAP_SECRET,
          newPassword: PASSWORD,
        }),
      ).toEqual({
        ok: false,
        error: { code: 'bootstrap-denied', message: 'Administrator bootstrap was denied.' },
      })

      const bytes = new DatabaseSync(context.path)
        .prepare(`SELECT password_hash,password_salt FROM local_administrator`)
        .get() as Record<string, unknown>
      expect(JSON.stringify(bytes)).not.toContain(BOOTSTRAP_SECRET)
      expect(JSON.stringify(bytes)).not.toContain(PASSWORD)
    } finally {
      context.repository.close()
    }
  })

  it('returns generic login failures and persists only keyed token and CSRF hashes', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      expect(await context.service.login({ password: 'wrong password' })).toEqual({
        ok: false,
        error: { code: 'authentication-failed', message: 'Authentication failed.' },
      })
      const login = await context.service.login({ password: PASSWORD })
      if (!login.ok) throw new TypeError('login fixture failed')
      expect(login.value.sessionToken).toMatch(/^[\w-]{43}$/u)
      expect(login.value.csrfToken).toMatch(/^[\w-]{43}$/u)

      const row = new DatabaseSync(context.path)
        .prepare('SELECT token_hash,csrf_hash FROM administrator_sessions')
        .get() as Record<string, unknown>
      expect(row.token_hash).toMatch(/^[\da-f]{64}$/u)
      expect(row.csrf_hash).toMatch(/^[\da-f]{64}$/u)
      expect(JSON.stringify(row)).not.toContain(login.value.sessionToken)
      expect(JSON.stringify(row)).not.toContain(login.value.csrfToken)
    } finally {
      context.repository.close()
    }
  })

  it('recovers a browser-safe CSRF token for an authenticated cookie session', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const login = await context.service.login({ password: PASSWORD })
      if (!login.ok) throw new TypeError('login fixture failed')

      const recovered = context.service.session(login.value.sessionToken)
      expect(recovered).toEqual({
        ok: true,
        value: {
          authenticated: true,
          csrfToken: login.value.csrfToken,
          expiresAt: login.value.expiresAt,
        },
      })
      if (!recovered.ok) throw new TypeError('session fixture failed')
      expect(
        context.service.authenticate(login.value.sessionToken, recovered.value.csrfToken),
      ).toMatchObject({ ok: true })
      expect(context.service.session('z'.repeat(43))).toEqual({
        ok: false,
        error: { code: 'session-invalid', message: 'Session is invalid.' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('performs bounded asynchronous password work before bootstrap for schema-valid login', async () => {
    const context = await serviceFixture()
    try {
      let settled = false
      const login = context.service.login({ password: PASSWORD }).then((result) => {
        settled = true
        return result
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      await expect(login).resolves.toMatchObject({
        ok: false,
        error: { code: 'authentication-failed' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('issues fresh tokens, resists fixation, and atomically rotates sessions', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const first = await context.service.login({ password: PASSWORD })
      if (!first.ok) throw new TypeError('login fixture failed')
      const fixed = 'f'.repeat(43)
      const second = await context.service.login({ password: PASSWORD }, fixed)
      if (!second.ok) throw new TypeError('login fixture failed')
      expect(second.value.sessionToken).not.toBe(fixed)
      expect(second.value.sessionToken).not.toBe(first.value.sessionToken)

      const rotated = context.service.rotate(first.value.sessionToken, first.value.csrfToken)
      if (!rotated.ok) throw new TypeError('rotation fixture failed')
      expect(rotated.value.sessionToken).not.toBe(first.value.sessionToken)
      expect(context.service.authenticate(first.value.sessionToken)).toMatchObject({
        ok: false,
        error: { code: 'session-invalid' },
      })
      expect(
        context.service.authenticate(rotated.value.sessionToken, rotated.value.csrfToken),
      ).toMatchObject({ ok: true })
      expect(context.service.authenticate(rotated.value.sessionToken, 'z'.repeat(43))).toEqual({
        ok: false,
        error: { code: 'csrf-invalid', message: 'Request verification failed.' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('uses one transition timestamp for rotation under an advancing clock', async () => {
    const context = await serviceFixture({ advancingClock: true })
    const database = createPersistence(context.path)
    const artifacts = new ArtifactStore(join(context.path, '..', 'artifacts'))
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const first = await context.service.login({ password: PASSWORD })
      if (!first.ok) throw new TypeError('login fixture failed')
      const rotated = context.service.rotate(first.value.sessionToken, first.value.csrfToken)
      expect(rotated).toMatchObject({ ok: true })

      const relationDatabase = new DatabaseSync(context.path)
      const relation = relationDatabase
        .prepare(`SELECT predecessor.revoked_at AS predecessor_revoked_at,
          replacement.created_at AS replacement_created_at
          FROM administrator_sessions replacement
          JOIN administrator_sessions predecessor ON predecessor.id=replacement.rotated_from_id`)
        .get()
      relationDatabase.close()
      expect(relation).toMatchObject({
        predecessor_revoked_at: expect.any(String),
        replacement_created_at: expect.any(String),
      })
      expect((relation as Record<string, unknown>).predecessor_revoked_at).toBe(
        (relation as Record<string, unknown>).replacement_created_at,
      )
      await expect(database.validateStoredRecords(artifacts)).resolves.toEqual({
        ok: true,
        value: true,
      })
      await expect(
        backupPersistence({
          database,
          artifacts,
          destination: join(context.path, '..', 'backup'),
          createdAt: '2026-07-16T13:00:00.000Z',
        }),
      ).resolves.toMatchObject({ ok: true })
    } finally {
      database.close()
      context.repository.close()
    }
  })

  it('enforces expiry and logout without disclosing session state', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const login = await context.service.login({ password: PASSWORD })
      if (!login.ok) throw new TypeError('login fixture failed')
      expect(context.service.logout(login.value.sessionToken)).toEqual({ ok: true, value: true })
      expect(context.service.logout(login.value.sessionToken)).toEqual({ ok: true, value: true })
      expect(context.service.authenticate(login.value.sessionToken)).toMatchObject({
        ok: false,
        error: { code: 'session-invalid' },
      })

      const replacement = await context.service.login({ password: PASSWORD })
      if (!replacement.ok) throw new TypeError('login fixture failed')
      context.advance(3_600_001)
      expect(context.service.authenticate(replacement.value.sessionToken)).toMatchObject({
        ok: false,
        error: { code: 'session-invalid' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('refreshes idle activity and rejects the exact idle boundary without extending absolute TTL', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const active = await context.service.login({ password: PASSWORD })
      if (!active.ok) throw new TypeError('login fixture failed')
      context.advance(899_999)
      expect(context.service.authenticate(active.value.sessionToken)).toMatchObject({ ok: true })
      context.advance(899_999)
      expect(context.service.authenticate(active.value.sessionToken)).toMatchObject({ ok: true })
      context.advance(900_000)
      expect(context.service.authenticate(active.value.sessionToken)).toMatchObject({
        ok: false,
        error: { code: 'session-invalid' },
      })

      const absolute = await context.service.login({ password: PASSWORD })
      if (!absolute.ok) throw new TypeError('login fixture failed')
      for (let elapsed = 0; elapsed < 3_600_000; elapsed += 899_999) {
        context.advance(899_999)
        context.service.authenticate(absolute.value.sessionToken)
      }
      expect(context.service.authenticate(absolute.value.sessionToken)).toMatchObject({
        ok: false,
        error: { code: 'session-invalid' },
      })
    } finally {
      context.repository.close()
    }
  })

  it('atomically enforces the active-session cap while ignoring revoked and expired sessions', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const [first, second] = await Promise.all([
        context.service.login({ password: PASSWORD }),
        context.service.login({ password: PASSWORD }),
      ])
      expect(first).toMatchObject({ ok: true })
      expect(second).toMatchObject({ ok: true })
      await expect(context.service.login({ password: PASSWORD })).resolves.toMatchObject({
        ok: false,
      })
      if (!first.ok) throw new TypeError('login fixture failed')
      expect(context.service.logout(first.value.sessionToken)).toMatchObject({ ok: true })
      await expect(context.service.login({ password: PASSWORD })).resolves.toMatchObject({
        ok: true,
      })

      context.advance(3_600_001)
      await expect(context.service.login({ password: PASSWORD })).resolves.toMatchObject({
        ok: true,
      })
    } finally {
      context.repository.close()
    }
  })

  it('revokes every session when the administrator credential changes', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const first = await context.service.login({ password: PASSWORD })
      const second = await context.service.login({ password: PASSWORD })
      if (!first.ok || !second.ok) throw new TypeError('login fixture failed')
      expect(
        await context.service.changePassword({
          currentPassword: PASSWORD,
          newPassword: 'replacement teacher password',
        }),
      ).toMatchObject({ ok: true })
      expect(context.service.authenticate(first.value.sessionToken)).toMatchObject({ ok: false })
      expect(context.service.authenticate(second.value.sessionToken)).toMatchObject({ ok: false })
      expect(await context.service.login({ password: PASSWORD })).toMatchObject({ ok: false })
      expect(
        await context.service.login({ password: 'replacement teacher password' }),
      ).toMatchObject({
        ok: true,
      })
    } finally {
      context.repository.close()
    }
  })

  it('supports an authenticated revoke-all action', async () => {
    const context = await serviceFixture()
    try {
      await context.service.bootstrap({ bootstrapSecret: BOOTSTRAP_SECRET, newPassword: PASSWORD })
      const first = await context.service.login({ password: PASSWORD })
      const second = await context.service.login({ password: PASSWORD })
      if (!first.ok || !second.ok) throw new TypeError('login fixture failed')
      expect(
        context.service.revokeAllSessions(first.value.sessionToken, first.value.csrfToken),
      ).toEqual({ ok: true, value: { revoked: 2 } })
      expect(context.service.authenticate(first.value.sessionToken)).toMatchObject({ ok: false })
      expect(context.service.authenticate(second.value.sessionToken)).toMatchObject({ ok: false })
    } finally {
      context.repository.close()
    }
  })
})
