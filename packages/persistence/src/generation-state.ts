import { isGenerationTransitionAllowed, terminalGenerationStates } from '@simproof/contracts'

import type {
  GenerationPipelineState,
  GenerationTerminalClassification,
} from './generation-types.js'

export const TERMINAL_STATES = new Set<GenerationPipelineState>(terminalGenerationStates)
export const transitionAllowed = isGenerationTransitionAllowed

const CLASSIFICATION_BY_STATE = new Map<
  GenerationPipelineState,
  readonly GenerationTerminalClassification[]
>([
  ['verified', ['verified']],
  ['rejected', ['scientific_rejection']],
  ['cancelled', ['cancelled']],
  ['provider_failed', ['provider_failure']],
  ['runner_failed', ['runner_failure']],
  ['budget_exhausted', ['budget_exhaustion']],
  ['invariant_failed', ['invariant_failure']],
])

export function classificationMatches(
  state: GenerationPipelineState,
  classification: GenerationTerminalClassification | null,
): boolean {
  const allowed = CLASSIFICATION_BY_STATE.get(state)
  return allowed === undefined
    ? classification === null
    : classification !== null && allowed.includes(classification)
}
