import {
  type ConceptSpec,
  conceptSpecSchema,
  type GenerationStatus,
  generationStatusSchema,
} from '@simproof/contracts'
import type {
  ArtifactStore,
  ConceptReview as DurableConceptReview,
  GenerationPipelineRun,
  PersistenceDatabase,
  PersistenceErrorCode,
  Result,
} from '@simproof/persistence'

import type { GenerationArtifactWriter } from './generation-artifact-writer.js'
import type { ConceptCheckpoint } from './pipeline.js'
import type { PipelineRun } from './pipeline-types.js'
import { publicGenerationError } from './public-generation-error.js'
import { publicGenerationHistory } from './public-generation-history.js'

type CheckpointResult<T> = Result<T>

const error = (code: PersistenceErrorCode, message: string): CheckpointResult<never> => ({
  ok: false,
  error: { code, message },
})

const toPipelineRun = (durable: GenerationPipelineRun, attemptCount: number): PipelineRun => ({
  id: durable.id,
  state: durable.state,
  revision: durable.revision,
  maxAttempts: durable.maxAttempts,
  attemptCount,
  budget: {
    limits: {
      maxProviderRequests: durable.budgets.providerRequests,
      maxInputTokens: durable.budgets.inputTokens,
      maxOutputTokens: durable.budgets.outputTokens,
      maxCostMicrousd: durable.budgets.costMicrousd,
      maxArtifactBytes: durable.budgets.artifactBytes,
    },
    consumed: durable.usage,
  },
})

export class PersistenceGenerationCheckpoints {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly artifacts: GenerationArtifactWriter
  readonly id: () => string
  readonly now: () => string

  constructor(options: {
    readonly database: PersistenceDatabase
    readonly store: ArtifactStore
    readonly artifacts: GenerationArtifactWriter
    readonly id: () => string
    readonly now: () => string
  }) {
    this.database = options.database
    this.store = options.store
    this.artifacts = options.artifacts
    this.id = options.id
    this.now = options.now
  }

  create(checkpoint: ConceptCheckpoint): CheckpointResult<DurableConceptReview> {
    const durable = this.database.generation.get(checkpoint.run.id)
    if (!durable.ok) return durable
    const at = this.now()
    return this.database.conceptReviews.create({
      id: this.id(),
      runId: durable.value.id,
      simulationVersionId: durable.value.simulationVersionId,
      conceptSpecId: checkpoint.recorded.id,
      conceptHash: checkpoint.recorded.hash,
      status: 'pending',
      revision: 0,
      createdAt: at,
      updatedAt: at,
      resolvedAt: null,
    })
  }

  async confirmed(input: {
    readonly runId: string
    readonly expectedRunRevision: number
    readonly expectedReviewRevision: number
    readonly expectedConceptHash: string
  }): Promise<
    CheckpointResult<{
      readonly run: PipelineRun
      readonly conceptSpec: ConceptSpec
      readonly simulationVersionId: string
      readonly transition: { readonly from: 'compiling'; readonly to: 'generating' }
    }>
  > {
    const snapshot = this.database.conceptReviews.snapshot(input.runId)
    if (!snapshot.ok) return snapshot
    const { review, run } = snapshot.value
    if (
      run.state !== 'compiling' ||
      run.revision !== input.expectedRunRevision ||
      review.revision !== input.expectedReviewRevision ||
      review.status !== 'pending' ||
      review.conceptHash !== input.expectedConceptHash
    ) {
      return error('conflict', 'Generation review changed concurrently.')
    }
    const loaded = await this.#loadConcept(review)
    if (!loaded.ok) return loaded
    const conceptRecord = this.database.records.getConceptSpec(review.conceptSpecId)
    if (!conceptRecord.ok) return conceptRecord
    const attempts = this.database.generation.attempts(run.id)
    if (!attempts.ok) return attempts
    const confirmed = this.database.generation.settleConcept({
      decision: 'accept',
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      expectedReviewRevision: input.expectedReviewRevision,
      expectedConceptHash: input.expectedConceptHash,
      at: this.now(),
    })
    if (!confirmed.ok) return confirmed
    this.artifacts.restoreConcept({
      runId: run.id,
      conceptSpecId: review.conceptSpecId,
      artifactId: conceptRecord.value.artifact.artifactId,
      hash: review.conceptHash,
    })
    return {
      ok: true,
      value: {
        run: toPipelineRun(confirmed.value, attempts.value.length),
        conceptSpec: loaded.value,
        simulationVersionId: confirmed.value.simulationVersionId,
        transition: { from: 'compiling', to: 'generating' },
      },
    }
  }

