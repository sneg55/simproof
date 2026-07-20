import { defineSimulationCore } from './simulation-core.js'

const GRAVITY_MPS2 = 9.81
const MIN_SAMPLES = 2
const MAX_SAMPLES = 2_001

export interface ProjectileSeedInput {
  readonly initialSpeedMps: number
  readonly launchAngleDeg: number
}

export interface ProjectileSeedSample {
  readonly timeS: number
  readonly xM: number
  readonly yM: number
  readonly speedMps: number
  readonly velocityXMps: number
  readonly velocityYMps: number
}

interface ProjectileObservationSample {
  readonly timeS: number
  readonly xM: number
  readonly yM: number
  readonly speedMps: number
}

export interface ProjectileSeedObservation {
  readonly input: ProjectileSeedInput
  readonly summary: {
    readonly rangeM: number
    readonly apexHeightM: number
    readonly flightTimeS: number
    readonly initialSpeedMps: number
  }
  readonly trajectory: readonly ProjectileObservationSample[]
}

export interface PendulumSeedInput {
  readonly lengthM: number
  readonly amplitudeDeg: number
}

export interface PendulumSeedSample {
  readonly timeS: number
  readonly angleDeg: number
  readonly angularVelocityDegPerS: number
}

function assertProjectileInput(input: ProjectileSeedInput): void {
  if (
    !Number.isFinite(input.initialSpeedMps) ||
    input.initialSpeedMps <= 0 ||
    !Number.isFinite(input.launchAngleDeg)
  ) {
    throw new TypeError('Projectile input must contain finite speed and angle values.')
  }
}

function assertPendulumInput(input: PendulumSeedInput): void {
  if (
    !Number.isFinite(input.lengthM) ||
    input.lengthM <= 0 ||
    !Number.isFinite(input.amplitudeDeg) ||
    input.amplitudeDeg <= 0
  ) {
    throw new TypeError('Pendulum input must contain finite positive length and amplitude values.')
  }
}

function assertSampleCount(sampleCount: number): void {
  if (
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < MIN_SAMPLES ||
    sampleCount > MAX_SAMPLES
  ) {
    throw new TypeError('Sample count is outside the supported range.')
  }
}

function projectileSummary(input: ProjectileSeedInput) {
  assertProjectileInput(input)
  const angleRad = (input.launchAngleDeg * Math.PI) / 180
  const velocityXMps = input.initialSpeedMps * Math.cos(angleRad)
  const initialVelocityYMps = input.initialSpeedMps * Math.sin(angleRad)
  const flightTimeS = (2 * initialVelocityYMps) / GRAVITY_MPS2
  return {
    angleRad,
    velocityXMps,
    initialVelocityYMps,
    flightTimeS,
    rangeM: velocityXMps * flightTimeS,
    apexHeightM: initialVelocityYMps ** 2 / (2 * GRAVITY_MPS2),
  }
}

export function projectileTimeSeries(
  input: ProjectileSeedInput,
  sampleCount: number,
): readonly ProjectileSeedSample[] {
  assertSampleCount(sampleCount)
  const summary = projectileSummary(input)
  return Object.freeze(
    Array.from({ length: sampleCount }, (_, index) => {
      const timeS = (summary.flightTimeS * index) / (sampleCount - 1)
      const velocityYMps = summary.initialVelocityYMps - GRAVITY_MPS2 * timeS
      return Object.freeze({
        timeS,
        xM: summary.velocityXMps * timeS,
        yM: Math.max(0, summary.initialVelocityYMps * timeS - 0.5 * GRAVITY_MPS2 * timeS ** 2),
        speedMps: Math.hypot(summary.velocityXMps, velocityYMps),
        velocityXMps: summary.velocityXMps,
        velocityYMps,
      })
    }),
  )
}

export const projectileSeedCore = defineSimulationCore(
  (input: Readonly<ProjectileSeedInput>): ProjectileSeedObservation => {
    const summary = projectileSummary(input)
    return Object.freeze({
      input: Object.freeze({ ...input }),
      summary: Object.freeze({
        rangeM: summary.rangeM,
        apexHeightM: summary.apexHeightM,
        flightTimeS: summary.flightTimeS,
        initialSpeedMps: input.initialSpeedMps,
      }),
      trajectory: projectileTimeSeries(input, 5).map(({ timeS, xM, yM, speedMps }) =>
        Object.freeze({ timeS, xM, yM, speedMps }),
      ),
    })
  },
)

export function pendulumPeriodSeconds(lengthM: number): number {
  if (!Number.isFinite(lengthM) || lengthM <= 0) {
    throw new TypeError('Pendulum length must be finite and positive.')
  }
  return 2 * Math.PI * Math.sqrt(lengthM / GRAVITY_MPS2)
}

export function pendulumTimeSeries(
  input: PendulumSeedInput,
  sampleCount: number,
): readonly PendulumSeedSample[] {
  assertPendulumInput(input)
  assertSampleCount(sampleCount)
  const periodS = pendulumPeriodSeconds(input.lengthM)
  const angularFrequency = (2 * Math.PI) / periodS
  return Object.freeze(
    Array.from({ length: sampleCount }, (_, index) => {
      const timeS = (periodS * index) / (sampleCount - 1)
      return Object.freeze({
        timeS,
        angleDeg: input.amplitudeDeg * Math.cos(angularFrequency * timeS),
        angularVelocityDegPerS:
          -input.amplitudeDeg * angularFrequency * Math.sin(angularFrequency * timeS),
      })
    }),
  )
}

export const pendulumSeedCore = defineSimulationCore((input: Readonly<PendulumSeedInput>) => {
  assertPendulumInput(input)
  return Object.freeze({
    input: Object.freeze({ ...input }),
    periodS: pendulumPeriodSeconds(input.lengthM),
  })
})

function implementationSource(functions: readonly ((...arguments_: never[]) => unknown)[]): string {
  return JSON.stringify({
    protocolVersion: '1',
    gravityMps2: GRAVITY_MPS2,
    sampleBounds: [MIN_SAMPLES, MAX_SAMPLES],
    functions: functions.map((implementation) => Function.prototype.toString.call(implementation)),
  })
}

const BUNDLED_CORE_ARTIFACT_SOURCES = Object.freeze({
  pendulum: implementationSource([
    assertPendulumInput,
    assertSampleCount,
    pendulumPeriodSeconds,
    pendulumTimeSeries,
    pendulumSeedCore.sample,
  ]),
  projectile: implementationSource([
    assertProjectileInput,
    assertSampleCount,
    projectileSummary,
    projectileTimeSeries,
    projectileSeedCore.sample,
  ]),
})

export function bundledCoreArtifactSource(domain: 'pendulum' | 'projectile'): string {
  return domain === 'pendulum'
    ? BUNDLED_CORE_ARTIFACT_SOURCES.pendulum
    : BUNDLED_CORE_ARTIFACT_SOURCES.projectile
}
