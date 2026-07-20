import { conceptSpecSchema, type ProjectileConceptSpec } from '@simproof/contracts'

import { PROJECTILE_POLICY } from './policy.js'

export const PROJECTILE_CONCEPT_ERROR_IDS = Object.freeze({
  invalid: 'projectile.concept.invalid',
  outOfPolicy: 'projectile.concept.out-of-policy',
})

interface ProjectileConceptError {
  readonly id: (typeof PROJECTILE_CONCEPT_ERROR_IDS)[keyof typeof PROJECTILE_CONCEPT_ERROR_IDS]
  readonly message: string
}

export type ProjectileConceptValidation =
  | { readonly ok: true; readonly value: ProjectileConceptSpec }
  | { readonly ok: false; readonly error: ProjectileConceptError }

export function validateProjectileConcept(input: unknown): ProjectileConceptValidation {
  const parsed = conceptSpecSchema.safeParse(input)
  if (!parsed.success || parsed.data.domain !== 'projectile') {
    return {
      ok: false,
      error: {
        id: PROJECTILE_CONCEPT_ERROR_IDS.invalid,
        message: 'Input must be a valid projectile concept specification.',
      },
    }
  }
  const speed = parsed.data.parameters.initialSpeed.requestedRange
  const angle = parsed.data.parameters.launchAngle.requestedRange
  const applicability = PROJECTILE_POLICY.applicability
  if (
    speed.min < applicability.initialSpeedMps.min ||
    speed.max > applicability.initialSpeedMps.max ||
    angle.min < applicability.launchAngleDeg.min ||
    angle.max > applicability.launchAngleDeg.max
  ) {
    return {
      ok: false,
      error: {
        id: PROJECTILE_CONCEPT_ERROR_IDS.outOfPolicy,
        message: 'Requested projectile ranges must remain inside the trusted policy bounds.',
      },
    }
  }
  return { ok: true, value: parsed.data }
}
