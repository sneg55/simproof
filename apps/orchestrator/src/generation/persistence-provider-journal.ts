import type { GenerationExternalOperation, PersistenceDatabase } from '@simproof/persistence'

import {
  GenerationJournalError,
  unwrapJournalResult as unwrap,
} from './persistence-journal-mapping.js'
import type { GenerationJournal, PipelineRun } from './pipeline-types.js'

interface ProviderJournalOptions {
  readonly database: PersistenceDatabase
  readonly id: () => string
  readonly attemptId: (runId: string, operation: GenerationExternalOperation) => string | null
  readonly toRun: (runId: string) => PipelineRun
}

// Both the success and failure reconciliation paths persist the same five-key
// usage shape. Building it here (instead of spreading the provider metering,
// which carries a `requestCount` key the persistence schema forbids) keeps the
// two paths from drifting and rejecting a valid call as invalid-input.
const persistedUsage = (
  usage: {
    readonly requestCount: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costMicrousd: number
  },
  artifactBytes: number,
) => ({
  providerRequests: usage.requestCount,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  costMicrousd: usage.costMicrousd,
  artifactBytes,
})

export class PersistenceProviderJournal {
  constructor(readonly options: ProviderJournalOptions) {}

  reserve({
    run,
    operation,
    provider,
    reservation,
    artifactBytes,
    at,
  }: Parameters<GenerationJournal['reserveProviderCall']>[0]): ReturnType<
    GenerationJournal['reserveProviderCall']
  > {
    const reservationId = this.options.id()
    const result = this.options.database.generation.reserveExternalCall({
      id: reservationId,
      runId: run.id,
      attemptId: this.options.attemptId(run.id, operation),
      operation,
      provider: provider.provider,
      modelId: provider.model,
      templateVersion: provider.templateVersion,
      reservedUsage: {
        providerRequests: reservation.requestCount,
        inputTokens: reservation.inputTokens,
        outputTokens: reservation.outputTokens,
        costMicrousd: reservation.costMicrousd,
        artifactBytes,
      },
      createdAt: at,
    })
    if (!result.ok) {
      if (result.error.code === 'invalid-state') return { ok: false, run }
      throw new GenerationJournalError(result.error.code)
    }
    return { ok: true, run: this.options.toRun(result.value.run.id), reservationId }
  }

  release({
    run,
    reservationId,
    at,
  }: Parameters<GenerationJournal['releaseProviderReservation']>[0]): PipelineRun {
    const released = unwrap(
      this.options.database.generation.releaseExternalCallReservation(reservationId, at),
    )
    return released.run.id === run.id ? this.options.toRun(released.run.id) : run
  }

  recordCall({
    run,
    reservationId,
    operation,
    provenance,
    artifactBytes,
    at,
  }: Parameters<GenerationJournal['recordProviderCall']>[0]): PipelineRun {
    const recorded = unwrap(
      this.options.database.generation.reconcileExternalCall({
        reservationId,
        call: {
          id: this.options.id(),
          runId: run.id,
          attemptId: this.options.attemptId(run.id, operation),
          operation,
          provider: provenance.provider,
          modelId: provenance.model,
          templateVersion: provenance.templateVersion,
          providerRequestId: provenance.requestIds[0] ?? null,
          codexThreadId: provenance.threadId,
          stableErrorId: null,
          usage: persistedUsage(provenance.usage, artifactBytes),
          recordedAt: at,
        },
        reconciledAt: at,
      }),
    )
    return this.options.toRun(recorded.run.id)
  }

  recordFailure({
    run,
    reservationId,
    operation,
    metering,
    stableErrorId,
    at,
  }: Parameters<GenerationJournal['recordProviderFailure']>[0]): PipelineRun {
    const recorded = unwrap(
      this.options.database.generation.reconcileExternalCall({
        reservationId,
        call: {
          id: this.options.id(),
          runId: run.id,
          attemptId: this.options.attemptId(run.id, operation),
          operation,
          provider: metering.provider,
          modelId: metering.model,
          templateVersion: metering.templateVersion,
          providerRequestId: metering.requestIds[0] ?? null,
          codexThreadId: null,
          stableErrorId,
          usage: persistedUsage(metering.usage, 0),
          recordedAt: at,
        },
        reconciledAt: at,
      }),
    )
    return this.options.toRun(recorded.run.id)
  }
}
