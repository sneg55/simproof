import type { MeasuredValue, VerificationFinding } from '@simproof/contracts'
import { pendulumObservationSchema } from '@simproof/contracts'

import {
  PENDULUM_FINDING_IDS,
  PENDULUM_PERIOD_RELATIVE_TOLERANCE,
  PENDULUM_POLICY,
} from './policy.js'
import { isPendulumInputApplicable, pendulumPeriodSeconds, relativeError } from './reference.js'
import type {
  PendulumBoundaryError,
  PendulumCandidateObservation,
  PendulumVerificationOutcome,
} from './types.js'

export const CANONICAL_PENDULUM_UNITS = Object.freeze({
  length: 'm',
  amplitude: 'deg',
  period: 's',
} as const)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

const boundaryFailure = (error: PendulumBoundaryError): PendulumVerificationOutcome => ({
  ok: false,
  error,
})

const inputsFor = (observation: PendulumCandidateObservation) => ({
  length: { value: observation.input.lengthM, unit: 'm' },
  amplitude: { value: observation.input.amplitudeDeg, unit: 'deg' },
})

const parseCandidateRoot = (
  candidate: unknown,
):
  | { readonly units: Record<string, unknown>; readonly observations: readonly unknown[] }
  | undefined => {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['domain', 'units', 'observations'])) {
    return undefined
  }
  if (
    candidate.domain !== 'pendulum' ||
    !isRecord(candidate.units) ||
    !Array.isArray(candidate.observations) ||
    candidate.observations.length === 0 ||
    candidate.observations.length > 1_000
  ) {
    return undefined
  }
  return { units: candidate.units, observations: candidate.observations }
}

const unitsAreCanonical = (units: Record<string, unknown>): boolean =>
  hasOnlyKeys(units, ['length', 'amplitude', 'period']) &&
  units.length === CANONICAL_PENDULUM_UNITS.length &&
  units.amplitude === CANONICAL_PENDULUM_UNITS.amplitude &&
  units.period === CANONICAL_PENDULUM_UNITS.period

const parseObservation = (
  value: unknown,
  observationIndex: number,
): PendulumCandidateObservation | PendulumBoundaryError => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['input', 'periodS']) || !isRecord(value.input)) {
    return {
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'The observation shape is invalid.',
      observationIndex,
    }
  }
  const { input } = value
  if (!hasOnlyKeys(input, ['lengthM', 'amplitudeDeg'])) {
    return {
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'The pendulum input shape is invalid.',
      observationIndex,
    }
  }
  const { lengthM, amplitudeDeg } = input
  if (
    typeof lengthM !== 'number' ||
    typeof amplitudeDeg !== 'number' ||
    !Number.isFinite(lengthM) ||
    !Number.isFinite(amplitudeDeg)
  ) {
    return {
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'Pendulum inputs must be finite numbers.',
      observationIndex,
    }
  }
  if (typeof value.periodS !== 'number' || !Number.isFinite(value.periodS)) {
    return {
      id: PENDULUM_FINDING_IDS.nonFiniteOutput,
      message: 'The generated period must be a finite number in seconds.',
      observationIndex,
    }
  }
  if (value.periodS <= 0) {
    return {
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'The generated period must be positive.',
      observationIndex,
    }
  }

  const observation = { input: { lengthM, amplitudeDeg }, periodS: value.periodS }
  if (isPendulumInputApplicable(lengthM, amplitudeDeg)) {
    return pendulumObservationSchema.parse(observation)
  }
  return observation
}

const nearestApplicableBoundary = (
  observation: PendulumCandidateObservation,
): { readonly quantity: 'lengthM' | 'amplitudeDeg'; readonly expected: MeasuredValue } => {
  const { lengthM, amplitudeDeg } = observation.input
  const { applicability } = PENDULUM_POLICY
  if (lengthM < applicability.lengthM.min) {
    return { quantity: 'lengthM', expected: { value: applicability.lengthM.min, unit: 'm' } }
  }
  if (lengthM > applicability.lengthM.max) {
    return { quantity: 'lengthM', expected: { value: applicability.lengthM.max, unit: 'm' } }
  }
  const expectedAmplitude =
    amplitudeDeg <= applicability.amplitudeDeg.minExclusive
      ? applicability.amplitudeDeg.minExclusive
      : applicability.amplitudeDeg.max
  return { quantity: 'amplitudeDeg', expected: { value: expectedAmplitude, unit: 'deg' } }
}

