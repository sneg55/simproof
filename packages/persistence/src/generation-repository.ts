import type { DatabaseSync } from 'node:sqlite'
import type { SimulationVersion } from '@simproof/contracts'

import { GenerationAttemptRepository } from './generation-attempt-repository.js'
import { decodeGenerationRun, decodeGenerationTransition } from './generation-codec.js'
import { settleGenerationConcept } from './generation-concept-settlement.js'
import { recoverInterruptedRuns } from './generation-recovery.js'
import { GenerationReservationRepository } from './generation-reservation-repository.js'
import { beginOrReplayReverification, isReverificationRun } from './generation-reverification.js'
import { beginOrReplayGeneration } from './generation-run-creator.js'
import { insertGenerationPipelineRun } from './generation-run-storage.js'
import { transitionAllowed } from './generation-state.js'
import { completeLegacyGenerationRun } from './generation-terminal.js'
import { validateTransitionEvidence } from './generation-transition-evidence.js'
import { validateTransitionMetadata } from './generation-transition-validation.js'
import type {
  BeginGenerationInput,
  BeginReverificationInput,
  CompleteGenerationAttemptInput,
  GenerationExternalCall,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  GenerationPipelineState,
  GenerationPipelineTransition,
  GenerationProviderReservation,
  GenerationTerminalClassification,
  ReconcileExternalCallInput,
  RecordExternalCallInput,
  ReserveExternalCallInput,
  SettleGenerationConceptInput,
  StartGenerationAttemptInput,
} from './generation-types.js'
import { validId, validTimestamp } from './generation-validation.js'
import { settleOperationalVersion } from './generation-version-settlement.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'

export class GenerationRepository {
  readonly #attempts: GenerationAttemptRepository
  readonly #reservations: GenerationReservationRepository

