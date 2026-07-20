import type { DatabaseSync } from 'node:sqlite'

import {
  type AdministratorSessionRecord,
  decodeSession,
  type SessionInput,
  validHash,
  validSession,
  validSessionRecord,
  validTimestamp,
} from './auth-records.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'
const MAX_SESSION_ROWS = 256

export interface SessionPolicy {
  readonly idleSeconds: number
  readonly maxActiveSessions: number
}

export class AuthSessionStore {
  constructor(private readonly database: DatabaseSync) {}

  create(
    input: SessionInput,
    options: SessionPolicy & { readonly revokeTokenHash?: string },
  ): Result<AdministratorSessionRecord> {
    if (
      !validSession(input) ||
      !validSessionPolicy(options) ||
      (options.revokeTokenHash !== undefined && !validHash(options.revokeTokenHash))
    ) {
      return err(INVALID_INPUT, 'Administrator session input is invalid.')
    }
    return transaction(this.database, () => {
      if (!this.#credentialVersionMatches(input.credentialVersion)) {
        return err('conflict', 'Administrator credential changed concurrently.')
      }
      if (options.revokeTokenHash !== undefined) {
        this.database
          .prepare(
            'UPDATE administrator_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL',
          )
          .run(input.createdAt, options.revokeTokenHash)
      }
      this.#cleanupInactive(input.createdAt, options.idleSeconds)
      if (this.#activeCount() >= options.maxActiveSessions) {
        return err('conflict', 'The active administrator session limit was reached.')
      }
      this.#insert(input)
      this.#pruneInactive()
      return ok({ ...input, lastActivityAt: input.createdAt, revokedAt: null })
    })
  }

  rotate(input: {
    readonly currentTokenHash: string
    readonly replacement: SessionInput
    readonly rotatedAt: string
    readonly idleSeconds: number
    readonly maxActiveSessions: number
  }): Result<AdministratorSessionRecord> {
    if (
      !validHash(input.currentTokenHash) ||
      !validSession(input.replacement) ||
      !validTimestamp(input.rotatedAt) ||
      !validSessionPolicy(input)
    ) {
      return err(INVALID_INPUT, 'Administrator session rotation input is invalid.')
    }
    return transaction(this.database, () => {
      const current = this.find(input.currentTokenHash)
      if (
        !current.ok ||
        current.value.revokedAt !== null ||
        current.value.expiresAt <= input.rotatedAt ||
        current.value.lastActivityAt <= idleCutoff(input.rotatedAt, input.idleSeconds) ||
        input.replacement.rotatedFromId !== current.value.id ||
        input.replacement.credentialVersion !== current.value.credentialVersion ||
        !this.#credentialVersionMatches(current.value.credentialVersion)
      ) {
        return err('conflict', 'Administrator session cannot be rotated.')
      }
      this.database
        .prepare('UPDATE administrator_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL')
        .run(input.rotatedAt, current.value.id)
      this.#cleanupInactive(input.rotatedAt, input.idleSeconds)
      if (this.#activeCount() >= input.maxActiveSessions) {
        return err('conflict', 'The active administrator session limit was reached.')
      }
      this.#insert(input.replacement)
      this.#pruneInactive()
      return this.find(input.replacement.tokenHash)
    })
  }

  touch(input: {
    readonly tokenHash: string
    readonly activeAt: string
    readonly idleSeconds: number
  }): Result<AdministratorSessionRecord> {
    if (
      !validHash(input.tokenHash) ||
      !validTimestamp(input.activeAt) ||
      !validIdleSeconds(input.idleSeconds)
    ) {
      return err(INVALID_INPUT, 'Administrator session activity input is invalid.')
    }
    const recent = this.#recentActiveSession(input)
    if (!recent.ok) return recent
    if (recent.value !== null) return ok(recent.value)
    const touched = transaction(this.database, () => {
      this.#cleanupInactive(input.activeAt, input.idleSeconds)
      this.#pruneInactive()
      const current = this.find(input.tokenHash)
      if (
        !current.ok ||
        current.value.revokedAt !== null ||
        !this.#credentialVersionMatches(current.value.credentialVersion)
      ) {
        return ok<AdministratorSessionRecord | null>(null)
      }
      if (current.value.lastActivityAt > refreshCutoff(input.activeAt, input.idleSeconds)) {
        return ok<AdministratorSessionRecord | null>(current.value)
      }
      const changed = this.database
        .prepare(`UPDATE administrator_sessions SET last_activity_at=?
          WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?
          AND last_activity_at>? AND credential_version=(
            SELECT credential_version FROM local_administrator WHERE singleton=1
          )`)
        .run(
          input.activeAt,
          input.tokenHash,
          input.activeAt,
          idleCutoff(input.activeAt, input.idleSeconds),
        )
      return Number(changed.changes) === 1
        ? this.find(input.tokenHash)
        : ok<AdministratorSessionRecord | null>(null)
    })
    if (!touched.ok) return touched
    return touched.value === null
      ? err('not-found', 'An active administrator session was not found.')
      : ok(touched.value)
  }

