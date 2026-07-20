import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { type MigrationInspection, MigrationRunner } from './migration-runner.js'
import { err, type Result } from './types.js'

const DATABASE_ERROR = 'database-error'
const UNAVAILABLE = 'Persistence database is unavailable.'

export type PersistenceInspection = MigrationInspection

export function inspectPersistence(path: string): Result<PersistenceInspection> {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(resolve(path), {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      readOnly: true,
      timeout: 2_000,
    })
    database.enableDefensive(true)
    const inspected = new MigrationRunner(database, () => false).inspect()
    return inspected.ok ? inspected : err(DATABASE_ERROR, UNAVAILABLE)
  } catch {
    return err(DATABASE_ERROR, UNAVAILABLE)
  } finally {
    try {
      database?.close()
    } catch {
      // Inspection never replaces its bounded result with raw close errors.
    }
  }
}
