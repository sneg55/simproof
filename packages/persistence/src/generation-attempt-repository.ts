import type { DatabaseSync } from 'node:sqlite'
import { retainedGeneratedArtifactId } from './generation-attempt-artifact.js'
import {
  validateAttemptStart,
  validateExternalCallHistory,
} from './generation-attempt-invariants.js'
import { decodeExternalCall, decodeGenerationAttempt } from './generation-codec.js'
import { addUsage, withinBudget } from './generation-reservation-matches.js'
import { validateAttemptScientificEvidence } from './generation-scientific-evidence.js'
import type {
  CompleteGenerationAttemptInput,
  GenerationExternalCall,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  RecordExternalCallInput,
  StartGenerationAttemptInput,
} from './generation-types.js'
import {
  validCompleteAttempt,
  validExternalCall,
  validId,
  validStartAttempt,
} from './generation-validation.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'

export class GenerationAttemptRepository {
  constructor(
    readonly database: DatabaseSync,
    readonly canWrite: () => boolean,
    readonly getRun: (id: string) => Result<GenerationPipelineRun>,
  ) {}

  list(runId: string): Result<readonly GenerationPipelineAttempt[]> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    const rows = this.database
      .prepare(`SELECT p.*,a.generated_artifact_id FROM generation_pipeline_attempts p
        JOIN generation_attempts a ON a.id=p.id WHERE p.run_id=? ORDER BY p.attempt_number`)
      .all(runId) as unknown as Record<string, unknown>[]
    return ok(rows.map(decodeGenerationAttempt))
  }

  externalCalls(runId: string): Result<readonly GenerationExternalCall[]> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    const rows = this.database
      .prepare('SELECT * FROM generation_external_calls WHERE run_id=? ORDER BY recorded_at,id')
      .all(runId) as unknown as Record<string, unknown>[]
    return ok(rows.map(decodeExternalCall))
  }

  start(input: StartGenerationAttemptInput): Result<GenerationPipelineAttempt> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validStartAttempt(input)) return err(INVALID_INPUT, 'Generation attempt is invalid.')
    return transaction(this.database, () => {
      const replay = this.#get(input.id)
      if (replay.ok) {
        return replay.value.runId === input.runId &&
          replay.value.attemptNumber === input.attemptNumber &&
          replay.value.provider === input.provider &&
          replay.value.modelId === input.modelId &&
          replay.value.templateVersion === input.templateVersion &&
          replay.value.createdAt === input.createdAt
          ? replay
          : err('conflict', 'Generation attempt identity was reused with different provenance.')
      }
      const run = this.getRun(input.runId)
      if (!run.ok) return run
      const existing = this.list(input.runId)
      if (!existing.ok) return existing
      const allowed = validateAttemptStart(run.value, existing.value, input)
      if (!allowed.ok) return allowed
      try {
        this.database
          .prepare(`INSERT INTO generation_attempts(
            id,generation_run_id,attempt_number,outcome,created_at
          ) VALUES (?,?,?,'pending',?)`)
          .run(input.id, input.runId, input.attemptNumber, input.createdAt)
        this.database
          .prepare(`INSERT INTO generation_pipeline_attempts(
            id,run_id,attempt_number,outcome,provider,model_id,template_version,created_at
          ) VALUES (?,?,?,'pending',?,?,?,?)`)
          .run(
            input.id,
            input.runId,
            input.attemptNumber,
            input.provider,
            input.modelId,
            input.templateVersion,
            input.createdAt,
          )
        return this.#get(input.id)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  complete(input: CompleteGenerationAttemptInput): Result<GenerationPipelineAttempt> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validCompleteAttempt(input)) return err(INVALID_INPUT, 'Attempt completion is invalid.')
    return transaction(this.database, () => {
      const current = this.#get(input.id)
      if (!current.ok) return current
      if (current.value.outcome !== 'pending') {
        return err('immutable-record', 'Completed generation attempts are immutable.')
      }
      const operational = [
        'provider_failed',
        'runner_failed',
        'malformed_response',
        'invariant_failed',
        'budget_exhausted',
      ].includes(input.outcome)
      const stableErrorId = input.stableErrorId ?? null
      if (operational !== (stableErrorId !== null)) {
        return err(INVALID_INPUT, 'Operational attempt outcomes require a stable error identifier.')
      }
      const scientific = validateAttemptScientificEvidence(
        this.database,
        current.value.runId,
        input,
      )
      if (!scientific.ok) return scientific
      // budget_exhausted carries a stable error id, so its legacy outcome must
      // be an operational one ('invalid-output'). Mapping it to 'cancelled'
      // wrote a record the read-time schema rejects, breaking library reads.
      const legacyOutcome =
        input.outcome === 'malformed_response' ||
        input.outcome === 'invariant_failed' ||
        input.outcome === 'budget_exhausted'
          ? 'invalid-output'
          : input.outcome.replace('_', '-')
      const generatedArtifactId = retainedGeneratedArtifactId(
        this.database,
        current.value,
        input,
        operational,
      )
      if (['verified', 'rejected'].includes(input.outcome) && generatedArtifactId === null) {
        return err(
          INVALID_INPUT,
          'Scientific attempt outcomes require a stored generated artifact.',
        )
      }
      try {
        this.database
          .prepare(
            `UPDATE generation_pipeline_attempts SET outcome=?,provider_request_id=?,codex_thread_id=?,artifact_hash=?,verification_run_id=?,findings_reference=?,stable_error_id=?,completed_at=? WHERE id=? AND outcome='pending'`,
          )
          .run(
            input.outcome,
            input.providerRequestId,
            input.codexThreadId,
            input.artifactHash,
            input.verificationRunId,
            input.findingsReference,
            stableErrorId,
            input.completedAt,
            input.id,
          )
        this.database
          .prepare(
            `UPDATE generation_attempts SET outcome=?,generated_artifact_id=?,stable_error_id=?,completed_at=? WHERE id=? AND outcome IN ('pending','running')`,
          )
          .run(legacyOutcome, generatedArtifactId, stableErrorId, input.completedAt, input.id)
        return this.#get(input.id)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  recordExternalCall(
    input: RecordExternalCallInput,
  ): Result<{ readonly call: GenerationExternalCall; readonly run: GenerationPipelineRun }> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validExternalCall(input)) {
      return err(INVALID_INPUT, 'External call provenance is invalid.')
    }
    return transaction(this.database, () => {
      const replayRow = this.database
        .prepare('SELECT * FROM generation_external_calls WHERE id=?')
        .get(input.id) as Record<string, unknown> | undefined
      if (replayRow !== undefined) {
        const replay = decodeExternalCall(replayRow)
        const run = this.getRun(input.runId)
        if (!run.ok) return run
        return this.#externalCallMatches(replay, input)
          ? ok({ call: replay, run: run.value })
          : err('conflict', 'External call identity was reused with different provenance.')
      }
      const run = this.getRun(input.runId)
      if (!run.ok) return run
      const pendingReservation = this.database
        .prepare(`SELECT 1 FROM generation_provider_reservations
          WHERE run_id=? AND status='pending' LIMIT 1`)
        .get(input.runId)
      if (pendingReservation !== undefined) {
        return err(
          'invalid-state',
          'A reserved provider call must be reconciled by reservation ID.',
        )
      }
      const attempts = this.list(input.runId)
      if (!attempts.ok) return attempts
      const priorCalls = this.externalCalls(input.runId)
      if (!priorCalls.ok) return priorCalls
      const allowed = validateExternalCallHistory(
        run.value,
        attempts.value,
        priorCalls.value,
        input,
      )
      if (!allowed.ok) return allowed
      const projected = addUsage(run.value.usage, input.usage)
      if (!withinBudget(projected, run.value.budgets)) {
        return err('invalid-state', 'External call would exceed the generation budget.')
      }
      try {
        this.#insertExternalCall(input)
        this.database
          .prepare(
            `UPDATE generation_pipeline_runs SET used_provider_requests=?,used_input_tokens=?,used_output_tokens=?,used_cost_microusd=?,used_artifact_bytes=?,updated_at=? WHERE id=?`,
          )
          .run(
            projected.providerRequests,
            projected.inputTokens,
            projected.outputTokens,
            projected.costMicrousd,
            projected.artifactBytes,
            input.recordedAt,
            input.runId,
          )
        const updated = this.getRun(input.runId)
        return updated.ok ? ok({ call: input, run: updated.value }) : updated
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  #insertExternalCall(input: RecordExternalCallInput): void {
    this.database
      .prepare(
        `INSERT INTO generation_external_calls(id,run_id,attempt_id,operation,provider,model_id,template_version,provider_request_id,codex_thread_id,stable_error_id,provider_requests,input_tokens,output_tokens,cost_microusd,artifact_bytes,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.runId,
        input.attemptId,
        input.operation,
        input.provider,
        input.modelId,
        input.templateVersion,
        input.providerRequestId,
        input.codexThreadId,
        input.stableErrorId,
        input.usage.providerRequests,
        input.usage.inputTokens,
        input.usage.outputTokens,
        input.usage.costMicrousd,
        input.usage.artifactBytes,
        input.recordedAt,
      )
  }

  #externalCallMatches(existing: GenerationExternalCall, input: RecordExternalCallInput): boolean {
    return (
      existing.id === input.id &&
      existing.runId === input.runId &&
      existing.attemptId === input.attemptId &&
      existing.operation === input.operation &&
      existing.provider === input.provider &&
      existing.modelId === input.modelId &&
      existing.templateVersion === input.templateVersion &&
      existing.providerRequestId === input.providerRequestId &&
      existing.codexThreadId === input.codexThreadId &&
      existing.stableErrorId === input.stableErrorId &&
      existing.recordedAt === input.recordedAt &&
      Object.keys(existing.usage).every(
        (key) =>
          existing.usage[key as keyof typeof existing.usage] ===
          input.usage[key as keyof typeof input.usage],
      )
    )
  }

  #get(id: string): Result<GenerationPipelineAttempt> {
    const row = this.database
      .prepare(`SELECT p.*,a.generated_artifact_id FROM generation_pipeline_attempts p
        JOIN generation_attempts a ON a.id=p.id WHERE p.id=?`)
      .get(id) as Record<string, unknown> | undefined
    return row === undefined
      ? err('not-found', 'Generation attempt was not found.')
      : ok(decodeGenerationAttempt(row))
  }
}
