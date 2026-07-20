import { rm } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'

import type { Sha256 } from '@simproof/contracts'

import type { ArtifactStore } from './artifact-store.js'
import { sqliteFailure } from './sqlite.js'
import { ok, type Result } from './types.js'

interface CleanupOptions {
  readonly dryRun?: boolean
  readonly minimumAgeMs?: number
}

export interface ArtifactCleanupResult {
  readonly orphanedArtifacts: readonly Sha256[]
  readonly deletedArtifacts: readonly Sha256[]
  readonly skippedArtifacts: readonly Sha256[]
  readonly deferredArtifacts: readonly Sha256[]
  readonly temporaryFiles: {
    readonly found: number
    readonly deleted: number
    readonly skipped: number
    readonly deferred: number
  }
}

export async function collectTemporaryFiles(
  files: readonly { path: string; mtimeMs: number }[],
  minimumAgeMs: number,
  nowMs: number,
): Promise<ArtifactCleanupResult['temporaryFiles']> {
  const result = { found: files.length, deleted: 0, skipped: 0, deferred: 0 }
  for (const temporary of files) {
    if (nowMs - temporary.mtimeMs < minimumAgeMs) {
      result.skipped += 1
      continue
    }
    try {
      await rm(temporary.path)
      result.deleted += 1
    } catch {
      result.deferred += 1
    }
  }
  return result
}

export class ArtifactCleanup {
  constructor(
    readonly database: DatabaseSync,
    readonly exclusive: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>,
    readonly phased: <T, U>(
      metadata: () => Result<T> | Promise<Result<T>>,
      cleanup: (value: T) => Promise<Result<U>>,
    ) => Promise<Result<U>>,
  ) {}

  async auditAndCollect(
    store: ArtifactStore,
    options: CleanupOptions = {},
  ): Promise<Result<ArtifactCleanupResult>> {
    if (options.dryRun ?? true) {
      return await this.exclusive(async () => {
        const inspected = await this.#inspect(store)
        if (!inspected.ok) return inspected
        const { references: _references, ...report } = inspected.value
        return ok(report)
      })
    }
    return await this.phased(
      async () => {
        const inspected = await this.#inspect(store)
        if (!inspected.ok) return inspected
        for (const { id } of this.#unreferencedRows()) {
          this.database.prepare('DELETE FROM stored_artifacts WHERE id=?').run(id)
        }
        return ok(true)
      },
      async () => {
        const protectedHashes = this.#protectedHashes()
        if (!protectedHashes.ok) return protectedHashes
        return await store.auditAndCollect(
          protectedHashes.value,
          options.minimumAgeMs === undefined
            ? { dryRun: false }
            : { dryRun: false, minimumAgeMs: options.minimumAgeMs },
        )
      },
    )
  }

  async #inspect(
    store: ArtifactStore,
  ): Promise<Result<{ readonly references: readonly Sha256[] } & ArtifactCleanupResult>> {
    const references = this.#referencedHashes()
    if (!references.ok) return references
    for (const hash of references.value) {
      const content = await store.get(hash)
      if (!content.ok) return content
    }
    const report = await store.auditAndCollect(references.value, { dryRun: true })
    return report.ok ? ok({ references: references.value, ...report.value }) : report
  }

  #referencedHashes(): Result<readonly Sha256[]> {
    try {
      const rows = this.database
        .prepare(`SELECT DISTINCT s.content_hash AS hash FROM stored_artifacts s WHERE
        EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=s.id) OR
        EXISTS(SELECT 1 FROM generated_artifacts g WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
        EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=s.id) ORDER BY hash`)
        .all() as unknown as Array<{ hash: Sha256 }>
      return ok(rows.map(({ hash }) => hash))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  #unreferencedRows(): Array<{ id: string }> {
    return this.database
      .prepare(`SELECT s.id FROM stored_artifacts s WHERE NOT(
      EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=s.id) OR
      EXISTS(SELECT 1 FROM generated_artifacts g WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
      EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=s.id))`)
      .all() as unknown as Array<{ id: string }>
  }

  #protectedHashes(): Result<readonly Sha256[]> {
    try {
      const rows = this.database
        .prepare('SELECT DISTINCT content_hash AS hash FROM stored_artifacts ORDER BY hash')
        .all() as unknown as Array<{ hash: Sha256 }>
      return ok(rows.map(({ hash }) => hash))
    } catch (error) {
      return sqliteFailure(error)
    }
  }
}
