import type { ProjectileObservation, VerificationFinding } from '@simproof/contracts'

import { absoluteFinding, relativeFinding } from './findings.js'
import { PROJECTILE_FINDING_IDS, PROJECTILE_POLICY, PROJECTILE_SAMPLE_FRACTIONS } from './policy.js'
import { projectileReference, projectileStateAtTime } from './reference.js'

function relativeError(actual: number, expected: number): number {
  return expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected)
}

export function isWithinProjectileAbsoluteTolerance(
  actual: number,
  expected: number,
  allowedError: number,
): boolean {
  return Math.abs(actual - expected) <= allowedError
}

function matchingSample(
  observation: ProjectileObservation,
  expectedTimeS: number,
): ProjectileObservation['trajectory'][number] | undefined {
  const allowedTimeError =
    PROJECTILE_POLICY.tolerances.trajectoryTimeS.relativeScale * Math.max(1, expectedTimeS)
  return observation.trajectory.find(({ timeS }) =>
    isWithinProjectileAbsoluteTolerance(timeS, expectedTimeS, allowedTimeError),
  )
}

export function checkTrajectory(
  findings: VerificationFinding[],
  observation: ProjectileObservation,
): void {
  const { input } = observation
  const reference = projectileReference(input)
  const pairs = PROJECTILE_SAMPLE_FRACTIONS.map((fraction) => {
    const trusted = projectileStateAtTime(input, reference.flightTimeS * fraction)
    return { trusted, candidate: matchingSample(observation, trusted.timeS) }
  })
  const present = pairs.filter(({ candidate }) => candidate !== undefined).length
  if (present !== pairs.length) {
    findings.push(
      absoluteFinding({
        id: PROJECTILE_FINDING_IDS.sampleCoverageInsufficient,
        checkId: 'projectile.trajectory-curve',
        quantity: 'trajectorySampleCount',
        input,
        expected: pairs.length,
        actual: present,
        allowedError: 0,
        unit: 'count',
        explanation: 'The candidate omitted one or more verifier-requested trajectory samples.',
      }),
    )
    return
  }

  const samples = pairs.flatMap(({ candidate, trusted }) =>
    candidate === undefined ? [] : [{ candidate, trusted }],
  )
  const xAllowedError = PROJECTILE_POLICY.tolerances.trajectoryXM.relative * reference.rangeM
  const worstX = samples.reduce((worst, pair) =>
    Math.abs(pair.candidate.xM - pair.trusted.xM) > Math.abs(worst.candidate.xM - worst.trusted.xM)
      ? pair
      : worst,
  )
  if (!isWithinProjectileAbsoluteTolerance(worstX.candidate.xM, worstX.trusted.xM, xAllowedError)) {
    findings.push(
      absoluteFinding({
        id: PROJECTILE_FINDING_IDS.sampleLocationMismatch,
        checkId: 'projectile.trajectory-curve',
        quantity: 'trajectoryXM',
        input,
        expected: worstX.trusted.xM,
        actual: worstX.candidate.xM,
        allowedError: xAllowedError,
        unit: 'm',
        explanation: 'A candidate sample was not evaluated at its verifier-owned location.',
      }),
    )
  }

  const yAllowedError = PROJECTILE_POLICY.tolerances.trajectoryYM.relative * reference.apexHeightM
  const worstY = samples.reduce((worst, pair) =>
    Math.abs(pair.candidate.yM - pair.trusted.yM) > Math.abs(worst.candidate.yM - worst.trusted.yM)
      ? pair
      : worst,
  )
  if (!isWithinProjectileAbsoluteTolerance(worstY.candidate.yM, worstY.trusted.yM, yAllowedError)) {
    findings.push(
      absoluteFinding({
        id: PROJECTILE_FINDING_IDS.trajectoryResidual,
        checkId: 'projectile.trajectory-curve',
        quantity: 'trajectoryYM',
        input,
        expected: worstY.trusted.yM,
        actual: worstY.candidate.yM,
        allowedError: yAllowedError,
        unit: 'm',
        explanation: 'A verifier-requested state fell outside the trusted trajectory envelope.',
      }),
    )
  }

  const trustedEnergy = 0.5 * input.initialSpeedMps ** 2
  const tolerance = PROJECTILE_POLICY.tolerances.specificEnergy
  const energyTolerance =
    tolerance.mode === 'relative' || tolerance.mode === 'absolute-or-relative'
      ? tolerance.relative
      : 0
  const firstPair = samples[0]
  if (firstPair === undefined) return
  const first = firstPair.candidate
  const worstEnergy = samples.reduce(
    (worst, pair) => {
      const energy =
        0.5 * pair.candidate.speedMps ** 2 +
        PROJECTILE_POLICY.applicability.gravityMps2 * pair.candidate.yM
      return relativeError(energy, trustedEnergy) > relativeError(worst.energy, trustedEnergy)
        ? { energy }
        : worst
    },
    {
      energy: 0.5 * first.speedMps ** 2 + PROJECTILE_POLICY.applicability.gravityMps2 * first.yM,
    },
  )
  if (relativeError(worstEnergy.energy, trustedEnergy) > energyTolerance) {
    findings.push(
      relativeFinding({
        id: PROJECTILE_FINDING_IDS.energyDrift,
        checkId: 'projectile.energy-conservation',
        quantity: 'specificEnergy',
        input,
        expected: trustedEnergy,
        actual: worstEnergy.energy,
        tolerance: energyTolerance,
        unit: 'J/kg',
        explanation: 'Specific mechanical energy was not conserved at a requested state.',
        category: 'invariant',
      }),
    )
  }
}
