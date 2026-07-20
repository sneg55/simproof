import {
  type Correlation,
  type CorrelationContext,
  type LocalMetrics,
  type OperationalErrorId,
  operationalErrorIdSchema,
  type StructuredLogger,
} from '@simproof/observability'

import type {
  GenerationSignals,
  PipelineRun,
  VerificationCompletionSignal,
} from './pipeline-types.js'

interface GenerationObservabilityOptions {
  readonly context: CorrelationContext
  readonly logger: StructuredLogger
  readonly metrics: LocalMetrics
}

const providerClassification = (errorId: OperationalErrorId) => {
  if (errorId === 'generation.cancelled') return 'cancellation' as const
  if (errorId === 'provider.authentication-failed') return 'authentication' as const
  if (errorId === 'provider.quota-exceeded') return 'quota' as const
  if (errorId === 'provider.malformed-response') return 'malformed-response' as const
  return 'transient' as const
}

const runnerClassification = (errorId: OperationalErrorId) => {
  if (errorId.startsWith('runner.denied.') || errorId === 'runner.policy-denied') {
    return 'policy-denied' as const
  }
  if (errorId.startsWith('runner.limit.') || errorId === 'runner.resource-limit') {
    return 'resource-limit' as const
  }
  if (errorId.startsWith('runner.artifact.')) return 'invalid-artifact' as const
  if (errorId === 'runner.cancelled') return 'cancelled' as const
  if (errorId.startsWith('runner.runtime.')) return 'runtime-error' as const
  return 'internal-error' as const
}

const rejectedResource = (errorId: OperationalErrorId) => {
  if (errorId === 'runner.limit.memory') return 'memory' as const
  if (errorId === 'runner.limit.output' || errorId === 'runner.limit.samples') {
    return 'output' as const
  }
  if (errorId === 'runner.limit.processes') return 'processes' as const
  if (errorId === 'runner.limit.timeout') return 'wall-time' as const
  return undefined
}

type LoggerInput = Parameters<StructuredLogger['emit']>[0]
interface Emission {
  readonly component: LoggerInput['component']
  readonly event: LoggerInput['event']
  readonly patch?: Partial<Correlation>
  readonly attributes?: LoggerInput['attributes']
  readonly errorId?: OperationalErrorId
  readonly severity?: LoggerInput['severity']
}

export class GenerationObservability implements GenerationSignals {
  readonly #context: CorrelationContext
  readonly #logger: StructuredLogger
  readonly #metrics: LocalMetrics

  constructor(options: GenerationObservabilityOptions) {
    this.#context = options.context
    this.#logger = options.logger
    this.#metrics = options.metrics
  }

  withRun<Result>(
    runId: string,
    simulationId: string | undefined,
    operation: () => Result,
  ): Result {
    const patch = simulationId === undefined ? { runId } : { runId, simulationId }
    return this.#context.rebind(this.#context.enrich(patch), operation)
  }

  withAttempt<Result>(runId: string, attemptId: string, operation: () => Result): Result {
    return this.#context.rebind(this.#context.enrich({ runId, attemptId }), operation)
  }

  accepted(
    runId: string,
    simulationId: string,
    initialState: PipelineRun['state'] = 'queued',
  ): void {
    this.#metrics.record({ kind: 'transition', from: null, to: initialState })
    this.#emit({
      component: 'orchestrator',
      event: 'generation.accepted',
      patch: { runId, simulationId },
    })
  }

  transition(runId: string, from: PipelineRun['state'], to: PipelineRun['state']): void {
    this.#metrics.record({ kind: 'transition', from, to })
    const attributes = { fromState: from, toState: to }
    this.#emit({
      component: 'orchestrator',
      event: 'generation.transition',
      patch: { runId },
      attributes,
    })
    this.#emit({
      component: 'persistence',
      event: 'generation.transition.persisted',
      patch: { runId },
      attributes,
    })
  }

  runFailed(runId: string, detail: string): void {
    this.#emit({
      component: 'orchestrator',
      event: 'generation.run.failed',
      patch: { runId },
      attributes: { failureClass: 'internal-error', detail },
      errorId: 'orchestration.invariant-failed',
      severity: 'error',
    })
  }

  attemptStarted(runId: string, attemptId: string, attemptNumber: number): void {
    this.#metrics.record({
      kind: 'attempt',
      attemptNumber,
      attemptKind: attemptNumber === 1 ? 'generation' : 'repair',
    })
    this.#emit({
      component: 'persistence',
      event: 'generation.attempt.started',
      patch: { runId, attemptId },
      attributes: { attemptNumber },
    })
  }

  providerCompleted(
    operation: 'concept-compile' | 'code-generate' | 'code-repair',
    errorId?: string,
  ): void {
    const parsed = errorId === undefined ? undefined : operationalErrorIdSchema.safeParse(errorId)
    const registered = parsed?.success === true ? parsed.data : undefined
    if (registered !== undefined) {
      this.#metrics.record({
        kind: 'provider-error',
        classification: providerClassification(registered),
      })
    }
    this.#emit({
      component: 'provider',
      event: 'provider.call.completed',
      attributes: { operation },
      ...(registered === undefined ? {} : { errorId: registered, severity: 'warn' }),
    })
  }

  runnerCompleted(errorId?: string): void {
    const parsed = errorId === undefined ? undefined : operationalErrorIdSchema.safeParse(errorId)
    const registered = parsed?.success === true ? parsed.data : undefined
    if (registered !== undefined) {
      this.#metrics.record({
        kind: 'runner-error',
        classification: runnerClassification(registered),
      })
      const resource = rejectedResource(registered)
      if (resource !== undefined) this.#metrics.record({ kind: 'resource-rejection', resource })
    }
    this.#emit({
      component: 'runner-client',
      event: 'runner.execution.completed',
      ...(registered === undefined ? {} : { errorId: registered, severity: 'warn' }),
    })
  }

  verificationCompleted(result: VerificationCompletionSignal): void {
    if ('errorId' in result) {
      this.#emit({
        component: 'verifier',
        event: 'verification.completed',
        errorId: result.errorId,
        severity: 'error',
      })
      return
    }
    this.#metrics.record({ kind: 'verdict', verdict: result.verdict })
    const rejected = result.verdict === 'rejected'
    this.#emit({
      component: 'verifier',
      event: 'verification.completed',
      attributes: {
        verdict: result.verdict,
        ...(rejected ? { failureClass: 'scientific-rejection' as const } : {}),
      },
      ...(rejected
        ? { errorId: 'verifier.scientific-rejection' as const, severity: 'warn' as const }
        : {}),
    })
  }

  queueDepth(depth: number): void {
    this.#metrics.record({ kind: 'queue-depth', depth })
  }

  #emit(input: Emission): void {
    const current = this.#context.current()
    const correlation = input.patch === undefined ? current : this.#context.enrich(input.patch)
    this.#logger.emit({
      severity: input.severity ?? 'info',
      component: input.component,
      event: input.event,
      ...(correlation === undefined ? {} : { correlation }),
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
      ...(input.errorId === undefined ? {} : { errorId: input.errorId }),
    })
  }
}
