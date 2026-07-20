import type { DatabaseSync } from 'node:sqlite'

import {
  ensureMigrationJournal,
  MIGRATIONS,
  type Migration,
  migrationChecksum,
} from './migrations.js'
import { sqliteFailure } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const APPLICATION_ID = 1_397_772_870

export interface MigrationInspection {
  readonly status: 'current' | 'migration-invalid'
  readonly expectedVersions: readonly number[]
  readonly appliedVersions: readonly number[]
  readonly checksumsValid: boolean
}

export type MigrationReadiness =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'migration' | 'unavailable' }

export class MigrationRunner {
  constructor(
    readonly database: DatabaseSync,
    readonly canWrite: () => boolean,
    readonly migrations: readonly Migration[] = MIGRATIONS,
  ) {}

  migrate(): Result<{ readonly applied: readonly number[] }> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    try {
      this.database.exec('BEGIN EXCLUSIVE')
      const result = this.#applyCurrentSchema()
      this.database.exec(result.ok ? 'COMMIT' : 'ROLLBACK')
      return result
    } catch (error) {
      this.#rollback()
      return sqliteFailure(error)
    }
  }

  #applyCurrentSchema(): Result<{ readonly applied: readonly number[] }> {
    try {
      ensureMigrationJournal(this.database)
      const rows = this.database
        .prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
        .all() as unknown as Array<{ version: number; name: string; checksum: string }>
      for (const row of rows) {
        const shipped = this.migrations.find(({ version }) => version === row.version)
        if (
          shipped === undefined ||
          shipped.name !== row.name ||
          migrationChecksum(shipped) !== row.checksum
        ) {
          return err('database-error', `Applied migration ${row.version} checksum is invalid.`)
        }
      }
      const existing = new Set(rows.map(({ version }) => version))
      const applied: number[] = []
      for (const migration of this.migrations) {
        if (existing.has(migration.version)) continue
        this.database.exec(migration.sql)
        this.database
          .prepare(
            'INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)',
          )
          .run(
            migration.version,
            migration.name,
            migrationChecksum(migration),
            new Date().toISOString(),
          )
        applied.push(migration.version)
      }
      const integrity = this.integrity()
      return integrity.ok ? ok({ applied }) : integrity
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  validateCurrent(): Result<true> {
    const inspection = this.inspect()
    if (!inspection.ok) return inspection
    return inspection.value.status === 'current'
      ? ok(true)
      : err('database-error', 'Migration state is not the exact current schema.')
  }

  inspect(): Result<MigrationInspection> {
    const identity = this.#inspectIdentity()
    if (!identity.ok) return identity
    const integrity = this.#integrityValid()
    if (!integrity.ok) return integrity
    return ok({
      ...identity.value,
      status:
        identity.value.status === 'current' && integrity.value ? 'current' : 'migration-invalid',
    })
  }

  readiness(): MigrationReadiness {
    try {
      if (!this.foreignKeysEnabled()) return { ok: false, reason: 'unavailable' }
      const identity = this.#inspectIdentity()
      if (!identity.ok) return { ok: false, reason: 'unavailable' }
      return identity.value.status === 'current' ? { ok: true } : { ok: false, reason: 'migration' }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }

  #inspectIdentity(): Result<MigrationInspection> {
    try {
      const expectedVersions = Object.freeze(this.migrations.map(({ version }) => version))
      const journalExists = this.database
        .prepare(
          "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='schema_migrations'",
        )
        .get() as { present: number } | undefined
      const rows =
        journalExists === undefined
          ? []
          : (this.database
              .prepare(
                'SELECT version,name,checksum FROM schema_migrations ORDER BY version LIMIT ?',
              )
              .all(this.migrations.length + 1) as unknown as Array<{
              version: number
              name: string
              checksum: string
            }>)
      const checksumsValid = rows.every((row) => {
        const shipped = this.migrations.find(({ version }) => version === row.version)
        return (
          shipped !== undefined &&
          row.name === shipped.name &&
          row.checksum === migrationChecksum(shipped)
        )
      })
      const exactJournal = checksumsValid && rows.length === this.migrations.length
      const application = this.database.prepare('PRAGMA application_id').get() as {
        application_id: number
      }
      const userVersion = this.database.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      const expectedUserVersion = Math.max(...this.migrations.map(({ version }) => version))
      const identityValid =
        application.application_id === APPLICATION_ID &&
        userVersion.user_version === expectedUserVersion
      return ok({
        status: exactJournal && identityValid ? 'current' : 'migration-invalid',
        expectedVersions,
        appliedVersions: Object.freeze(rows.map(({ version }) => version)),
        checksumsValid,
      })
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  applied(): Result<readonly number[]> {
    try {
      const rows = this.database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as unknown as Array<{ version: number }>
      return ok(rows.map(({ version }) => version))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  foreignKeysEnabled(): boolean {
    const row = this.database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    return row.foreign_keys === 1
  }

  integrity(): Result<true> {
    const integrity = this.#integrityValid()
    if (!integrity.ok) return integrity
    return integrity.value ? ok(true) : err('database-error', 'SQLite integrity validation failed.')
  }

  #integrityValid(): Result<boolean> {
    try {
      const integrity = this.database.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string
      }
      const foreign = this.database.prepare('PRAGMA foreign_key_check').all()
      return ok(integrity.integrity_check === 'ok' && foreign.length === 0)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  #rollback(): void {
    try {
      this.database.exec('ROLLBACK')
    } catch {
      // SQLite may have already rolled the transaction back.
    }
  }
}
