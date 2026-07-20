import {
  type CancellationAccepted,
  type ConceptReviewDecision,
  type ConceptSpec,
  type EducatorGenerationStartRequest,
  educatorGenerationStartRequestSchema,
  type GenerationAccepted,
  type GenerationStatus,
} from '@simproof/contracts'
import type { PersistenceError, Result } from '@simproof/persistence'
import type { HttpOperationResult } from '../http/types.js'
import type { ConceptCheckpoint, SplitGenerationPipeline } from './pipeline.js'
import type { GenerationSignals, PipelineRun } from './pipeline-types.js'

interface PersistedCheckpointTransition {
  readonly simulationVersionId: string
  readonly transition: {
    readonly from: PipelineRun['state']
    readonly to: PipelineRun['state']
  }
}

export interface GenerationCheckpointPort {
  readonly create: (checkpoint: ConceptCheckpoint) => Result<unknown>
  readonly confirmed: (input: {
    readonly runId: string
    readonly expectedRunRevision: number
    readonly expectedReviewRevision: number
    readonly expectedConceptHash: string
  }) => Promise<
    Result<{
      readonly run: PipelineRun
      readonly conceptSpec: ConceptSpec
      readonly simulationVersionId: string
      readonly transition: PersistedCheckpointTransition['transition']
    }>
  >
  readonly cancel: (input: {
    readonly runId: string
    readonly expectedRunRevision: number
    readonly expectedReviewRevision?: number
  }) => Result<{
    readonly cancellationRequestedAt: string | null
    readonly updatedAt: string
    readonly simulationVersionId: string
    readonly transition: PersistedCheckpointTransition['transition']
  }>
  readonly failInvariant: (runId: string) => Result<PersistedCheckpointTransition | undefined>
  readonly status: (runId: string) => Promise<Result<GenerationStatus>>
}

interface ActiveOperation {
  readonly controller: AbortController
  readonly promise: Promise<void>
}

export interface DurableGenerationCoordinatorOptions {
  readonly pipeline: SplitGenerationPipeline
  readonly checkpoints: GenerationCheckpointPort
  readonly recordPromptDecision: (
    request: EducatorGenerationStartRequest,
    runId: string,
  ) => Promise<void> | void
  readonly signals?: GenerationSignals
}

const failure = (
  code: 'conflict' | 'invalid-input' | 'operation-failed',
  message: string,
): HttpOperationResult<never> => ({ ok: false, error: { code, message } })
const SERVICE_UNAVAILABLE = 'Generation service is unavailable.'
const OPERATION_FAILED = 'operation-failed' as const

// Derive a bounded lowercase identifier from an unexpected failure so it can be
// carried on an operational signal (a released reservation code, a journal error
// code, or an error name). Never throws: always returns a valid bounded id.
const failureDetail = (error: unknown): string => {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  const source =
    typeof record?.code === 'string'
      ? record.code
      : typeof record?.name === 'string'
        ? record.name
        : 'error'
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 90)
    .replace(/^-+|-+$/gu, '')
  return slug.length > 0 ? `run.${slug}` : 'run.error'
}

export class DurableGenerationCoordinator {
  readonly #pipeline: SplitGenerationPipeline
  readonly #checkpoints: GenerationCheckpointPort
  readonly #recordPromptDecision: DurableGenerationCoordinatorOptions['recordPromptDecision']
  readonly #signals: GenerationSignals | undefined
  readonly #active = new Map<string, ActiveOperation>()
  #closed = false

  constructor(options: DurableGenerationCoordinatorOptions) {
    this.#pipeline = options.pipeline
    this.#checkpoints = options.checkpoints
    this.#recordPromptDecision = options.recordPromptDecision
    this.#signals = options.signals
  }

