import type { DatabaseSync } from 'node:sqlite'

import { err, type Result } from './types.js'

function sqliteMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'SQLite operation failed.'
}

export function sqliteFailure(error: unknown): Result<never> {
  const message = sqliteMessage(error)
  if (/UNIQUE|PRIMARY KEY|SQLITE_CONSTRAINT/iu.test(message)) {
    return err('conflict', 'A persistence record with the same identity already exists.')
  }
  if (/FOREIGN KEY/iu.test(message)) {
    return err('conflict', 'A referenced persistence record is missing or still in use.')
  }
  if (/immutable/iu.test(message)) {
    return err('immutable-record', 'Historical persistence records are immutable.')
  }
  return err('database-error', 'Persistence database operation failed.')
}

export function transaction<T>(database: DatabaseSync, operation: () => Result<T>): Result<T> {
  try {
    database.exec('BEGIN IMMEDIATE')
    const result = operation()
    if (!result.ok) {
      database.exec('ROLLBACK')
      return result
    }
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may already have been rolled back by SQLite.
    }
    return sqliteFailure(error)
  }
}

export function asCount(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}
