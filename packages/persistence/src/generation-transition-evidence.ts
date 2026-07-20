import type { DatabaseSync } from 'node:sqlite'
import { validateScientificTransition } from './generation-scientific-evidence.js'
import type { GenerationPipelineRun, GenerationPipelineState } from './generation-types.js'
import { err, ok, type Result } from './types.js'

export function validateTransitionEvidence(
  database: DatabaseSync,
  run: GenerationPipelineRun,
  to: GenerationPipelineState,
): Result<true> {
  if (run.state === 'compiling' && to === 'generating') {
    return hasSuccessfulCall(database, run.id, null, 'concept_compile')
      ? ok(true)
      : err('invalid-state', 'Concept compilation must succeed before code generation.')
  }
  if (!['generating', 'repairing'].includes(run.state) || to !== 'executing') {
    return validateScientificTransition(database, run.id, to)
  }
  const attempt = database
    .prepare(`SELECT id,attempt_number,outcome FROM generation_pipeline_attempts
      WHERE run_id=? ORDER BY attempt_number DESC LIMIT 1`)
    .get(run.id) as { id: string; attempt_number: number; outcome: string } | undefined
  const operation = run.state === 'generating' ? 'code_generate' : 'code_repair'
  const validNumber =
    attempt !== undefined &&
    (operation === 'code_generate' ? attempt.attempt_number === 1 : attempt.attempt_number > 1)
  return attempt !== undefined &&
    attempt.outcome === 'pending' &&
    validNumber &&
    hasSuccessfulCall(database, run.id, attempt.id, operation)
    ? ok(true)
    : err('invalid-state', 'A successful call for the current pending attempt is required.')
}

function hasSuccessfulCall(
  database: DatabaseSync,
  runId: string,
  attemptId: string | null,
  operation: string,
): boolean {
  const row = database
    .prepare(`SELECT 1 FROM generation_external_calls
      WHERE run_id=? AND attempt_id IS ? AND operation=? AND stable_error_id IS NULL LIMIT 1`)
    .get(runId, attemptId, operation)
  return row !== undefined
}
