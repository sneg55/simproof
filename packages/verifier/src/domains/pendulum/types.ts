import type { PendulumObservation, VerificationFinding } from '@simproof/contracts'

import type { PendulumFindingId } from './policy.js'

export interface PendulumCandidateUnits {
  readonly length: 'm'
  readonly amplitude: 'deg'
  readonly period: 's'
}

export type PendulumCandidateObservation = Readonly<PendulumObservation>

export interface PendulumCandidate {
  readonly domain: 'pendulum'
  readonly units: PendulumCandidateUnits
  readonly observations: readonly PendulumCandidateObservation[]
}

export interface PendulumVerificationResult {
  readonly verdict: 'verified' | 'rejected' | 'inapplicable'
  readonly findings: readonly VerificationFinding[]
  readonly sampleCount: number
}

export interface PendulumBoundaryError {
  readonly id: Exclude<
    PendulumFindingId,
    'pendulum.input.out-of-domain' | 'pendulum.period.relative-error'
  >
  readonly message: string
  readonly observationIndex?: number
}

export type PendulumVerificationOutcome =
  | Readonly<{ ok: false; error: PendulumBoundaryError }>
  | Readonly<{ ok: true; result: PendulumVerificationResult }>
