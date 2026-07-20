import {
  type ProjectileInput,
  type ProjectileObservation,
  projectileObservationSchema,
  type VerificationFinding,
} from '@simproof/contracts'

import { absoluteFinding, relativeFinding } from './findings.js'
import {
  CANONICAL_PROJECTILE_UNITS,
  PROJECTILE_BOUNDARY_ERROR_IDS,
  PROJECTILE_FINDING_IDS,
  PROJECTILE_MAIN_GRID,
  PROJECTILE_POLICY,
  PROJECTILE_VERIFICATION_INPUTS,
} from './policy.js'
import { projectileReference } from './reference.js'
import { checkTrajectory } from './trajectory.js'
import type {
  ProjectileUnits,
  ProjectileVerificationBatch,
  ProjectileVerificationOutcome,
} from './types.js'

function sameInput(left: ProjectileInput, right: ProjectileInput): boolean {
  return (
    left.initialSpeedMps === right.initialSpeedMps && left.launchAngleDeg === right.launchAngleDeg
  )
}

function hasExactVerificationGrid(observations: readonly ProjectileObservation[]): boolean {
  if (observations.length !== PROJECTILE_VERIFICATION_INPUTS.length) return false
  const matchedInputIndexes = new Set<number>()
  for (const observation of observations) {
    const inputIndex = PROJECTILE_VERIFICATION_INPUTS.findIndex((input) =>
      sameInput(observation.input, input),
    )
    if (inputIndex === -1 || matchedInputIndexes.has(inputIndex)) return false
    matchedInputIndexes.add(inputIndex)
  }
  return matchedInputIndexes.size === PROJECTILE_VERIFICATION_INPUTS.length
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseBatch(candidate: unknown): ProjectileVerificationBatch | undefined {
  if (
    !isRecord(candidate) ||
    Object.keys(candidate).some((key) => !['units', 'observations'].includes(key))
  ) {
    return undefined
  }
  if (!isRecord(candidate.units) || !Array.isArray(candidate.observations)) return undefined
  const units = candidate.units
  if (
    Object.keys(units).length !== 6 ||
    typeof units.initialSpeed !== 'string' ||
    typeof units.launchAngle !== 'string' ||
    typeof units.range !== 'string' ||
    typeof units.height !== 'string' ||
    typeof units.time !== 'string' ||
    typeof units.speed !== 'string'
  ) {
    return undefined
  }
  return {
    units: units as unknown as ProjectileUnits,
    observations: candidate.observations,
  }
}

function unitsAreCanonical(units: ProjectileUnits): boolean {
  return Object.entries(CANONICAL_PROJECTILE_UNITS).every(
    ([quantity, unit]) => units[quantity as keyof ProjectileUnits] === unit,
  )
}

function relativeError(actual: number, expected: number): number {
  return expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected)
}

function relativeTolerance(
  tolerance: (typeof PROJECTILE_POLICY.tolerances)[
    | 'apexHeightM'
    | 'flightTimeS'
    | 'rangeM'
    | 'specificEnergy'],
): number {
  if (tolerance.mode === 'relative' || tolerance.mode === 'absolute-or-relative') {
    return tolerance.relative
  }
  return 0
}

function checkScalar(
  findings: VerificationFinding[],
  input: ProjectileInput,
  options: {
    readonly id: string
    readonly checkId: string
    readonly quantity: string
    readonly actual: number
    readonly expected: number
    readonly tolerance: number
    readonly unit: string
  },
): void {
  if (relativeError(options.actual, options.expected) <= options.tolerance) return
  findings.push(
    relativeFinding({
      ...options,
      input,
      explanation: `${options.quantity} exceeded the trusted relative-error tolerance.`,
    }),
  )
}

