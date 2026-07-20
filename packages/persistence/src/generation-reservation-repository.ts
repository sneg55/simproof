import type { DatabaseSync } from 'node:sqlite'

import { validateReservationHistory } from './generation-attempt-invariants.js'
import { decodeExternalCall, decodeProviderReservation } from './generation-codec.js'
import {
  addUsage,
  callBelongsTo,
  clampUsage,
  externalCallMatches,
  reservationMatches,
  subtractUsage,
  withinBudget,
} from './generation-reservation-matches.js'
import { validReconciliation, validReservation } from './generation-reservation-validation.js'
import type {
  GenerationExternalCall,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  GenerationProviderReservation,
  GenerationUsage,
  ReconcileExternalCallInput,
  ReserveExternalCallInput,
} from './generation-types.js'
import { validId, validTimestamp } from './generation-validation.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'
type ReservationResult = {
  readonly reservation: GenerationProviderReservation
  readonly run: GenerationPipelineRun
}

type ReconciliationResult = ReservationResult & { readonly call: GenerationExternalCall }

export class GenerationReservationRepository {
  readonly database: DatabaseSync
  readonly canWrite: () => boolean
  readonly getRun: (id: string) => Result<GenerationPipelineRun>
  readonly listAttempts: (runId: string) => Result<readonly GenerationPipelineAttempt[]>
  readonly listCalls: (runId: string) => Result<readonly GenerationExternalCall[]>

  constructor(options: {
    readonly database: DatabaseSync
    readonly canWrite: () => boolean
    readonly getRun: (id: string) => Result<GenerationPipelineRun>
    readonly listAttempts: (runId: string) => Result<readonly GenerationPipelineAttempt[]>
    readonly listCalls: (runId: string) => Result<readonly GenerationExternalCall[]>
  }) {
    this.database = options.database
    this.canWrite = options.canWrite
    this.getRun = options.getRun
    this.listAttempts = options.listAttempts
    this.listCalls = options.listCalls
  }

