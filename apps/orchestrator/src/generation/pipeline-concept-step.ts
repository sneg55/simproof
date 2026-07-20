import type { ConceptSpec } from '@simproof/contracts'

import { canStartProviderTurn } from './budget.js'
import {
  budgetFailure,
  callOptions,
  providerTerminal,
  providerUsageWithinReservation,
  type TerminalState,
} from './pipeline-attempt-support.js'
import type { AttemptCompletion, PipelineDependencies, PipelineRun } from './pipeline-types.js'

export type ConceptStepResult =
  | { readonly ok: true; readonly run: PipelineRun; readonly conceptSpec: ConceptSpec }
  | {
      readonly ok: false
      readonly run: PipelineRun
      readonly state: TerminalState
      readonly details?: AttemptCompletion
    }

const isAborted = (signal?: AbortSignal) => signal?.aborted === true

export async function compileConcept(options: {
  readonly run: PipelineRun
  readonly prompt: string
  readonly dependencies: PipelineDependencies
  readonly signal?: AbortSignal
}): Promise<ConceptStepResult> {
  if (!canStartProviderTurn(options.run.budget)) return exhausted(options.run)
  const compiler = options.dependencies.conceptCompiler
  const reserved = await options.dependencies.journal.reserveProviderCall({
    run: options.run,
    operation: 'concept_compile',
    provider: compiler.descriptor,
    reservation: compiler.compileReservation,
    artifactBytes: 0,
    at: options.dependencies.now(),
  })
  if (!reserved.ok) return exhausted(options.run)
  let compilation
  try {
    compilation = await compiler.compile({ prompt: options.prompt }, callOptions(options.signal))
  } catch {
    if (isAborted(options.signal)) {
      options.dependencies.signals?.providerCompleted('concept-compile', 'generation.cancelled')
      return { ok: false, run: reserved.run, state: 'cancelled' }
    }
    options.dependencies.signals?.providerCompleted('concept-compile', 'provider.transient-failure')
    return {
      ok: false,
      run: reserved.run,
      state: 'provider_failed',
      details: { stableErrorId: 'provider.transient-failure' },
    }
  }
  if (!compilation.ok) {
    const run =
      compilation.metering.usage.requestCount > 0
        ? await options.dependencies.journal.recordProviderFailure({
            run: reserved.run,
            reservationId: reserved.reservationId,
            operation: 'concept_compile',
            metering: compilation.metering,
            stableErrorId: compilation.error.stableErrorId,
            at: options.dependencies.now(),
          })
        : await options.dependencies.journal.releaseProviderReservation({
            run: reserved.run,
            reservationId: reserved.reservationId,
            at: options.dependencies.now(),
          })
    options.dependencies.signals?.providerCompleted(
      'concept-compile',
      compilation.error.stableErrorId,
    )
    return !providerUsageWithinReservation(compiler.compileReservation, compilation.metering)
      ? exhausted(run)
      : {
          ok: false,
          run,
          state: providerTerminal(compilation.error),
          details: { stableErrorId: compilation.error.stableErrorId },
        }
  }
  const run = await options.dependencies.journal.recordProviderCall({
    run: reserved.run,
    reservationId: reserved.reservationId,
    operation: 'concept_compile',
    provenance: compilation.value.provenance,
    artifactBytes: 0,
    at: options.dependencies.now(),
  })
  options.dependencies.signals?.providerCompleted('concept-compile')
  return providerUsageWithinReservation(compiler.compileReservation, compilation.value.provenance)
    ? { ok: true, run, conceptSpec: compilation.value.conceptSpec }
    : exhausted(run)
}

function exhausted(run: PipelineRun): ConceptStepResult {
  return { ok: false, run, state: 'budget_exhausted', details: budgetFailure }
}
