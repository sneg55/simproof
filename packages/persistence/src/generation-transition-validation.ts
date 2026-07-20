import { classificationMatches, TERMINAL_STATES } from './generation-state.js'
import type {
  GenerationPipelineState,
  GenerationTerminalClassification,
} from './generation-types.js'
import { validId, validOpaque, validTimestamp } from './generation-validation.js'
import { err, ok, type Result } from './types.js'

interface TransitionMetadataInput {
  readonly runId: string
  readonly expectedRevision: number
  readonly to: GenerationPipelineState
  readonly at: string
  readonly terminalClassification?: GenerationTerminalClassification
  readonly stableErrorId?: string | null
  readonly findingsReference?: string | null
}

interface TransitionMetadata {
  readonly classification: GenerationTerminalClassification | null
  readonly stableErrorId: string | null
  readonly findingsReference: string | null
  readonly completedAt: string | null
}

export function validateTransitionMetadata(
  input: TransitionMetadataInput,
): Result<TransitionMetadata> {
  if (
    !validId(input.runId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    !validTimestamp(input.at)
  ) {
    return err('invalid-input', 'Generation transition is invalid.')
  }
  const classification = input.terminalClassification ?? null
  if (!classificationMatches(input.to, classification)) {
    return err('invalid-input', 'Terminal generation classification does not match its state.')
  }
  const stableErrorId = input.stableErrorId ?? null
  const operational = [
    'provider_failed',
    'runner_failed',
    'budget_exhausted',
    'invariant_failed',
  ].includes(input.to)
  if (
    operational !== (stableErrorId !== null) ||
    (stableErrorId !== null && !validOpaque(stableErrorId))
  ) {
    return err('invalid-input', 'Operational terminal states require a stable error identifier.')
  }
  const findingsReference = input.findingsReference ?? null
  if (
    (input.to === 'rejected') !== (findingsReference !== null) ||
    (findingsReference !== null && !validOpaque(findingsReference))
  ) {
    return err('invalid-input', 'Scientific rejection requires a bounded findings reference.')
  }
  return ok({
    classification,
    stableErrorId,
    findingsReference,
    completedAt: TERMINAL_STATES.has(input.to) ? input.at : null,
  })
}
