import type { GenerationError, ProviderProvenance } from '@simproof/contracts'
import type { ProviderCallReservation } from '@simproof/providers'
import type {
  GeneratedArtifactSet,
  PipelineDependencies,
  PipelineRun,
  PipelineRunnerResult,
  ProviderCallMetering,
} from './pipeline-types.js'

export const budgetFailure = { stableErrorId: 'generation.budget-exhausted' } as const
export const invariantFailure = { stableErrorId: 'orchestration.invariant-failed' } as const
export type TerminalState = Exclude<
  PipelineRun['state'],
  'compiling' | 'executing' | 'generating' | 'queued' | 'repairing' | 'verifying'
>
export type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly run: PipelineRun }
export type FailedStep = { readonly ok: false; readonly run: PipelineRun }
export type Execution = Extract<PipelineRunnerResult, { readonly ok: true }>
export type CodeProviderResult = Awaited<
  ReturnType<PipelineDependencies['codeGenerator']['generate']>
>

export const artifactBytes = (artifacts: GeneratedArtifactSet): number =>
  [artifacts.core, artifacts.renderer, artifacts.manifest, artifacts.testAdapter].reduce(
    (total, artifact) => total + new TextEncoder().encode(artifact.content).byteLength,
    0,
  )

export const providerUsageWithinReservation = (
  reservation: ProviderCallReservation,
  provenance: Pick<ProviderProvenance, 'usage'> | ProviderCallMetering,
): boolean =>
  provenance.usage.requestCount <= reservation.requestCount &&
  provenance.usage.inputTokens <= reservation.inputTokens &&
  provenance.usage.outputTokens <= reservation.outputTokens &&
  provenance.usage.costMicrousd <= reservation.costMicrousd

export const providerTerminal = (
  error: GenerationError,
): 'budget_exhausted' | 'cancelled' | 'invariant_failed' | 'provider_failed' => {
  if (error.category === 'cancellation') return 'cancelled'
  if (error.category === 'budget') return 'budget_exhausted'
  if (error.category === 'invariant') return 'invariant_failed'
  return 'provider_failed'
}

export const callOptions = (signal?: AbortSignal) => (signal === undefined ? undefined : { signal })
