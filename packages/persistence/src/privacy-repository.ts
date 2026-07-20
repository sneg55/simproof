import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_PROMPT_BYTES = 65_536

export interface PrivacySettings {
  readonly promptRetentionEnabled: boolean
  readonly externalDiagnosticsEnabled: boolean
  readonly revision: number
  readonly updatedAt: string
}

export interface RetainedPrompt {
  readonly id: string
  readonly simulationId: string
  readonly prompt: string
  readonly createdAt: string
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function decodeSettings(row: Record<string, unknown>): PrivacySettings {
  return {
    promptRetentionEnabled: row.prompt_retention_enabled === 1,
    externalDiagnosticsEnabled: row.external_diagnostics_enabled === 1,
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  }
}

function decodePrompt(row: Record<string, unknown>): RetainedPrompt {
  return {
    id: String(row.id),
    simulationId: String(row.simulation_id),
    prompt: String(row.prompt_text),
    createdAt: String(row.created_at),
  }
}

export class PrivacyRepository {
  readonly #database: DatabaseSync

  constructor(path: string) {
    this.#database = new DatabaseSync(resolve(path), {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: 2_000,
    })
    this.#database.enableDefensive(true)
  }

  settings(): Result<PrivacySettings> {
    try {
      const row = this.#database.prepare('SELECT * FROM privacy_settings WHERE singleton=1').get()
      return row === undefined
        ? err('database-error', 'Privacy settings are unavailable.')
        : ok(decodeSettings(row as Record<string, unknown>))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  updateSettings(input: {
    readonly expectedRevision: number
    readonly promptRetentionEnabled: boolean
    readonly externalDiagnosticsEnabled: boolean
    readonly updatedAt: string
  }): Result<PrivacySettings> {
    if (!Number.isSafeInteger(input.expectedRevision) || !validTimestamp(input.updatedAt)) {
      return err('invalid-input', 'Privacy settings input is invalid.')
    }
    try {
      const changed = this.#database
        .prepare(`UPDATE privacy_settings SET
          prompt_retention_enabled=?,external_diagnostics_enabled=?,revision=revision+1,updated_at=?
          WHERE singleton=1 AND revision=?`)
        .run(
          Number(input.promptRetentionEnabled),
          Number(input.externalDiagnosticsEnabled),
          input.updatedAt,
          input.expectedRevision,
        )
      if (Number(changed.changes) !== 1) {
        return err('conflict', 'Privacy settings changed concurrently.')
      }
      return ok({
        promptRetentionEnabled: input.promptRetentionEnabled,
        externalDiagnosticsEnabled: input.externalDiagnosticsEnabled,
        revision: input.expectedRevision + 1,
        updatedAt: input.updatedAt,
      })
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  storePrompt(input: RetainedPrompt): Result<RetainedPrompt> {
    if (
      !ID_PATTERN.test(input.id) ||
      !ID_PATTERN.test(input.simulationId) ||
      !validTimestamp(input.createdAt) ||
      Buffer.byteLength(input.prompt, 'utf8') < 1 ||
      Buffer.byteLength(input.prompt, 'utf8') > MAX_PROMPT_BYTES
    ) {
      return err('invalid-input', 'Retained prompt input is invalid.')
    }
    return transaction(this.#database, () => {
      const settings = this.#database
        .prepare('SELECT prompt_retention_enabled FROM privacy_settings WHERE singleton=1')
        .get() as { prompt_retention_enabled: number } | undefined
      if (settings?.prompt_retention_enabled !== 1) {
        return err('invalid-state', 'Prompt retention is disabled.')
      }
      const existing = this.#database
        .prepare('SELECT * FROM retained_prompts WHERE id=?')
        .get(input.id) as Record<string, unknown> | undefined
      if (existing !== undefined) {
        const retained = decodePrompt(existing)
        return retained.simulationId === input.simulationId && retained.prompt === input.prompt
          ? ok(retained)
          : err('conflict', 'Retained prompt identity belongs to different content.')
      }
      this.#database
        .prepare(
          'INSERT INTO retained_prompts(id,simulation_id,prompt_text,created_at) VALUES (?,?,?,?)',
        )
        .run(input.id, input.simulationId, input.prompt, input.createdAt)
      return ok(input)
    })
  }

  listPrompts(simulationId: string): Result<readonly RetainedPrompt[]> {
    if (!ID_PATTERN.test(simulationId)) {
      return err('invalid-input', 'Simulation identity is invalid.')
    }
    try {
      const rows = this.#database
        .prepare(
          'SELECT * FROM retained_prompts WHERE simulation_id=? ORDER BY created_at ASC,id ASC',
        )
        .all(simulationId) as Record<string, unknown>[]
      return ok(rows.map(decodePrompt))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  exportPrompts(): Result<readonly RetainedPrompt[]> {
    try {
      const rows = this.#database
        .prepare('SELECT * FROM retained_prompts ORDER BY created_at ASC,id ASC')
        .all() as Record<string, unknown>[]
      return ok(rows.map(decodePrompt))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  deletePrompts(simulationId: string): Result<number> {
    if (!ID_PATTERN.test(simulationId)) {
      return err('invalid-input', 'Simulation identity is invalid.')
    }
    try {
      const deleted = this.#database
        .prepare('DELETE FROM retained_prompts WHERE simulation_id=?')
        .run(simulationId)
      return ok(Number(deleted.changes))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  close(): void {
    this.#database.close()
  }
}