const applicabilityFinding = (observation: PendulumCandidateObservation): VerificationFinding => {
  const boundary = nearestApplicableBoundary(observation)
  const actual =
    boundary.quantity === 'lengthM'
      ? { value: observation.input.lengthM, unit: 'm' }
      : { value: observation.input.amplitudeDeg, unit: 'deg' }
  return {
    id: PENDULUM_FINDING_IDS.outsideApplicability,
    category: 'applicability',
    severity: 'error',
    checkId: 'pendulum.period',
    quantity: boundary.quantity,
    inputs: inputsFor(observation),
    expected: boundary.expected,
    actual,
    tolerance: {
      mode: 'property',
      expected: boundary.expected,
      allowedError: { value: 0, unit: boundary.expected.unit },
    },
    error: {
      mode: 'absolute',
      value: Math.abs(actual.value - boundary.expected.value),
      unit: boundary.expected.unit,
    },
    explanation: 'The input is outside the trusted small-angle pendulum policy.',
  }
}

const periodFinding = (
  observation: PendulumCandidateObservation,
): VerificationFinding | undefined => {
  const expected = pendulumPeriodSeconds(observation.input.lengthM)
  const error = relativeError(observation.periodS, expected)
  if (error <= PENDULUM_PERIOD_RELATIVE_TOLERANCE) return undefined
  return {
    id: PENDULUM_FINDING_IDS.periodRelativeError,
    category: 'mismatch',
    severity: 'error',
    checkId: 'pendulum.period',
    quantity: 'periodS',
    inputs: inputsFor(observation),
    expected: { value: expected, unit: 's' },
    actual: { value: observation.periodS, unit: 's' },
    tolerance: PENDULUM_POLICY.tolerances.periodS,
    error: { mode: 'relative', value: error },
    explanation: 'The generated period exceeds the accepted relative error.',
  }
}

const sameInput = (
  left: PendulumCandidateObservation['input'],
  right: PendulumCandidateObservation['input'],
): boolean => left.lengthM === right.lengthM && left.amplitudeDeg === right.amplitudeDeg

const consumesExactSamplingGrid = (
  observations: readonly PendulumCandidateObservation[],
): boolean =>
  observations.length === PENDULUM_POLICY.sampling.cases.length &&
  PENDULUM_POLICY.sampling.cases.every(
    (expected) => observations.filter(({ input }) => sameInput(input, expected)).length === 1,
  )

export const verifyPendulumCandidate = (candidate: unknown): PendulumVerificationOutcome => {
  const root = parseCandidateRoot(candidate)
  if (root === undefined) {
    return boundaryFailure({
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'The candidate shape is invalid.',
    })
  }
  if (!unitsAreCanonical(root.units)) {
    return boundaryFailure({
      id: PENDULUM_FINDING_IDS.invalidUnits,
      message: 'Pendulum observations must use m, deg, and s.',
    })
  }

  const observations: PendulumCandidateObservation[] = []
  for (const [index, value] of root.observations.entries()) {
    const parsed = parseObservation(value, index)
    if ('id' in parsed) return boundaryFailure(parsed)
    observations.push(parsed)
  }

  const applicabilityFindings = observations
    .filter(({ input }) => !isPendulumInputApplicable(input.lengthM, input.amplitudeDeg))
    .map(applicabilityFinding)
  if (applicabilityFindings.length > 0) {
    return {
      ok: true,
      result: {
        verdict: 'inapplicable',
        findings: applicabilityFindings,
        sampleCount: observations.length,
      },
    }
  }
  if (!consumesExactSamplingGrid(observations)) {
    return boundaryFailure({
      id: PENDULUM_FINDING_IDS.invalidCandidate,
      message: 'Runner output must contain the exact verifier-requested pendulum sampling grid.',
    })
  }

  const findings = observations.flatMap((observation) => {
    const finding = periodFinding(observation)
    return finding === undefined ? [] : [finding]
  })
  return {
    ok: true,
    result: {
      verdict: findings.length === 0 ? 'verified' : 'rejected',
      findings,
      sampleCount: observations.length,
    },
  }
}