  #recentActiveSession(input: {
    readonly tokenHash: string
    readonly activeAt: string
    readonly idleSeconds: number
  }): Result<AdministratorSessionRecord | null> {
    try {
      const row = this.database
        .prepare(`SELECT s.* FROM administrator_sessions s
          JOIN local_administrator a ON a.singleton=s.administrator_id
          AND a.credential_version=s.credential_version
          WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
          AND s.last_activity_at>? AND s.last_activity_at>?`)
        .get(
          input.tokenHash,
          input.activeAt,
          idleCutoff(input.activeAt, input.idleSeconds),
          refreshCutoff(input.activeAt, input.idleSeconds),
        )
      if (row === undefined) return ok(null)
      const session = decodeSession(row)
      return validSessionRecord(session)
        ? ok(session)
        : err('database-error', 'Stored administrator session is invalid.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  find(tokenHash: string): Result<AdministratorSessionRecord> {
    if (!validHash(tokenHash)) return err(INVALID_INPUT, 'Session identity is invalid.')
    try {
      const row = this.database
        .prepare('SELECT * FROM administrator_sessions WHERE token_hash=?')
        .get(tokenHash)
      if (row === undefined) return err('not-found', 'Administrator session was not found.')
      const session = decodeSession(row)
      return validSessionRecord(session)
        ? ok(session)
        : err('database-error', 'Stored administrator session is invalid.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  revoke(tokenHash: string, revokedAt: string): Result<boolean> {
    if (!validHash(tokenHash) || !validTimestamp(revokedAt)) {
      return err(INVALID_INPUT, 'Session revocation input is invalid.')
    }
    return transaction(this.database, () => {
      const changed = this.database
        .prepare(
          'UPDATE administrator_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL',
        )
        .run(revokedAt, tokenHash)
      this.#pruneInactive()
      return ok(Number(changed.changes) === 1)
    })
  }

  revokeAll(revokedAt: string): Result<number> {
    if (!validTimestamp(revokedAt)) {
      return err(INVALID_INPUT, 'Session revocation input is invalid.')
    }
    return transaction(this.database, () => {
      const changed = this.database
        .prepare('UPDATE administrator_sessions SET revoked_at=? WHERE revoked_at IS NULL')
        .run(revokedAt)
      this.#pruneInactive()
      return ok(Number(changed.changes))
    })
  }

  #credentialVersionMatches(version: number): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM local_administrator WHERE singleton=1 AND credential_version=?')
        .get(version) !== undefined
    )
  }

  #insert(input: SessionInput): void {
    this.database
      .prepare(`INSERT INTO administrator_sessions(
        id,administrator_id,token_hash,csrf_hash,credential_version,created_at,last_activity_at,
        expires_at,rotated_from_id,revoked_at
      ) VALUES (?,1,?,?,?,?,?,?,?,NULL)`)
      .run(
        input.id,
        input.tokenHash,
        input.csrfHash,
        input.credentialVersion,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
        input.rotatedFromId,
      )
  }

  #cleanupInactive(activeAt: string, idleSeconds: number): void {
    this.database
      .prepare(`UPDATE administrator_sessions SET revoked_at=? WHERE revoked_at IS NULL
        AND (expires_at<=? OR last_activity_at<=? OR credential_version<>(
          SELECT credential_version FROM local_administrator WHERE singleton=1
        ))`)
      .run(activeAt, activeAt, idleCutoff(activeAt, idleSeconds))
  }

  #activeCount(): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM administrator_sessions WHERE revoked_at IS NULL')
      .get() as { count: number }
    return Number(row.count)
  }

  #pruneInactive(): void {
    const total = this.database
      .prepare('SELECT COUNT(*) AS count FROM administrator_sessions')
      .get() as { count: number }
    const excess = Number(total.count) - MAX_SESSION_ROWS
    if (excess <= 0) return
    const rows = this.database
      .prepare(`SELECT id FROM administrator_sessions WHERE revoked_at IS NOT NULL
        ORDER BY revoked_at ASC,created_at ASC,id ASC LIMIT ?`)
      .all(excess) as Array<{ id: string }>
    for (const row of rows) {
      this.database
        .prepare('UPDATE administrator_sessions SET rotated_from_id=NULL WHERE rotated_from_id=?')
        .run(row.id)
      this.database
        .prepare('DELETE FROM administrator_sessions WHERE id=? AND revoked_at IS NOT NULL')
        .run(row.id)
    }
  }
}

function validIdleSeconds(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 604_800
}

function validSessionPolicy(value: SessionPolicy): boolean {
  return (
    validIdleSeconds(value.idleSeconds) &&
    Number.isSafeInteger(value.maxActiveSessions) &&
    value.maxActiveSessions >= 1 &&
    value.maxActiveSessions <= 128
  )
}

function idleCutoff(activeAt: string, idleSeconds: number): string {
  return new Date(Date.parse(activeAt) - idleSeconds * 1_000).toISOString()
}

function refreshCutoff(activeAt: string, idleSeconds: number): string {
  const refreshSeconds = Math.min(60, Math.max(1, Math.floor(idleSeconds / 4)))
  return new Date(Date.parse(activeAt) - refreshSeconds * 1_000).toISOString()
}