  cancel(input: {
    readonly runId: string
    readonly expectedRunRevision: number
    readonly expectedReviewRevision?: number
  }): CheckpointResult<{
    readonly cancellationRequestedAt: string | null
    readonly updatedAt: string
    readonly simulationVersionId: string
    readonly transition: { readonly from: PipelineRun['state']; readonly to: 'cancelled' }
  }> {
    const current = this.database.generation.get(input.runId)
    if (!current.ok) return current
    const cancelled = this.database.generation.settleConcept({
      decision: 'cancel',
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      ...(input.expectedReviewRevision === undefined
        ? {}
        : { expectedReviewRevision: input.expectedReviewRevision }),
      at: this.now(),
    })
    return cancelled.ok
      ? {
          ok: true,
          value: {
            cancellationRequestedAt: cancelled.value.cancellationRequestedAt,
            updatedAt: cancelled.value.updatedAt,
            simulationVersionId: cancelled.value.simulationVersionId,
            transition: { from: current.value.state, to: 'cancelled' },
          },
        }
      : cancelled
  }

  failInvariant(runId: string): CheckpointResult<
    | {
        readonly simulationVersionId: string
        readonly transition: {
          readonly from: PipelineRun['state']
          readonly to: 'invariant_failed'
        }
      }
    | undefined
  > {
    const run = this.database.generation.get(runId)
    if (!run.ok) return run
    if (run.value.completedAt !== null) return { ok: true, value: undefined }
    const failed = this.database.generation.settleConcept({
      decision: 'invariant-failure',
      runId,
      expectedRunRevision: run.value.revision,
      at: this.now(),
    })
    return failed.ok
      ? {
          ok: true,
          value: {
            simulationVersionId: failed.value.simulationVersionId,
            transition: { from: run.value.state, to: 'invariant_failed' },
          },
        }
      : failed
  }

  async status(runId: string): Promise<CheckpointResult<GenerationStatus>> {
    const run = this.database.generation.get(runId)
    if (!run.ok) return run
    const attempts = this.database.generation.attempts(runId)
    if (!attempts.ok) return attempts
    const history = this.database.generation.history(runId)
    if (!history.ok) return history
    const reviewResult = this.database.conceptReviews.forRun(runId)
    const review = reviewResult.ok ? reviewResult.value : undefined
    const concept = review === undefined ? undefined : await this.#loadConcept(review)
    if (concept !== undefined && !concept.ok) return concept
    const awaiting = run.value.state === 'compiling' && review?.status === 'pending'
    const transitions = publicGenerationHistory(history.value, review)
    const parsed = generationStatusSchema.safeParse({
      runId: run.value.id,
      simulationVersionId: run.value.simulationVersionId,
      state: awaiting ? 'awaiting_confirmation' : run.value.state,
      revision: run.value.revision,
      maxAttempts: run.value.maxAttempts,
      budget: toPipelineRun(run.value, attempts.value.length).budget,
      conceptReview: this.#publicReview(review, concept?.ok === true ? concept.value : undefined),
      cancellationRequestedAt: run.value.cancellationRequestedAt,
      error: publicGenerationError(run.value),
      attempts: attempts.value.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        kind: attempt.attemptNumber === 1 ? 'generation' : 'repair',
        outcome: attempt.outcome,
        artifactHash: attempt.artifactHash,
        verificationRunId: attempt.verificationRunId,
        stableErrorId: attempt.stableErrorId,
        createdAt: attempt.createdAt,
        completedAt: attempt.completedAt,
      })),
      transitions,
      createdAt: run.value.createdAt,
      updatedAt: run.value.updatedAt,
      completedAt: run.value.completedAt,
    })
    return parsed.success
      ? { ok: true, value: parsed.data }
      : error('database-error', 'Generation status evidence is invalid.')
  }

  async #loadConcept(review: DurableConceptReview): Promise<CheckpointResult<ConceptSpec>> {
    const stored = await this.store.get(review.conceptHash)
    if (!stored.ok) return error('corrupt-artifact', 'Concept checkpoint is unavailable.')
    try {
      const parsed = conceptSpecSchema.safeParse(JSON.parse(stored.value.toString('utf8')))
      return parsed.success
        ? { ok: true, value: parsed.data }
        : error('corrupt-artifact', 'Concept checkpoint is invalid.')
    } catch {
      return error('corrupt-artifact', 'Concept checkpoint is invalid.')
    }
  }

  #publicReview(review: DurableConceptReview | undefined, concept: ConceptSpec | undefined) {
    if (review === undefined || concept === undefined) return { status: 'not-ready' as const }
    if (review.status === 'pending') {
      return {
        status: 'pending' as const,
        reviewRevision: review.revision,
        conceptSpec: concept,
        conceptSpecHash: review.conceptHash,
      }
    }
    if (review.status === 'confirmed') {
      return {
        status: 'accepted' as const,
        reviewRevision: review.revision,
        conceptSpec: concept,
        conceptSpecHash: review.conceptHash,
        acceptedAt: review.resolvedAt,
      }
    }
    return {
      status: 'declined' as const,
      reviewRevision: review.revision,
      conceptSpecHash: review.conceptHash,
      declinedAt: review.resolvedAt,
    }
  }
}
