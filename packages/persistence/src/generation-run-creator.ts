import type { DatabaseSync } from 'node:sqlite'
import type { SimulationVersion } from '@simproof/contracts'

import type { BeginGenerationInput, GenerationPipelineRun } from './generation-types.js'
import { hashIdempotencyKey, parseBeginInput } from './generation-validation.js'
import { asCount, sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

type BeginResult = {
  readonly created: boolean
  readonly version: SimulationVersion
  readonly run: GenerationPipelineRun
}

export function beginOrReplayGeneration(options: {
  readonly database: DatabaseSync
  readonly canWrite: () => boolean
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly findByHash: (hash: string) => Result<GenerationPipelineRun | null>
  readonly insertRun: (input: {
    id: string
    simulationVersionId: string
    idempotencyKeyHash: string
    maxAttempts: number
    budgets: GenerationPipelineRun['budgets']
    createdAt: string
  }) => Result<GenerationPipelineRun>
  readonly input: BeginGenerationInput
}): Result<BeginResult> {
  if (!options.canWrite()) return err('conflict', 'Persistence maintenance is active.')
  const parsed = parseBeginInput(options.input)
  if (parsed === null) {
    return err('invalid-input', 'Generation request persistence input is invalid.')
  }
  return transaction<BeginResult>(options.database, () => {
    const hash = hashIdempotencyKey(parsed.idempotencyKey)
    const existing = options.findByHash(hash)
    if (!existing.ok) return existing
    if (existing.value !== null) {
      if (existing.value.simulationVersionId !== parsed.versionId) {
        return err('conflict', 'Idempotency key belongs to another simulation version.')
      }
      const version = options.getVersion(parsed.versionId)
      return version.ok
        ? ok({ created: false, version: version.value, run: existing.value })
        : version
    }
    const current = options.getVersion(parsed.versionId)
    if (!current.ok) return current
    if (current.value.revision !== parsed.expectedRevision) {
      return err('conflict', 'Simulation version revision changed concurrently.')
    }
    if (!['draft', 'rejected', 'stale'].includes(current.value.state)) {
      return err('invalid-state', 'Version cannot begin generation from its current state.')
    }
    try {
      options.database
        .prepare(`INSERT INTO generation_runs(
          id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
        ) VALUES (?,?,'running',?,?,?,NULL)`)
        .run(
          parsed.run.id,
          parsed.versionId,
          parsed.run.maxAttempts,
          parsed.run.codexSessionId,
          parsed.run.createdAt,
        )
    } catch (error) {
      return sqliteFailure(error)
    }
    const run = options.insertRun({
      id: parsed.run.id,
      simulationVersionId: parsed.versionId,
      idempotencyKeyHash: hash,
      maxAttempts: parsed.run.maxAttempts,
      budgets: parsed.budgets,
      createdAt: parsed.run.createdAt,
    })
    if (!run.ok) return run
    const changed = options.database
      .prepare(
        `UPDATE simulation_versions SET state='generating',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state IN ('draft','rejected','stale')`,
      )
      .run(parsed.updatedAt, parsed.versionId, parsed.expectedRevision)
    if (asCount(changed.changes) !== 1) {
      return err('conflict', 'Simulation version revision changed concurrently.')
    }
    const version = options.getVersion(parsed.versionId)
    return version.ok ? ok({ created: true, version: version.value, run: run.value }) : version
  })
}
