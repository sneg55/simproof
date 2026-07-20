import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  type AdministratorRecord,
  type AdministratorSessionRecord,
  decodeAdministrator,
  type PasswordCredential,
  type SessionInput,
  validAdministratorRecord,
  validCredential,
  validTimestamp,
} from './auth-records.js'
import { AuthSessionStore, type SessionPolicy } from './auth-session-store.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'

export type { AdministratorRecord, AdministratorSessionRecord, PasswordCredential, SessionPolicy }

export class AuthRepository {
  readonly #database: DatabaseSync
  readonly #sessions: AuthSessionStore

  constructor(path: string) {
    this.#database = new DatabaseSync(resolve(path), {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: 2_000,
    })
    this.#database.enableDefensive(true)
    this.#sessions = new AuthSessionStore(this.#database)
  }

  bootstrap(input: {
    readonly credential: PasswordCredential
    readonly completedAt: string
  }): Result<AdministratorRecord> {
    if (!validCredential(input.credential) || !validTimestamp(input.completedAt)) {
      return err(INVALID_INPUT, 'Administrator bootstrap input is invalid.')
    }
    return transaction(this.#database, () => {
      const completed = this.#database.prepare('SELECT 1 FROM auth_bootstrap').get()
      if (completed !== undefined) return err('conflict', 'Administrator bootstrap is unavailable.')
      this.#database
        .prepare('INSERT INTO auth_bootstrap(singleton,completed_at) VALUES (1,?)')
        .run(input.completedAt)
      this.#database
        .prepare(`INSERT INTO local_administrator(
          singleton,password_hash,password_salt,password_hash_version,scrypt_cost,scrypt_block_size,
          scrypt_parallelization,scrypt_key_length,credential_version,created_at,updated_at
        ) VALUES (1,?,?,?,?,?,?,?,1,?,?)`)
        .run(
          input.credential.passwordHash,
          input.credential.passwordSalt,
          input.credential.passwordHashVersion,
          input.credential.scryptCost,
          input.credential.scryptBlockSize,
          input.credential.scryptParallelization,
          input.credential.scryptKeyLength,
          input.completedAt,
          input.completedAt,
        )
      return ok({
        ...input.credential,
        credentialVersion: 1,
        createdAt: input.completedAt,
        updatedAt: input.completedAt,
      })
    })
  }

  administrator(): Result<AdministratorRecord> {
    try {
      const row = this.#database
        .prepare('SELECT * FROM local_administrator WHERE singleton=1')
        .get()
      if (row === undefined) return err('not-found', 'Local administrator is not configured.')
      const administrator = decodeAdministrator(row)
      return validAdministratorRecord(administrator)
        ? ok(administrator)
        : err('database-error', 'Stored administrator credential is invalid.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  rotateCredential(input: {
    readonly expectedVersion: number
    readonly credential: PasswordCredential
    readonly updatedAt: string
  }): Result<{ readonly credentialVersion: number; readonly revokedSessions: number }> {
    if (
      !validCredential(input.credential) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      !validTimestamp(input.updatedAt)
    ) {
      return err(INVALID_INPUT, 'Administrator credential rotation input is invalid.')
    }
    return transaction(this.#database, () => {
      const changed = this.#database
        .prepare(`UPDATE local_administrator SET
          password_hash=?,password_salt=?,password_hash_version=?,scrypt_cost=?,scrypt_block_size=?,
          scrypt_parallelization=?,scrypt_key_length=?,credential_version=credential_version+1,
          updated_at=? WHERE singleton=1 AND credential_version=?`)
        .run(
          input.credential.passwordHash,
          input.credential.passwordSalt,
          input.credential.passwordHashVersion,
          input.credential.scryptCost,
          input.credential.scryptBlockSize,
          input.credential.scryptParallelization,
          input.credential.scryptKeyLength,
          input.updatedAt,
          input.expectedVersion,
        )
      if (Number(changed.changes) !== 1) {
        return err('conflict', 'Administrator credential changed concurrently.')
      }
      const revoked = this.#database
        .prepare('UPDATE administrator_sessions SET revoked_at=? WHERE revoked_at IS NULL')
        .run(input.updatedAt)
      return ok({
        credentialVersion: input.expectedVersion + 1,
        revokedSessions: Number(revoked.changes),
      })
    })
  }

  createSession(
    input: SessionInput,
    options: SessionPolicy & { readonly revokeTokenHash?: string },
  ): Result<AdministratorSessionRecord> {
    return this.#sessions.create(input, options)
  }

  rotateSession(input: {
    readonly currentTokenHash: string
    readonly replacement: SessionInput
    readonly rotatedAt: string
    readonly idleSeconds: number
    readonly maxActiveSessions: number
  }): Result<AdministratorSessionRecord> {
    return this.#sessions.rotate(input)
  }

  touchSession(input: {
    readonly tokenHash: string
    readonly activeAt: string
    readonly idleSeconds: number
  }): Result<AdministratorSessionRecord> {
    return this.#sessions.touch(input)
  }

  findSession(tokenHash: string): Result<AdministratorSessionRecord> {
    return this.#sessions.find(tokenHash)
  }

  revokeSession(tokenHash: string, revokedAt: string): Result<boolean> {
    return this.#sessions.revoke(tokenHash, revokedAt)
  }

  revokeAllSessions(revokedAt: string): Result<number> {
    return this.#sessions.revokeAll(revokedAt)
  }

  close(): void {
    this.#database.close()
  }
}