  list(runId: string): Result<readonly GenerationProviderReservation[]> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    const rows = this.database
      .prepare(
        'SELECT * FROM generation_provider_reservations WHERE run_id=? ORDER BY created_at,id',
      )
      .all(runId) as unknown as Record<string, unknown>[]
    return ok(rows.map(decodeProviderReservation))
  }

  reserve(input: ReserveExternalCallInput): Result<ReservationResult> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validReservation(input)) return err(INVALID_INPUT, 'Provider reservation is invalid.')
    return transaction<ReservationResult>(this.database, () => {
      const replay = this.#get(input.id)
      if (replay.ok) {
        if (!reservationMatches(replay.value, input)) {
          return err('conflict', 'Provider reservation identity was reused with different input.')
        }
        const run = this.getRun(replay.value.runId)
        return run.ok ? ok({ reservation: replay.value, run: run.value }) : run
      }
      const run = this.getRun(input.runId)
      if (!run.ok) return run
      const attempts = this.listAttempts(input.runId)
      if (!attempts.ok) return attempts
      const calls = this.listCalls(input.runId)
      if (!calls.ok) return calls
      const reservations = this.list(input.runId)
      if (!reservations.ok) return reservations
      const allowed = validateReservationHistory({
        run: run.value,
        attempts: attempts.value,
        calls: calls.value,
        reservations: reservations.value,
        input,
      })
      if (!allowed.ok) return allowed
      const projected = addUsage(run.value.usage, input.reservedUsage)
      if (!withinBudget(projected, run.value.budgets)) {
        return err('invalid-state', 'Provider reservation exceeds the remaining generation budget.')
      }
      try {
        this.database
          .prepare(`INSERT INTO generation_provider_reservations(
            id,run_id,attempt_id,operation,provider,model_id,template_version,
            reserved_provider_requests,reserved_input_tokens,reserved_output_tokens,
            reserved_cost_microusd,reserved_artifact_bytes,status,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`)
          .run(
            input.id,
            input.runId,
            input.attemptId,
            input.operation,
            input.provider,
            input.modelId,
            input.templateVersion,
            input.reservedUsage.providerRequests,
            input.reservedUsage.inputTokens,
            input.reservedUsage.outputTokens,
            input.reservedUsage.costMicrousd,
            input.reservedUsage.artifactBytes,
            input.createdAt,
          )
        this.#updateUsage(input.runId, projected, input.createdAt)
        return this.#result(input.id, input.runId)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  reconcile(input: ReconcileExternalCallInput): Result<ReconciliationResult> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validReconciliation(input)) return err(INVALID_INPUT, 'Call reconciliation is invalid.')
    return transaction<ReconciliationResult>(this.database, () => {
      const reservation = this.#get(input.reservationId)
      if (!reservation.ok) return reservation
      if (!callBelongsTo(reservation.value, input.call)) {
        return err('conflict', 'External call provenance differs from its reservation.')
      }
      if (reservation.value.status === 'not_dispatched') {
        return err('immutable-record', 'A released reservation cannot be reconciled.')
      }
      if (reservation.value.status === 'reconciled') {
        const call = this.#getCall(reservation.value.externalCallId ?? '')
        if (
          !call.ok ||
          reservation.value.reconciledAt !== input.reconciledAt ||
          !externalCallMatches(call.value, input.call)
        ) {
          return err(
            'conflict',
            'Provider reconciliation identity was reused with different input.',
          )
        }
        const run = this.getRun(reservation.value.runId)
        return run.ok
          ? ok({ reservation: reservation.value, call: call.value, run: run.value })
          : err(run.error.code, run.error.message)
      }
      const run = this.getRun(reservation.value.runId)
      if (!run.ok) return run
      const actual = clampUsage(
        addUsage(subtractUsage(run.value.usage, reservation.value.reservedUsage), input.call.usage),
        run.value.budgets,
      )
      try {
        this.#insertCall(input.call)
        this.database
          .prepare(`UPDATE generation_provider_reservations
            SET status='reconciled',external_call_id=?,reconciled_at=? WHERE id=? AND status='pending'`)
          .run(input.call.id, input.reconciledAt, input.reservationId)
        this.#updateUsage(reservation.value.runId, actual, input.reconciledAt)
        const updated = this.#get(input.reservationId)
        const updatedRun = this.getRun(reservation.value.runId)
        if (!updated.ok) return updated
        if (!updatedRun.ok) return err(updatedRun.error.code, updatedRun.error.message)
        return ok({ reservation: updated.value, call: input.call, run: updatedRun.value })
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  release(reservationId: string, at: string): Result<ReservationResult> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!validId(reservationId) || !validTimestamp(at)) {
      return err(INVALID_INPUT, 'Provider reservation release is invalid.')
    }
    return transaction<ReservationResult>(this.database, () => {
      const reservation = this.#get(reservationId)
      if (!reservation.ok) return reservation
      if (reservation.value.status === 'reconciled') {
        return err('immutable-record', 'A reconciled reservation cannot be released.')
      }
      const run = this.getRun(reservation.value.runId)
      if (!run.ok) return run
      if (reservation.value.status === 'not_dispatched') {
        return reservation.value.reconciledAt === at
          ? ok({ reservation: reservation.value, run: run.value })
          : err('conflict', 'Reservation release was replayed with a different timestamp.')
      }
      if (run.value.completedAt !== null) {
        return err('invalid-state', 'Interrupted pending reservations remain consumed.')
      }
      try {
        this.database
          .prepare(`UPDATE generation_provider_reservations
            SET status='not_dispatched',reconciled_at=? WHERE id=? AND status='pending'`)
          .run(at, reservationId)
        this.#updateUsage(
          reservation.value.runId,
          subtractUsage(run.value.usage, reservation.value.reservedUsage),
          at,
        )
        return this.#result(reservationId, reservation.value.runId)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  #result(id: string, runId: string): Result<ReservationResult> {
    const reservation = this.#get(id)
    const run = this.getRun(runId)
    if (!reservation.ok) return reservation
    if (!run.ok) return err(run.error.code, run.error.message)
    return ok({ reservation: reservation.value, run: run.value })
  }

  #get(id: string): Result<GenerationProviderReservation> {
    const row = this.database
      .prepare('SELECT * FROM generation_provider_reservations WHERE id=?')
      .get(id) as Record<string, unknown> | undefined
    return row === undefined
      ? err('not-found', 'Provider reservation was not found.')
      : ok(decodeProviderReservation(row))
  }

  #getCall(id: string): Result<GenerationExternalCall> {
    const row = this.database
      .prepare('SELECT * FROM generation_external_calls WHERE id=?')
      .get(id) as Record<string, unknown> | undefined
    return row === undefined
      ? err('not-found', 'External call was not found.')
      : ok(decodeExternalCall(row))
  }

  #insertCall(input: GenerationExternalCall): void {
    this.database
      .prepare(`INSERT INTO generation_external_calls(
        id,run_id,attempt_id,operation,provider,model_id,template_version,provider_request_id,
        codex_thread_id,stable_error_id,provider_requests,input_tokens,output_tokens,
        cost_microusd,artifact_bytes,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
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

  #updateUsage(runId: string, usage: GenerationUsage, at: string): void {
    this.database
      .prepare(`UPDATE generation_pipeline_runs SET
        used_provider_requests=?,used_input_tokens=?,used_output_tokens=?,used_cost_microusd=?,
        used_artifact_bytes=?,updated_at=? WHERE id=?`)
      .run(
        usage.providerRequests,
        usage.inputTokens,
        usage.outputTokens,
        usage.costMicrousd,
        usage.artifactBytes,
        at,
        runId,
      )
  }
}
