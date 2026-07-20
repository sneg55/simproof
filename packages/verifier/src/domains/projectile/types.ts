import type {
  ProjectileInput,
  ProjectileObservation,
  VerificationFinding,
} from '@simproof/contracts'

export interface ProjectileUnits {
  readonly initialSpeed: string
  readonly launchAngle: string
  readonly range: string
  readonly height: string
  readonly time: string
  readonly speed: string
}

export interface ProjectileVerificationBatch {
  readonly units: ProjectileUnits
  readonly observations: readonly ProjectileObservation[]
}

export interface ProjectileBoundaryError {
  readonly id: string
  readonly message: string
}

export interface ProjectileVerificationResult {
  readonly verdict: 'verified' | 'rejected' | 'inapplicable'
  readonly findings: readonly VerificationFinding[]
  readonly sampleCount: number
}

export interface ProjectileBoundaryFailure {
  readonly ok: false
  readonly error: ProjectileBoundaryError
}

export interface ProjectileScientificOutcome {
  readonly ok: true
  readonly result: ProjectileVerificationResult
}

export type ProjectileVerificationOutcome = ProjectileBoundaryFailure | ProjectileScientificOutcome

export type ProjectileApplicability =
  | { readonly applicable: true }
  | {
      readonly applicable: false
      readonly findingId: string
      readonly reason: string
    }

export type { ProjectileInput, ProjectileObservation }