  async start(input: unknown): Promise<HttpOperationResult<GenerationAccepted>> {
    if (this.#closed) return failure(OPERATION_FAILED, SERVICE_UNAVAILABLE)
    const parsed = educatorGenerationStartRequestSchema.safeParse(input)
    if (!parsed.success) return failure('invalid-input', 'Generation request is invalid.')
    const request = parsed.data
    try {
      const accepted = await this.#pipeline.accept(
        {
          schemaVersion: '1',
          simulationVersionId: request.simulationVersionId,
          idempotencyKey: request.idempotencyKey,
          prompt: request.teacher.prompt,
          maxAttempts: request.maxAttempts,
          budget: request.budget,
        },
        { expectedVersionRevision: request.expectedVersionRevision },
      )
      if (accepted.created) {
        try {
          await this.#recordPromptDecision(request, accepted.run.id)
        } catch (error) {
          this.#failScheduled(accepted.run.id, error)
          return failure(OPERATION_FAILED, 'Generation could not be accepted.')
        }
        this.#schedule(accepted.run.id, request.simulationVersionId, async (signal) => {
          const compiled = await this.#pipeline.compileAccepted(
            accepted.request,
            accepted.run,
            signal,
          )
          if ('conceptSpec' in compiled) {
            const stored = this.#checkpoints.create(compiled)
            if (!stored.ok) this.#failScheduled(compiled.run.id, stored.error)
          }
        })
      }
      if (!accepted.created) {
        const replay = await this.#checkpoints.status(accepted.run.id)
        if (!replay.ok) return this.#persistenceFailure(replay.error.code)
        return {
          ok: true,
          value: {
            runId: accepted.run.id,
            created: false,
            state: replay.value.state,
            revision: replay.value.revision,
          },
        }
      }
      return {
        ok: true,
        value: {
          runId: accepted.run.id,
          created: true,
          state: 'queued',
          revision: accepted.run.revision,
        },
      }
    } catch {
      return failure(OPERATION_FAILED, 'Generation could not be accepted.')
    }
  }

  status(runId: string): Promise<HttpOperationResult<GenerationStatus>> {
    return this.#publicStatus(runId)
  }

  async decide(
    runId: string,
    input: ConceptReviewDecision,
  ): Promise<HttpOperationResult<GenerationStatus>> {
    if (this.#closed) return failure(OPERATION_FAILED, SERVICE_UNAVAILABLE)
    if (input.decision === 'decline') {
      const cancelled = this.#checkpoints.cancel({
        runId,
        expectedRunRevision: input.expectedRunRevision,
        expectedReviewRevision: input.expectedReviewRevision,
      })
      if (!cancelled.ok) return this.#persistenceFailure(cancelled.error.code)
      this.#emitCheckpointTransition(runId, cancelled.value)
      this.#active.get(runId)?.controller.abort()
      return await this.#publicStatus(runId)
    }
    const confirmed = await this.#checkpoints.confirmed({
      runId,
      expectedRunRevision: input.expectedRunRevision,
      expectedReviewRevision: input.expectedReviewRevision,
      expectedConceptHash: input.conceptSpecHash,
    })
    if (!confirmed.ok) return this.#persistenceFailure(confirmed.error.code)
    this.#emitCheckpointTransition(runId, confirmed.value)
    this.#schedule(runId, confirmed.value.simulationVersionId, async (signal) => {
      await this.#pipeline.continueConfirmed(
        confirmed.value.run,
        confirmed.value.conceptSpec,
        signal,
      )
    })
    return await this.#publicStatus(runId)
  }

  cancel(
    runId: string,
    expectedRunRevision: number,
  ): Promise<HttpOperationResult<CancellationAccepted>> {
    const cancelled = this.#checkpoints.cancel({ runId, expectedRunRevision })
    if (!cancelled.ok) return Promise.resolve(this.#persistenceFailure(cancelled.error.code))
    this.#emitCheckpointTransition(runId, cancelled.value)
    this.#active.get(runId)?.controller.abort()
    return Promise.resolve({
      ok: true,
      value: {
        runId,
        cancellationRequestedAt:
          cancelled.value.cancellationRequestedAt ?? cancelled.value.updatedAt,
      },
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const operations = [...this.#active.values()]
    for (const operation of operations) operation.controller.abort()
    await Promise.allSettled(operations.map(({ promise }) => promise))
  }

  #schedule(
    runId: string,
    simulationId: string | undefined,
    operation: (signal: AbortSignal) => Promise<void>,
  ): void {
    if (this.#active.has(runId)) return
    const controller = new AbortController()
    const promise = new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
      .then(async () => {
        if (this.#signals === undefined) return await operation(controller.signal)
        return await this.#signals.withRun(runId, simulationId, async () => {
          await operation(controller.signal)
        })
      })
      .catch((error) => this.#failScheduled(runId, error))
      .finally(() => {
        if (this.#active.get(runId)?.controller === controller) this.#active.delete(runId)
        this.#signals?.queueDepth(this.#active.size)
      })
    this.#active.set(runId, { controller, promise })
    this.#signals?.queueDepth(this.#active.size)
  }

  async #publicStatus(runId: string): Promise<HttpOperationResult<GenerationStatus>> {
    const status = await this.#checkpoints.status(runId)
    return status.ok ? status : this.#persistenceFailure(status.error.code)
  }

  #emitCheckpointTransition(runId: string, checkpoint: PersistedCheckpointTransition): void {
    this.#signals?.withRun(runId, checkpoint.simulationVersionId, () => {
      this.#signals?.transition(runId, checkpoint.transition.from, checkpoint.transition.to)
    })
  }

  #failScheduled(runId: string, error: unknown): void {
    this.#signals?.runFailed(runId, failureDetail(error))
    this.#failInvariant(runId)
  }

  #failInvariant(runId: string): void {
    const failed = this.#checkpoints.failInvariant(runId)
    if (!failed.ok || failed.value === undefined) return
    this.#emitCheckpointTransition(runId, failed.value)
  }

  #persistenceFailure(code: PersistenceError['code']): HttpOperationResult<never> {
    return code === 'conflict'
      ? failure('conflict', 'Generation changed concurrently.')
      : code === 'invalid-input'
        ? failure('invalid-input', 'Generation input is invalid.')
        : failure(OPERATION_FAILED, 'Generation operation failed.')
  }
}