function verifyMainObservation(
  findings: VerificationFinding[],
  observation: ProjectileObservation,
): void {
  const reference = projectileReference(observation.input)
  checkScalar(findings, observation.input, {
    id: PROJECTILE_FINDING_IDS.rangeMismatch,
    checkId: 'projectile.range',
    quantity: 'rangeM',
    actual: observation.summary.rangeM,
    expected: reference.rangeM,
    tolerance: relativeTolerance(PROJECTILE_POLICY.tolerances.rangeM),
    unit: 'm',
  })
  checkScalar(findings, observation.input, {
    id: PROJECTILE_FINDING_IDS.apexMismatch,
    checkId: 'projectile.apex-height',
    quantity: 'apexHeightM',
    actual: observation.summary.apexHeightM,
    expected: reference.apexHeightM,
    tolerance: relativeTolerance(PROJECTILE_POLICY.tolerances.apexHeightM),
    unit: 'm',
  })
  checkScalar(findings, observation.input, {
    id: PROJECTILE_FINDING_IDS.flightTimeMismatch,
    checkId: 'projectile.flight-time',
    quantity: 'flightTimeS',
    actual: observation.summary.flightTimeS,
    expected: reference.flightTimeS,
    tolerance: relativeTolerance(PROJECTILE_POLICY.tolerances.flightTimeS),
    unit: 's',
  })
  checkTrajectory(findings, observation)
}

function verifyRangeMaximum(
  findings: VerificationFinding[],
  observations: readonly ProjectileObservation[],
): void {
  const speed = PROJECTILE_POLICY.sampling.rangeMaximum.initialSpeedMps
  const candidates = observations.filter(({ input }) => input.initialSpeedMps === speed)
  const at45 = candidates.find(
    ({ input }) =>
      input.launchAngleDeg === PROJECTILE_POLICY.tolerances.rangeMaximum.expectedAngleDeg,
  )
  if (at45 === undefined) return
  const otherCandidates = candidates.filter(
    ({ input }) => input.launchAngleDeg !== at45.input.launchAngleDeg,
  )
  const firstOther = otherCandidates[0]
  if (firstOther === undefined) return
  const highestOther = otherCandidates.reduce(
    (highest, candidate) =>
      candidate.summary.rangeM > highest.summary.rangeM ? candidate : highest,
    firstOther,
  )
  const trustedMaximum = projectileReference(at45.input).rangeM
  const relativeExcess = Math.max(
    0,
    (highestOther.summary.rangeM - at45.summary.rangeM) / trustedMaximum,
  )
  const allowed = PROJECTILE_POLICY.tolerances.rangeMaximum.relativeOrdering
  if (relativeExcess <= allowed) return
  findings.push(
    absoluteFinding({
      id: PROJECTILE_FINDING_IDS.rangeMaximumViolation,
      checkId: 'projectile.range-maximum',
      quantity: 'rangeOrderingExcess',
      input: highestOther.input,
      expected: 0,
      actual: relativeExcess,
      allowedError: allowed,
      unit: 'ratio',
      explanation: `The sampled range peaked at ${highestOther.input.launchAngleDeg} degrees instead of 45 degrees beyond the ordering tolerance.`,
    }),
  )
}

export function verifyProjectile(candidate: unknown): ProjectileVerificationOutcome {
  const batch = parseBatch(candidate)
  if (batch === undefined) {
    return {
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        message: 'Runner output must contain exact projectile units and observations.',
      },
    }
  }
  if (!unitsAreCanonical(batch.units)) {
    return {
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.unsupportedUnits,
        message: "Runner observations must use the projectile policy's canonical units.",
      },
    }
  }
  const observations: ProjectileObservation[] = []
  for (const observation of batch.observations) {
    const parsed = projectileObservationSchema.safeParse(observation)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
          message:
            'Runner observations must be finite and satisfy the projectile observation schema.',
        },
      }
    }
    observations.push(parsed.data)
  }
  if (!hasExactVerificationGrid(observations)) {
    return {
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        message:
          'Runner output must contain each verifier-requested projectile observation exactly once.',
      },
    }
  }
  const findings: VerificationFinding[] = []
  for (const input of PROJECTILE_MAIN_GRID) {
    const observation = observations.find(({ input: actual }) => sameInput(actual, input))
    if (observation !== undefined) verifyMainObservation(findings, observation)
  }
  verifyRangeMaximum(findings, observations)
  return {
    ok: true,
    result: {
      verdict: findings.length === 0 ? 'verified' : 'rejected',
      findings,
      sampleCount: observations.length,
    },
  }
}
