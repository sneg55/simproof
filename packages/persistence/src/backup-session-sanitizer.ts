import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { sqliteFailure } from './sqlite.js'
import { err, ok, type Result } from './types.js'

export function removeSessionsFromBackupSnapshot(path: string): Result<number> {
  const database = new DatabaseSync(resolve(path), {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 2_000,
  })
  try {
    database.enableDefensive(true)
    const deleted = database.prepare('DELETE FROM administrator_sessions').run()
    return ok(Number(deleted.changes))
  } catch (error) {
    return sqliteFailure(error)
  } finally {
    database.close()
  }
}

export function validateBackupSessionAbsence(path: string): Result<true> {
  const database = new DatabaseSync(resolve(path), {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 2_000,
  })
  try {
    database.enableDefensive(true)
    const row = database.prepare('SELECT COUNT(*) AS count FROM administrator_sessions').get() as {
      count: number
    }
    return Number(row.count) === 0
      ? ok(true)
      : err('invalid-backup', 'Backup contains administrator session records.')
  } catch (error) {
    return sqliteFailure(error)
  } finally {
    database.close()
  }
}