  constructor(
    readonly database: DatabaseSync,
    readonly canWrite: () => boolean,
    readonly getVersion: (id: string) => Result<SimulationVersion>,
  ) {
    this.#attempts = new GenerationAttemptRepository(database, canWrite, (id) => this.get(id))
    this.#reservations = new GenerationReservationRepository({
      database,
      canWrite,
      getRun: (id) => this.get(id),
      listAttempts: (runId) => this.attempts(runId),
      listCalls: (runId) => this.externalCalls(runId),
    })
  }

  beginOrReplay(input: BeginGenerationInput): Result<{
    readonly created: boolean
    readonly version: SimulationVersion
    readonly run: GenerationPipelineRun
  }> {
    return beginOrReplayGeneration({
      database: this.database,
      canWrite: this.canWrite,
      getVersion: this.getVersion,
      findByHash: (hash) => this.findByIdempotencyHash(hash),
      insertRun: (run) => insertGenerationPipelineRun(this.database, run, (id) => this.get(id)),
      input,
    })
  }

  beginOrReplayReverification(input: BeginReverificationInput) {
    return beginOrReplayReverification(
      {
        database: this.database,
        canWrite: this.canWrite,
        getVersion: this.getVersion,
        getRun: (id) => this.get(id),
        findByHash: (hash) => this.findByIdempotencyHash(hash),
      },
      input,
    )
  }

  isReverification(runId: string): boolean {
    return validId(runId) && isReverificationRun(this.database, runId)
  }

  get(runId: string): Result<GenerationPipelineRun> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    const row = this.database
      .prepare('SELECT * FROM generation_pipeline_runs WHERE id=?')
      .get(runId) as Record<string, unknown> | undefined
    return row === undefined
      ? err('not-found', 'Generation pipeline run was not found.')
      : ok(decodeGenerationRun(row))
  }

  findByIdempotencyHash(hash: string): Result<GenerationPipelineRun | null> {
    const row = this.database
      .prepare('SELECT * FROM generation_pipeline_runs WHERE idempotency_key_hash=?')
      .get(hash) as Record<string, unknown> | undefined
    return ok(row === undefined ? null : decodeGenerationRun(row))
  }

  history(runId: string): Result<readonly GenerationPipelineTransition[]> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    const rows = this.database
      .prepare('SELECT * FROM generation_pipeline_transitions WHERE run_id=? ORDER BY sequence')
      .all(runId) as unknown as Record<string, unknown>[]
    return ok(rows.map(decodeGenerationTransition))
  }

  attempts(runId: string): Result<readonly GenerationPipelineAttempt[]> {
    return this.#attempts.list(runId)
  }

  externalCalls(runId: string): Result<readonly GenerationExternalCall[]> {
    return this.#attempts.externalCalls(runId)
  }

  transition(input: {
    readonly runId: string
    readonly expectedRevision: number
    readonly to: GenerationPipelineState
    readonly at: string
    readonly terminalClassification?: GenerationTerminalClassification
    readonly stableErrorId?: string | null
    readonly findingsReference?: string | null
  }): Result<GenerationPipelineRun> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    return transaction(this.database, () => this.#transition(input))
  }

  requestCancellation(input: {
    readonly runId: string
    readonly expectedRevision: number
    readonly at: string
  }): Result<GenerationPipelineRun> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (
      !validId(input.runId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      !validTimestamp(input.at)
    ) {
      return err(INVALID_INPUT, 'Cancellation request is invalid.')
    }
    return transaction(this.database, () => {
      const current = this.get(input.runId)
      if (!current.ok) return current
      if (current.value.state === 'cancelled') return current
      this.database
        .prepare(`UPDATE generation_pipeline_runs SET cancellation_requested_at=? WHERE id=?`)
        .run(input.at, input.runId)
      this.database
        .prepare(`UPDATE generation_pipeline_attempts SET outcome='cancelled',completed_at=?
          WHERE run_id=? AND outcome='pending'`)
        .run(input.at, input.runId)
      this.database
        .prepare(`UPDATE generation_attempts SET outcome='cancelled',completed_at=?
          WHERE generation_run_id=? AND outcome IN ('pending','running')`)
        .run(input.at, input.runId)
      const cancelled = this.#transition({
        ...input,
        to: 'cancelled',
        terminalClassification: 'cancelled',
      })
      if (!cancelled.ok) return cancelled
      return this.get(input.runId)
    })
  }

  settleConcept(input: SettleGenerationConceptInput): Result<GenerationPipelineRun> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (
      !validId(input.runId) ||
      !Number.isSafeInteger(input.expectedRunRevision) ||
      !validTimestamp(input.at)
    ) {
      return err(INVALID_INPUT, 'Concept settlement is invalid.')
    }
    return transaction(this.database, () =>
      settleGenerationConcept({
        database: this.database,
        input,
        getRun: (runId) => this.get(runId),
        transition: (transitionInput) => this.#transition(transitionInput),
      }),
    )
  }

  startAttempt(input: StartGenerationAttemptInput): Result<GenerationPipelineAttempt> {
    return this.#attempts.start(input)
  }

  completeAttempt(input: CompleteGenerationAttemptInput): Result<GenerationPipelineAttempt> {
    return this.#attempts.complete(input)
  }

  recordExternalCall(
    input: RecordExternalCallInput,
  ): Result<{ readonly call: GenerationExternalCall; readonly run: GenerationPipelineRun }> {
    return this.#attempts.recordExternalCall(input)
  }

  externalCallReservations(runId: string): Result<readonly GenerationProviderReservation[]> {
    return this.#reservations.list(runId)
  }

  reserveExternalCall(input: ReserveExternalCallInput) {
    return this.#reservations.reserve(input)
  }

  reconcileExternalCall(input: ReconcileExternalCallInput) {
    return this.#reservations.reconcile(input)
  }

  releaseExternalCallReservation(reservationId: string, at: string) {
    return this.#reservations.release(reservationId, at)
  }

  recoverInterrupted(input: { readonly at: string }) {
    return recoverInterruptedRuns({
      database: this.database,
      canWrite: this.canWrite,
      at: input.at,
    })
  }

  #transition(input: {
    runId: string
    expectedRevision: number
    to: GenerationPipelineState
    at: string
    terminalClassification?: GenerationTerminalClassification
    stableErrorId?: string | null
    findingsReference?: string | null
  }): Result<GenerationPipelineRun> {
    const metadata = validateTransitionMetadata(input)
    if (!metadata.ok) return metadata
    const current = this.get(input.runId)
    if (!current.ok) return current
    if (current.value.revision !== input.expectedRevision)
      return err('conflict', 'Generation run revision changed concurrently.')
    if (!transitionAllowed(current.value.state, input.to))
      return err(
        'invalid-transition',
        `Generation transition ${current.value.state} -> ${input.to} is not allowed.`,
      )
    const evidence = validateTransitionEvidence(this.database, current.value, input.to)
    if (!evidence.ok) return evidence
    const { classification, stableErrorId, findingsReference, completedAt } = metadata.value
    if (completedAt !== null) {
      const settled = settleOperationalVersion(this.database, current.value, input.to, input.at)
      if (!settled.ok) return settled
    }
    try {
      const changed = this.database
        .prepare(
          `UPDATE generation_pipeline_runs SET state=?,revision=revision+1,terminal_classification=?,stable_error_id=?,findings_reference=?,updated_at=?,completed_at=? WHERE id=? AND revision=? AND completed_at IS NULL`,
        )
        .run(
          input.to,
          classification,
          stableErrorId,
          findingsReference,
          input.at,
          completedAt,
          input.runId,
          input.expectedRevision,
        )
      if (Number(changed.changes) !== 1)
        return err('conflict', 'Generation run revision changed concurrently.')
      this.database
        .prepare(
          `INSERT INTO generation_pipeline_transitions(run_id,sequence,from_state,to_state,transitioned_at) VALUES (?,?,?,?,?)`,
        )
        .run(input.runId, input.expectedRevision + 1, current.value.state, input.to, input.at)
      const legacy = completeLegacyGenerationRun(this.database, input.runId, input.to, input.at)
      if (!legacy.ok) return legacy
      return this.get(input.runId)
    } catch (error) {
      return sqliteFailure(error)
    }
  }
}
