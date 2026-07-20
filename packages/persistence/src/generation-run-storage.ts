import type { DatabaseSync } from 'node:sqlite'

import type { GenerationPipelineRun } from './generation-types.js'
import { sqliteFailure } from './sqlite.js'
import type { Result } from './types.js'

export interface GenerationRunInsert {
  readonly id: string
  readonly simulationVersionId: string
  readonly idempotencyKeyHash: string
  readonly maxAttempts: number
  readonly budgets: GenerationPipelineRun['budgets']
  readonly createdAt: string
}

export function insertGenerationPipelineRun(
  database: DatabaseSync,
  input: GenerationRunInsert,
  getRun: (id: string) => Result<GenerationPipelineRun>,
): Result<GenerationPipelineRun> {
  try {
    database
      .prepare(`INSERT INTO generation_pipeline_runs(
        id,simulation_version_id,idempotency_key_hash,state,revision,max_attempts,
        max_provider_requests,max_input_tokens,max_output_tokens,max_cost_microusd,max_artifact_bytes,
        used_provider_requests,used_input_tokens,used_output_tokens,used_cost_microusd,used_artifact_bytes,
        created_at,updated_at
      ) VALUES (?,?,?,'queued',0,?,?,?,?,?,?,0,0,0,0,0,?,?)`)
      .run(
        input.id,
        input.simulationVersionId,
        input.idempotencyKeyHash,
        input.maxAttempts,
        input.budgets.providerRequests,
        input.budgets.inputTokens,
        input.budgets.outputTokens,
        input.budgets.costMicrousd,
        input.budgets.artifactBytes,
        input.createdAt,
        input.createdAt,
      )
    database
      .prepare(`INSERT INTO generation_pipeline_transitions(
        run_id,sequence,from_state,to_state,transitioned_at
      ) VALUES (?,0,NULL,'queued',?)`)
      .run(input.id, input.createdAt)
    return getRun(input.id)
  } catch (error) {
    return sqliteFailure(error)
  }
}
