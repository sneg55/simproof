import type { ConceptSpec, RunnerDiagnostic, VerificationFinding } from '@simproof/contracts'

import { canStartProviderTurn } from './budget.js'
import {
  artifactBytes,
  budgetFailure,
  type CodeProviderResult,
  callOptions,
  invariantFailure,
  providerTerminal,
  providerUsageWithinReservation,
  type TerminalState,
} from './pipeline-attempt-support.js'
import type {
  AttemptCompletion,
  CodeResult,
  PipelineDependencies,
  PipelineRun,
} from './pipeline-types.js'

export type ProviderStepResult =
  | {
      readonly ok: true
      readonly run: PipelineRun
      readonly code: CodeResult
      readonly generatedArtifactId: string
    }
  | {
      readonly ok: false
      readonly run: PipelineRun
      readonly state: TerminalState
      readonly details?: AttemptCompletion
    }

interface ProviderStepOptions {
  readonly run: PipelineRun
  readonly number: number
  readonly conceptSpec: ConceptSpec
  readonly previous?: CodeResult
  readonly findings: readonly VerificationFinding[]
  readonly diagnostics: readonly RunnerDiagnostic[]
  readonly dependencies: PipelineDependencies
  readonly onThreadAdopted?: (threadId: string) => void
  readonly signal?: AbortSignal
}

interface ReservedStep {
  readonly operation: 'code_generate' | 'code_repair'
  readonly reservation: PipelineDependencies['codeGenerator']['generateReservation']
  readonly artifactBytes: number
  readonly id: string
  readonly run: PipelineRun
}

const signalOperation = (operation: ReservedStep['operation']) =>
  operation === 'code_generate' ? ('code-generate' as const) : ('code-repair' as const)

export async function runProviderStep(options: ProviderStepOptions): Promise<ProviderStepResult> {
  if (!canStartProviderTurn(options.run.budget)) return failed(options.run, 'budget_exhausted')
  if (options.number > 1 && options.previous === undefined) {
    return failed(options.run, 'invariant_failed')
  }
  const reserved = await reserve(options)
  if (reserved === undefined) return failed(options.run, 'budget_exhausted')
  let generated: CodeProviderResult
  try {
    generated = await dispatch(options)
  } catch {
    if (options.signal?.aborted === true) {
      options.dependencies.signals?.providerCompleted(
        signalOperation(reserved.operation),
        'generation.cancelled',
      )
      return failed(reserved.run, 'cancelled')
    }
    options.dependencies.signals?.providerCompleted(
      signalOperation(reserved.operation),
      'provider.transient-failure',
    )
    return failed(reserved.run, 'provider_failed', {
      stableErrorId: 'provider.transient-failure',
    })
  }
  if (generated.ok && generated.value.threadId !== null) {
    options.onThreadAdopted?.(generated.value.threadId)
  }
  return generated.ok
    ? await accept(options, reserved, generated.value)
    : await reject(options, reserved, generated)
}

async function reserve(options: ProviderStepOptions): Promise<ReservedStep | undefined> {
  const operation = options.number === 1 ? 'code_generate' : 'code_repair'
  const reservation =
    options.number === 1
      ? options.dependencies.codeGenerator.generateReservation
      : options.dependencies.codeGenerator.repairReservation
  const artifactReservation =
    options.run.budget.limits.maxArtifactBytes - options.run.budget.consumed.artifactBytes
  if (artifactReservation <= 0) return undefined
  const reserved = await options.dependencies.journal.reserveProviderCall({
    run: options.run,
    operation,
    provider: options.dependencies.codeGenerator.descriptor,
    reservation,
    artifactBytes: artifactReservation,
    at: options.dependencies.now(),
  })
  return reserved.ok
    ? {
        operation,
        reservation,
        artifactBytes: artifactReservation,
        id: reserved.reservationId,
        run: reserved.run,
      }
    : undefined
}

function dispatch(options: ProviderStepOptions): Promise<CodeProviderResult> {
  return options.number === 1
    ? options.dependencies.codeGenerator.generate(
        { conceptSpec: options.conceptSpec },
        callOptions(options.signal),
      )
    : repair(options)
}

async function accept(
  options: ProviderStepOptions,
  reserved: ReservedStep,
  generated: CodeResult,
): Promise<ProviderStepResult> {
  const bytes = artifactBytes(generated.artifacts)
  const run = await options.dependencies.journal.recordProviderCall({
    run: reserved.run,
    reservationId: reserved.id,
    operation: reserved.operation,
    provenance: generated.provenance,
    artifactBytes: bytes,
    at: options.dependencies.now(),
  })
  options.dependencies.signals?.providerCompleted(signalOperation(reserved.operation))
  if (
    !providerUsageWithinReservation(reserved.reservation, generated.provenance) ||
    bytes > reserved.artifactBytes
  ) {
    return failed(run, 'budget_exhausted')
  }
  const stored = await options.dependencies.journal.recordCandidate(
    run,
    options.number,
    generated.artifacts,
    options.dependencies.now(),
  )
  return { ok: true, run, code: generated, ...stored }
}

async function reject(
  options: ProviderStepOptions,
  reserved: ReservedStep,
  generated: Extract<CodeProviderResult, { readonly ok: false }>,
): Promise<ProviderStepResult> {
  const common = {
    run: reserved.run,
    reservationId: reserved.id,
    at: options.dependencies.now(),
  }
  const run =
    generated.metering.usage.requestCount > 0
      ? await options.dependencies.journal.recordProviderFailure({
          ...common,
          operation: reserved.operation,
          metering: generated.metering,
          stableErrorId: generated.error.stableErrorId,
        })
      : await options.dependencies.journal.releaseProviderReservation(common)
  options.dependencies.signals?.providerCompleted(
    signalOperation(reserved.operation),
    generated.error.stableErrorId,
  )
  return !providerUsageWithinReservation(reserved.reservation, generated.metering)
    ? failed(run, 'budget_exhausted')
    : failed(run, providerTerminal(generated.error), {
        stableErrorId: generated.error.stableErrorId,
      })
}

function repair(options: ProviderStepOptions) {
  if (options.previous === undefined) throw new TypeError(invariantFailure.stableErrorId)
  return options.dependencies.codeGenerator.repair(
    {
      conceptSpec: options.conceptSpec,
      previousArtifacts: options.previous.artifacts,
      threadId: options.previous.threadId,
      findings: options.findings,
      diagnostics: options.diagnostics,
    },
    callOptions(options.signal),
  )
}

function failed(
  run: PipelineRun,
  state: TerminalState,
  details?: AttemptCompletion,
): ProviderStepResult {
  const resolved =
    details ??
    (state === 'budget_exhausted'
      ? budgetFailure
      : state === 'invariant_failed'
        ? invariantFailure
        : undefined)
  return resolved === undefined
    ? { ok: false, run, state }
    : { ok: false, run, state, details: resolved }
}
