import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'

import { type Correlation, correlationSchema } from './correlation.js'
import { createOperationalError } from './errors.js'

const correlationPatchSchema = z
  .object({
    requestId: z.uuid().optional(),
    runId: z.uuid().optional(),
    attemptId: z.uuid().optional(),
    simulationId: z.uuid().optional(),
  })
  .strict()

export type CorrelationPatch = z.infer<typeof correlationPatchSchema>

const freezeCorrelation = (correlation: unknown): Correlation =>
  Object.freeze({ ...correlationSchema.parse(correlation) })

const conflicts = (current: Correlation, patch: CorrelationPatch): boolean =>
  (patch.requestId !== undefined &&
    current.requestId !== undefined &&
    patch.requestId !== current.requestId) ||
  (patch.runId !== undefined && current.runId !== undefined && patch.runId !== current.runId) ||
  (patch.attemptId !== undefined &&
    current.attemptId !== undefined &&
    patch.attemptId !== current.attemptId) ||
  (patch.simulationId !== undefined &&
    current.simulationId !== undefined &&
    patch.simulationId !== current.simulationId)

export class CorrelationContext {
  readonly #storage = new AsyncLocalStorage<Correlation>()

  run<Result>(correlation: unknown, operation: () => Result): Result {
    return this.#storage.run(freezeCorrelation(correlation), operation)
  }

  current(): Correlation | undefined {
    return this.#storage.getStore()
  }

  snapshot(): Correlation | undefined {
    const current = this.current()
    return current === undefined ? undefined : freezeCorrelation(current)
  }

  rebind<Result>(snapshot: Correlation, operation: () => Result): Result {
    return this.run(snapshot, operation)
  }

  bind<Arguments extends unknown[], Result>(
    snapshot: Correlation,
    operation: (...args: Arguments) => Result,
  ): (...args: Arguments) => Result {
    const captured = freezeCorrelation(snapshot)
    return (...args: Arguments): Result => this.rebind(captured, () => operation(...args))
  }

  enrich(patchInput: CorrelationPatch): Correlation {
    const patch = correlationPatchSchema.parse(patchInput)
    const current = this.current()
    if (current !== undefined && conflicts(current, patch)) {
      throw createOperationalError('orchestration.invariant-failed', { correlation: current })
    }
    return freezeCorrelation({ ...current, ...patch })
  }
}
