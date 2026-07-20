import type { SimulationLifecycleState } from '@simproof/contracts'

import type { Result } from './types.js'
import { err, ok } from './types.js'

const NONE: readonly SimulationLifecycleState[] = []

function transitionsFrom(from: SimulationLifecycleState): readonly SimulationLifecycleState[] {
  switch (from) {
    case 'draft':
      return ['generating', 'archived']
    case 'generating':
      return ['verifying', 'draft', 'archived']
    case 'verifying':
      return ['verified', 'rejected', 'stale', 'archived']
    case 'rejected':
      return ['generating', 'archived']
    case 'verified':
      return ['published', 'stale', 'archived']
    case 'published':
      return ['stale', 'archived']
    case 'stale':
      return ['generating', 'verifying', 'archived']
    case 'archived':
      return NONE
  }
}

export function validateTransition(
  from: SimulationLifecycleState,
  to: SimulationLifecycleState,
): Result<true> {
  return transitionsFrom(from).includes(to)
    ? ok(true)
    : err('invalid-transition', `Lifecycle transition ${from} -> ${to} is not allowed.`)
}

export function allowedTransitions(
  from: SimulationLifecycleState,
): readonly SimulationLifecycleState[] {
  return transitionsFrom(from)
}
