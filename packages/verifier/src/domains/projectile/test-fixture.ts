import type { ProjectileObservation } from './index.js'
import {
  CANONICAL_PROJECTILE_UNITS,
  PROJECTILE_SAMPLE_FRACTIONS,
  PROJECTILE_VERIFICATION_INPUTS,
  type ProjectileVerificationBatch,
  projectileReference,
  projectileStateAtTime,
} from './index.js'

type FixtureImplementation =
  | 'analytic'
  | 'dropped-factor'
  | 'explicit-euler'
  | 'non-finite'
  | 'radians-bug'
  | 'symplectic'

export interface ProjectileFixture {
  readonly id: string
  readonly implementation: FixtureImplementation
  readonly stepSeconds?: number
  readonly units?: ProjectileVerificationBatch['units']
}

const fixtureImplementations = new Set<FixtureImplementation>([
  'analytic',
  'dropped-factor',
  'explicit-euler',
  'non-finite',
  'radians-bug',
  'symplectic',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseUnits = (input: unknown): ProjectileVerificationBatch['units'] => {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== 6 ||
    typeof input.initialSpeed !== 'string' ||
    typeof input.launchAngle !== 'string' ||
    typeof input.range !== 'string' ||
    typeof input.height !== 'string' ||
    typeof input.time !== 'string' ||
    typeof input.speed !== 'string'
  ) {
    throw new TypeError('Projectile fixture units must declare all six quantities.')
  }
  return {
    initialSpeed: input.initialSpeed,
    launchAngle: input.launchAngle,
    range: input.range,
    height: input.height,
    time: input.time,
    speed: input.speed,
  }
}

export function parseProjectileFixture(input: unknown): ProjectileFixture {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (key) => !['id', 'implementation', 'stepSeconds', 'units'].includes(key),
    )
  ) {
    throw new TypeError('Projectile fixture recipes must use the strict declared shape.')
  }
  if (
    typeof input.id !== 'string' ||
    typeof input.implementation !== 'string' ||
    !fixtureImplementations.has(input.implementation as FixtureImplementation)
  ) {
    throw new TypeError('Projectile fixture identity or implementation is invalid.')
  }
  if (
    input.stepSeconds !== undefined &&
    (typeof input.stepSeconds !== 'number' ||
      !Number.isFinite(input.stepSeconds) ||
      input.stepSeconds <= 0)
  ) {
    throw new TypeError('Projectile fixture step size must be finite and positive.')
  }
  let units: ProjectileVerificationBatch['units'] | undefined
  if (input.units !== undefined) {
    units = parseUnits(input.units)
  }
  return {
    id: input.id,
    implementation: input.implementation as FixtureImplementation,
    ...(input.stepSeconds === undefined ? {} : { stepSeconds: input.stepSeconds }),
    ...(units === undefined ? {} : { units }),
  }
}

const G = 9.81

function integratedSummary(
  input: ProjectileObservation['input'],
  stepSeconds: number,
  symplectic: boolean,
  radiansBug: boolean,
): ProjectileObservation['summary'] {
  const theta = radiansBug ? input.launchAngleDeg : (input.launchAngleDeg * Math.PI) / 180
  const vx = input.initialSpeedMps * Math.cos(theta)
  let vy = input.initialSpeedMps * Math.sin(theta)
  let x = 0
  let y = 0
  let apexHeightM = 0
  let flightTimeS = 0
  do {
    if (symplectic) {
      vy -= G * stepSeconds
      x += vx * stepSeconds
      y += vy * stepSeconds
    } else {
      x += vx * stepSeconds
      y += vy * stepSeconds
      vy -= G * stepSeconds
    }
    apexHeightM = Math.max(apexHeightM, y)
    flightTimeS += stepSeconds
  } while (y >= 0 && flightTimeS <= 100)
  return {
    rangeM: x,
    apexHeightM,
    flightTimeS,
    initialSpeedMps: input.initialSpeedMps,
  }
}

function integratedState(
  input: ProjectileObservation['input'],
  timeS: number,
  options: {
    readonly stepSeconds: number
    readonly symplectic: boolean
    readonly radiansBug: boolean
  },
): ProjectileObservation['trajectory'][number] {
  const { radiansBug, stepSeconds, symplectic } = options
  const theta = radiansBug ? input.launchAngleDeg : (input.launchAngleDeg * Math.PI) / 180
  const vx = input.initialSpeedMps * Math.cos(theta)
  let vy = input.initialSpeedMps * Math.sin(theta)
  let xM = 0
  let yM = 0
  let elapsed = 0
  while (elapsed < timeS) {
    const step = Math.min(stepSeconds, timeS - elapsed)
    if (symplectic) {
      vy -= G * step
      xM += vx * step
      yM += vy * step
    } else {
      xM += vx * step
      yM += vy * step
      vy -= G * step
    }
    elapsed += step
  }
  return { timeS, xM, yM, speedMps: Math.hypot(vx, vy) }
}

function droppedFactorObservation(input: ProjectileObservation['input']): ProjectileObservation {
  const theta = (input.launchAngleDeg * Math.PI) / 180
  const reference = projectileReference(input)
  const rangeM = (input.initialSpeedMps ** 2 * Math.sin(theta)) / G
  return {
    input,
    summary: { ...reference, rangeM, initialSpeedMps: input.initialSpeedMps },
    trajectory: PROJECTILE_SAMPLE_FRACTIONS.map((fraction) => ({
      timeS: reference.flightTimeS * fraction,
      xM: rangeM * fraction,
      yM: reference.apexHeightM * Math.sin(Math.PI * fraction),
      speedMps: input.initialSpeedMps * (1 - 0.3 * fraction),
    })),
  }
}

function observationFor(
  fixture: ProjectileFixture,
  input: ProjectileObservation['input'],
): ProjectileObservation {
  const reference = projectileReference(input)
  if (fixture.implementation === 'analytic') {
    return {
      input,
      summary: { ...reference, initialSpeedMps: input.initialSpeedMps },
      trajectory: PROJECTILE_SAMPLE_FRACTIONS.map((fraction) =>
        projectileStateAtTime(input, reference.flightTimeS * fraction),
      ),
    }
  }
  if (fixture.implementation === 'dropped-factor') {
    return droppedFactorObservation(input)
  }
  if (fixture.implementation === 'non-finite') {
    return {
      input,
      summary: { ...reference, rangeM: Number.NaN, initialSpeedMps: Number.POSITIVE_INFINITY },
      trajectory: [],
    }
  }
  const stepSeconds = fixture.stepSeconds ?? 0.005
  const symplectic = fixture.implementation === 'symplectic'
  const radiansBug = fixture.implementation === 'radians-bug'
  return {
    input,
    summary: integratedSummary(input, stepSeconds, symplectic, radiansBug),
    trajectory: PROJECTILE_SAMPLE_FRACTIONS.map((fraction) =>
      integratedState(input, reference.flightTimeS * fraction, {
        stepSeconds,
        symplectic,
        radiansBug,
      }),
    ),
  }
}

export function batchFromFixture(input: unknown): ProjectileVerificationBatch {
  const fixture = parseProjectileFixture(input)
  return {
    units: fixture.units ?? CANONICAL_PROJECTILE_UNITS,
    observations: PROJECTILE_VERIFICATION_INPUTS.map((input) => observationFor(fixture, input)),
  }
}
