import type { GenerationState } from '@simproof/contracts'
import type { GenerationTerminalClassification, Result } from '@simproof/persistence'

export class GenerationJournalError extends TypeError {
  readonly code: string

  constructor(code: string) {
    super('Generation journal operation failed.')
    this.name = 'GenerationJournalError'
    this.code = code
  }
}

export const unwrapJournalResult = <T>(result: Result<T>): T => {
  if (result.ok) return result.value
  throw new GenerationJournalError(result.error.code)
}

export const terminalClassification = (
  state: GenerationState,
): GenerationTerminalClassification | undefined => {
  switch (state) {
    case 'verified':
      return 'verified'
    case 'rejected':
      return 'scientific_rejection'
    case 'provider_failed':
      return 'provider_failure'
    case 'runner_failed':
      return 'runner_failure'
    case 'cancelled':
      return 'cancelled'
    case 'budget_exhausted':
      return 'budget_exhaustion'
    case 'invariant_failed':
      return 'invariant_failure'
    case 'compiling':
    case 'executing':
    case 'generating':
    case 'queued':
    case 'repairing':
    case 'verifying':
      return undefined
  }
}
