import { backup, DatabaseSync } from 'node:sqlite'

import { withMaintenanceLock } from './maintenance-lock.js'
import { sqliteFailure } from './sqlite.js'
import type { Result } from './types.js'

export class DatabaseMaintenance {
  constructor(
    readonly database: DatabaseSync,
    readonly path: string,
  ) {}

  async snapshot(destination: string): Promise<void> {
    await backup(this.database, destination)
  }

  async transaction<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    return await withMaintenanceLock(this.path, async () => {
      try {
        this.database.exec('BEGIN IMMEDIATE')
        const result = await operation()
        this.database.exec(result.ok ? 'COMMIT' : 'ROLLBACK')
        return result
      } catch (error) {
        this.#rollback(this.database)
        return sqliteFailure(error)
      }
    })
  }

  async backupLock<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    return await withMaintenanceLock(this.path, async () => {
      const coordinator = new DatabaseSync(this.path, {
        allowExtension: false,
        enableForeignKeyConstraints: true,
        timeout: 2_000,
      })
      coordinator.enableDefensive(true)
      try {
        coordinator.exec('BEGIN IMMEDIATE')
        const result = await operation()
        coordinator.exec('ROLLBACK')
        return result
      } catch (error) {
        this.#rollback(coordinator)
        return sqliteFailure(error)
      } finally {
        coordinator.close()
      }
    })
  }

  async phased<T, U>(
    metadata: () => Result<T> | Promise<Result<T>>,
    cleanup: (value: T) => Promise<Result<U>>,
  ): Promise<Result<U>> {
    return await withMaintenanceLock(this.path, async () => {
      try {
        this.database.exec('BEGIN IMMEDIATE')
        const first = await metadata()
        this.database.exec(first.ok ? 'COMMIT' : 'ROLLBACK')
        if (!first.ok) return first
        this.database.exec('BEGIN IMMEDIATE')
        const second = await cleanup(first.value)
        this.database.exec('ROLLBACK')
        return second
      } catch (error) {
        this.#rollback(this.database)
        return sqliteFailure(error)
      }
    })
  }

  #rollback(database: DatabaseSync): void {
    try {
      database.exec('ROLLBACK')
    } catch {
      // SQLite may already have rolled the transaction back.
    }
  }
}
