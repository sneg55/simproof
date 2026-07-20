import type { GenerationStatus } from '@simproof/contracts'
import type { GenerationPipelineRun } from '@simproof/persistence'

const providerErrors = {
  'provider.authentication-failed': {
    category: 'authentication',
    stableErrorId: 'provider.authentication-failed',
    retryable: false,
  },
  'provider.quota-exceeded': {
    category: 'quota',
    stableErrorId: 'provider.quota-exceeded',
    retryable: false,
  },
  'provider.transient-failure': {
    category: 'transient',
    stableErrorId: 'provider.transient-failure',
    retryable: true,
  },
  'provider.malformed-response': {
    category: 'malformed-response',
    stableErrorId: 'provider.malformed-response',
    retryable: false,
  },
} as const

function providerError(stableErrorId: string | null): GenerationStatus['error'] {
  if (stableErrorId !== null && stableErrorId in providerErrors) {
    return providerErrors[stableErrorId as keyof typeof providerErrors]
  }
  return providerErrors['provider.transient-failure']
}

// eslint-disable-next-line complexity -- Exhaustive terminal-state redaction keeps public error mapping auditable.
export function publicGenerationError(run: GenerationPipelineRun): GenerationStatus['error'] {
  if (run.completedAt === null || run.state === 'verified') return null
  switch (run.state) {
    case 'queued':
    case 'compiling':
    case 'generating':
    case 'executing':
    case 'verifying':
    case 'repairing':
      return null
    case 'cancelled':
      return { category: 'cancellation', stableErrorId: 'generation.cancelled', retryable: false }
    case 'budget_exhausted':
      return { category: 'budget', stableErrorId: 'generation.budget-exhausted', retryable: false }
    case 'runner_failed':
      return {
        category: 'runner',
        stableErrorId: run.stableErrorId ?? 'runner.execution-failed',
        retryable: true,
      }
    case 'rejected':
      return {
        category: 'verifier-rejection',
        stableErrorId: 'verifier.scientific-rejection',
        retryable: false,
      }
    case 'invariant_failed':
      return {
        category: 'invariant',
        stableErrorId: run.stableErrorId ?? 'orchestration.invariant-failed',
        retryable: false,
      }
    case 'provider_failed':
      return providerError(run.stableErrorId)
  }
}
