import {
  type ProjectileInput,
  type ProjectileVerificationPolicy,
  projectileVerificationPolicySchema,
} from '@simproof/contracts'

import type { ProjectileApplicability, ProjectileUnits } from './types.js'

export const PROJECTILE_FINDING_IDS = Object.freeze({
  rangeMismatch: 'projectile.range.relative-error',
  apexMismatch: 'projectile.apex-height.relative-error',
  flightTimeMismatch: 'projectile.flight-time.relative-error',
  trajectoryResidual: 'projectile.trajectory.curve-residual',
  energyDrift: 'projectile.energy.non-conservation',
  rangeMaximumViolation: 'projectile.range.maximum-angle',
  sampleCoverageInsufficient: 'projectile.trajectory.sample-coverage',
  sampleLocationMismatch: 'projectile.trajectory.sample-location',
})

export const PROJECTILE_BOUNDARY_ERROR_IDS = Object.freeze({
  invalidObservation: 'projectile.boundary.invalid-observation',
  unsupportedUnits: 'projectile.boundary.unsupported-units',
})

export const CANONICAL_PROJECTILE_UNITS: ProjectileUnits = Object.freeze({
  initialSpeed: 'm/s',
  launchAngle: 'deg',
  range: 'm',
  height: 'm',
  time: 's',
  speed: 'm/s',
})

export const PROJECTILE_MAIN_GRID = Object.freeze([
  { initialSpeedMps: 20, launchAngleDeg: 30 },
  { initialSpeedMps: 30, launchAngleDeg: 45 },
  { initialSpeedMps: 25, launchAngleDeg: 60 },
  { initialSpeedMps: 40, launchAngleDeg: 15 },
  { initialSpeedMps: 15, launchAngleDeg: 75 },
] satisfies ProjectileInput[])

export const PROJECTILE_PEAK_ANGLE_GRID = Object.freeze([30, 40, 45, 50, 60])
export const PROJECTILE_SAMPLE_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1])

const parsedPolicy = projectileVerificationPolicySchema.parse({
  schemaVersion: '1',
  id: 'projectile-vacuum-level-earth',
  version: '1.1.0',
  domain: 'projectile',
  checks: [
    'projectile.range',
    'projectile.apex-height',
    'projectile.flight-time',
    'projectile.trajectory-curve',
    'projectile.energy-conservation',
    'projectile.range-maximum',
  ],
  applicability: {
    initialSpeedMps: { min: 15, max: 40 },
    launchAngleDeg: { min: 15, max: 75 },
    gravityMps2: 9.81,
  },
  sampling: {
    cases: PROJECTILE_MAIN_GRID,
    trajectoryFractions: PROJECTILE_SAMPLE_FRACTIONS,
    rangeMaximum: {
      initialSpeedMps: 30,
      launchAnglesDeg: PROJECTILE_PEAK_ANGLE_GRID,
    },
  },
  tolerances: {
    rangeM: { mode: 'relative', relative: 0.01 },
    apexHeightM: { mode: 'relative', relative: 0.01 },
    flightTimeS: { mode: 'relative', relative: 0.01 },
    trajectoryYM: { relativeTo: 'apexHeightM', relative: 0.02 },
    trajectoryTimeS: { relativeScale: 1e-10 },
    trajectoryXM: { relativeTo: 'rangeM', relative: 1e-10 },
    specificEnergy: { mode: 'relative', relative: 0.02 },
    rangeMaximum: { expectedAngleDeg: 45, relativeOrdering: 0.01 },
  },
  assumptions: [
    'Motion is in a vacuum with no drag or wind.',
    'Launch and landing elevations are both zero metres.',
    'The projectile is a point mass in a flat inertial frame.',
    'Gravitational acceleration is constant at 9.81 metres per second squared.',
  ],
  limitations: [
    'Verification applies only to the recorded speed and angle bounds.',
    'The policy does not model drag, wind, spin, curvature, or unequal elevations.',
    'Passing the finite grid is not a claim of correctness outside the tested scope.',
  ],
})

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

export const PROJECTILE_POLICY: ProjectileVerificationPolicy = deepFreeze(parsedPolicy)

export const PROJECTILE_VERIFICATION_INPUTS = Object.freeze([
  ...PROJECTILE_MAIN_GRID,
  ...PROJECTILE_PEAK_ANGLE_GRID.filter(
    (launchAngleDeg) =>
      !PROJECTILE_MAIN_GRID.some(
        (input) => input.initialSpeedMps === 30 && input.launchAngleDeg === launchAngleDeg,
      ),
  ).map((launchAngleDeg) => ({ initialSpeedMps: 30, launchAngleDeg })),
])

function hasCanonicalUnits(units: ProjectileUnits): boolean {
  return Object.entries(CANONICAL_PROJECTILE_UNITS).every(
    ([quantity, unit]) => units[quantity as keyof ProjectileUnits] === unit,
  )
}

export function projectileApplicability(
  input: ProjectileInput,
  units: ProjectileUnits,
): ProjectileApplicability {
  if (!hasCanonicalUnits(units)) {
    return {
      applicable: false,
      findingId: PROJECTILE_BOUNDARY_ERROR_IDS.unsupportedUnits,
      reason: 'Projectile verification requires canonical SI units and degree input.',
    }
  }
  const { initialSpeedMps, launchAngleDeg } = PROJECTILE_POLICY.applicability
  if (
    input.initialSpeedMps < initialSpeedMps.min ||
    input.initialSpeedMps > initialSpeedMps.max ||
    input.launchAngleDeg < launchAngleDeg.min ||
    input.launchAngleDeg > launchAngleDeg.max
  ) {
    return {
      applicable: false,
      findingId: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
      reason: 'Projectile parameters are outside the trusted policy bounds.',
    }
  }
  return { applicable: true }
}
