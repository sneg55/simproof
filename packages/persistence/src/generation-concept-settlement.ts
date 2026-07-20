import type { DatabaseSync } from 'node:sqlite'

import type { GenerationPipelineRun, SettleGenerationConceptInput } from './generation-types.js'
import { err, type Result } from './types.js'

interface SettlementOptions {
  readonly database: DatabaseSync
  readonly input: SettleGenerationConceptInput
  readonly getRun: (runId: string) => Result<GenerationPipelineRun>
  readonly transition: (input: {
    readonly runId: string
    readonly expectedRevision: number
    readonly to: 'generating' | 'cancelled' | 'invariant_failed'
    readonly at: string
    readonly terminalClassification?: 'cancelled' | 'invariant_failure'
    readonly stableErrorId?: string
  }) => Result<GenerationPipelineRun>
}

type Transition = SettlementOptions['transition']
type AcceptInput = Extract<SettleGenerationConceptInput, { readonly decision: 'accept' }>
type TerminateInput = Exclude<SettleGenerationConceptInput, AcceptInput>

interface ReviewRow {
  readonly id: string
  readonly status: string
  readonly revision: number
  readonly concept_hash: string
}

interface AcceptOptions {
  readonly database: DatabaseSync
  readonly transition: Transition
  readonly run: GenerationPipelineRun
  readonly review: ReviewRow | undefined
  readonly input: AcceptInput
}

export function settleGenerationConcept({
  database,
  getRun,
  input,
  transition,
}: SettlementOptions): Result<GenerationPipelineRun> {
  const run = getRun(input.runId)
  if (!run.ok) return run
  if (run.value.revision !== input.expectedRunRevision) {
    return err('conflict', 'Generation run revision changed concurrently.')
  }
  const review = readReview(database, input.runId)
  return input.decision === 'accept'
    ? acceptConcept({ database, transition, run: run.value, review, input })
    : terminateConcept(database, transition, review, input)
}

function readReview(database: DatabaseSync, runId: string): ReviewRow | undefined {
  return database
    .prepare(
      `SELECT id,status,revision,concept_hash FROM generation_concept_reviews WHERE run_id=?`,
    )
    .get(runId) as ReviewRow | undefined
}

function acceptConcept({
  database,
  input,
  review,
  run,
  transition,
}: AcceptOptions): Result<GenerationPipelineRun> {
  if (!reviewMatchesAcceptance(run, review, input)) {
    return err('conflict', 'Generation review changed concurrently.')
  }
  const resolved = database
    .prepare(`UPDATE generation_concept_reviews SET status='confirmed',revision=revision+1,
      updated_at=?,resolved_at=? WHERE id=? AND status='pending' AND revision=? AND concept_hash=?`)
    .run(input.at, input.at, review.id, input.expectedReviewRevision, input.expectedConceptHash)
  if (Number(resolved.changes) !== 1) {
    return err('conflict', 'Generation review changed concurrently.')
  }
  return transition({
    runId: input.runId,
    expectedRevision: input.expectedRunRevision,
    to: 'generating',
    at: input.at,
  })
}

function reviewMatchesAcceptance(
  run: GenerationPipelineRun,
  review: ReviewRow | undefined,
  input: AcceptInput,
): review is ReviewRow {
  return (
    run.state === 'compiling' &&
    review?.status === 'pending' &&
    review.revision === input.expectedReviewRevision &&
    review.concept_hash === input.expectedConceptHash
  )
}

function terminateConcept(
  database: DatabaseSync,
  transition: Transition,
  review: ReviewRow | undefined,
  input: TerminateInput,
): Result<GenerationPipelineRun> {
  if (
    input.expectedReviewRevision !== undefined &&
    (review?.status !== 'pending' || review.revision !== input.expectedReviewRevision)
  ) {
    return err('conflict', 'Generation review changed concurrently.')
  }
  if (review?.status === 'pending') {
    database
      .prepare(`UPDATE generation_concept_reviews SET status='cancelled',revision=revision+1,
        updated_at=?,resolved_at=? WHERE id=? AND status='pending'`)
      .run(input.at, input.at, review.id)
  }
  const invariant = input.decision === 'invariant-failure'
  closeActiveAttempt(database, input.runId, input.at, invariant)
  if (!invariant) {
    database
      .prepare('UPDATE generation_pipeline_runs SET cancellation_requested_at=? WHERE id=?')
      .run(input.at, input.runId)
  }
  return transition({
    runId: input.runId,
    expectedRevision: input.expectedRunRevision,
    to: invariant ? 'invariant_failed' : 'cancelled',
    at: input.at,
    terminalClassification: invariant ? 'invariant_failure' : 'cancelled',
    ...(invariant ? { stableErrorId: 'orchestration.invariant-failed' } : {}),
  })
}

function closeActiveAttempt(
  database: DatabaseSync,
  runId: string,
  at: string,
  invariant: boolean,
): void {
  database
    .prepare(`UPDATE generation_pipeline_attempts SET outcome=?,stable_error_id=?,completed_at=?
      WHERE run_id=? AND outcome='pending'`)
    .run(
      invariant ? 'invariant_failed' : 'cancelled',
      invariant ? 'orchestration.invariant-failed' : null,
      at,
      runId,
    )
  database
    .prepare(`UPDATE generation_attempts SET outcome=?,stable_error_id=?,completed_at=?
      WHERE generation_run_id=? AND outcome IN ('pending','running')`)
    .run(
      invariant ? 'invalid-output' : 'cancelled',
      invariant ? 'orchestration.invariant-failed' : null,
      at,
      runId,
    )
}
