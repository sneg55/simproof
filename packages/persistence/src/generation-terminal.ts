import type { DatabaseSync } from 'node:sqlite'

import type { GenerationPipelineState } from './generation-types.js'
import { err, ok, type Result } from './types.js'

const LEGACY_STATUS = new Map<GenerationPipelineState, string>([
  ['verified', 'succeeded'],
  ['rejected', 'rejected'],
  ['cancelled', 'cancelled'],
  ['provider_failed', 'operational-failure'],
  ['runner_failed', 'operational-failure'],
  ['budget_exhausted', 'budget-exhausted'],
  ['invariant_failed', 'operational-failure'],
])

export function completeLegacyGenerationRun(
  database: DatabaseSync,
  runId: string,
  state: GenerationPipelineState,
  completedAt: string,
): Result<true> {
  const status = LEGACY_STATUS.get(state)
  if (status === undefined) return ok(true)
  const attempts = database
    .prepare('SELECT outcome FROM generation_attempts WHERE generation_run_id=?')
    .all(runId) as unknown as Array<{ outcome: string }>
  if (attempts.some(({ outcome }) => outcome === 'pending' || outcome === 'running')) {
    return err('invalid-state', 'Terminal generation run has an active attempt.')
  }
  const hasVerified = attempts.some(({ outcome }) => outcome === 'verified')
  if ((state === 'verified' && !hasVerified) || (state === 'rejected' && hasVerified)) {
    return err('invalid-state', 'Terminal generation state is inconsistent with its attempts.')
  }
  const changed = database
    .prepare(`UPDATE generation_runs SET status=?,completed_at=? WHERE id=? AND status='running'`)
    .run(status, completedAt, runId)
  return Number(changed.changes) === 1
    ? ok(true)
    : err('conflict', 'Legacy generation run changed concurrently.')
}
