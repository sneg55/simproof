import type { PendulumConceptSpec } from '@simproof/contracts'
import { conceptSpecSchema } from '@simproof/contracts'

import { PENDULUM_POLICY } from './policy.js'

export const PENDULUM_CONCEPT_VALIDATION_IDS = Object.freeze({
  invalid: 'pendulum.concept.invalid',
  unsupportedDomain: 'pendulum.concept.unsupported-domain',
  outOfDomain: 'pendulum.concept.out-of-domain',
} as const)

export type PendulumConceptValidationResult =
  | Readonly<{ ok: true; value: PendulumConceptSpec }>
  | Readonly<{
      ok: false
      error: Readonly<{
        id: (typeof PENDULUM_CONCEPT_VALIDATION_IDS)[keyof typeof PENDULUM_CONCEPT_VALIDATION_IDS]
        message: string
      }>
    }>

const isWholeRangeApplicable = (concept: PendulumConceptSpec): boolean => {
  const { length, amplitude } = concept.parameters
  const { applicability } = PENDULUM_POLICY
  return (
    length.requestedRange.min >= applicability.lengthM.min &&
    length.requestedRange.max <= applicability.lengthM.max &&
    amplitude.requestedRange.min > applicability.amplitudeDeg.minExclusive &&
    amplitude.requestedRange.max <= applicability.amplitudeDeg.max
  )
}

export const validatePendulumConcept = (input: unknown): PendulumConceptValidationResult => {
  const parsed = conceptSpecSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        id: PENDULUM_CONCEPT_VALIDATION_IDS.invalid,
        message: 'The concept does not satisfy the strict concept schema.',
      },
    }
  }
  if (parsed.data.domain !== 'pendulum') {
    return {
      ok: false,
      error: {
        id: PENDULUM_CONCEPT_VALIDATION_IDS.unsupportedDomain,
        message: 'The pendulum domain pack accepts only pendulum concepts.',
      },
    }
  }
  if (!isWholeRangeApplicable(parsed.data)) {
    return {
      ok: false,
      error: {
        id: PENDULUM_CONCEPT_VALIDATION_IDS.outOfDomain,
        message: 'The requested pendulum range is outside policy applicability.',
      },
    }
  }
  return { ok: true, value: parsed.data }
}
