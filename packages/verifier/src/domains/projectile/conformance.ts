import {
  normalizedProjectilePreviewSchema,
  type ProjectileInput,
  type ProjectileObservation,
  type ProjectilePreview,
} from '@simproof/contracts'
import type { DomainPackConformanceCases } from '@simproof/domain-pack-sdk'
import {
  CANONICAL_PROJECTILE_UNITS,
  PROJECTILE_BOUNDARY_ERROR_IDS,
  PROJECTILE_FINDING_IDS,
  PROJECTILE_POLICY,
  projectileApplicability,
} from './policy.js'
import { projectileReference } from './reference.js'
import { batchFromFixture } from './test-fixture.js'
import type { ProjectileVerificationBatch } from './types.js'
import { verifyProjectile } from './verifier.js'

const samplePreview = normalizedProjectilePreviewSchema.parse({
  schemaVersion: '1',
  domain: 'projectile',
  simulationVersionId: '33333333-3333-4333-8333-333333333333',
  conceptSpec: {
    schemaVersion: '1',
    domain: 'projectile',
    title: 'Conformance projectile',
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 15, max: 40 } },
      launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
    },
    requestedControls: ['initialSpeed', 'launchAngle'],
  },
  renderer: {
    schemaVersion: '1',
    domain: 'projectile',
    renderer: 'projectile-trajectory',
    features: ['trail', 'apex-marker', 'impact-marker'],
  },
  input: { initialSpeedMps: 30, launchAngleDeg: 45 },
  evidence: {
    verificationRunId: '44444444-4444-4444-8444-444444444444',
    artifactHash: `sha256:${'2'.repeat(64)}`,
    validity: { status: 'current' },
    assumptions: PROJECTILE_POLICY.assumptions,
    limitations: PROJECTILE_POLICY.limitations,
  },
  samples: [
    { index: 0, timeS: 0, xM: 0, yM: 0, speedMps: 30, velocityXMps: 21.2, velocityYMps: 21.2 },
    {
      index: 1,
      timeS: 1,
      xM: 21.2,
      yM: 16.3,
      speedMps: 24,
      velocityXMps: 21.2,
      velocityYMps: 11.4,
    },
  ],
  events: [
    { kind: 'launch', sampleIndex: 0 },
    { kind: 'apex', sampleIndex: 1 },
  ],
})

const propertyPasses = (seed: number, runCount: number, allowedError: number): boolean => {
  let state = seed >>> 0
  for (let index = 0; index < runCount; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const speed = 15 + (state / 0xffff_ffff) * 25
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const angle = 15 + (state / 0xffff_ffff) * 60
    const first = projectileReference({ initialSpeedMps: speed, launchAngleDeg: angle })
    const complement = projectileReference({
      initialSpeedMps: speed,
      launchAngleDeg: 90 - angle,
    })
    const scale = Math.max(1, first.rangeM)
    if (Math.abs(first.rangeM - complement.rangeM) / scale > allowedError) return false
  }
  return true
}

const cloneBatch = (): ProjectileVerificationBatch => {
  const source = batchFromFixture({ id: 'threshold-control', implementation: 'analytic' })
  return {
    units: source.units,
    observations: source.observations.map((observation) => ({
      input: { ...observation.input },
      summary: { ...observation.summary },
      trajectory: observation.trajectory.map((sample) => ({ ...sample })),
    })),
  }
}

const replaceObservation = (
  batch: ProjectileVerificationBatch,
  index: number,
  update: (value: ProjectileObservation) => ProjectileObservation,
): ProjectileVerificationBatch => ({
  ...batch,
  observations: batch.observations.map((value, actualIndex) =>
    actualIndex === index ? update(value) : value,
  ),
})

const representableBoundaryError = (error: number): number =>
  Math.max(0, error - 4 * Number.EPSILON * Math.max(1, Math.abs(error)))

const mutateForThreshold = (id: string, error: number): ProjectileVerificationBatch => {
  const batch = cloneBatch()
  const first = batch.observations[0]
  if (first === undefined) throw new TypeError('Projectile threshold fixture is empty.')
  // Synthetic equality controls use the nearest accepted-side representation.
  const appliedError = representableBoundaryError(error)
  if (id === 'projectile.range.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      summary: { ...value.summary, rangeM: value.summary.rangeM * (1 + appliedError) },
    }))
  }
  if (id === 'projectile.apex.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      summary: { ...value.summary, apexHeightM: value.summary.apexHeightM * (1 + appliedError) },
    }))
  }
  if (id === 'projectile.flight-time.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      summary: { ...value.summary, flightTimeS: value.summary.flightTimeS * (1 + appliedError) },
    }))
  }
  if (id === 'projectile.trajectory-y.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      trajectory: value.trajectory.map((sample, index) =>
        index === 2
          ? { ...sample, yM: sample.yM + value.summary.apexHeightM * appliedError }
          : sample,
      ),
    }))
  }
  if (id === 'projectile.trajectory-time.relative-scale') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      trajectory: value.trajectory.map((sample, index) =>
        index === 1
          ? { ...sample, timeS: sample.timeS + Math.max(1, sample.timeS) * appliedError }
          : sample,
      ),
    }))
  }
  if (id === 'projectile.trajectory-x.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      trajectory: value.trajectory.map((sample, index) =>
        index === 1 ? { ...sample, xM: sample.xM + value.summary.rangeM * appliedError } : sample,
      ),
    }))
  }
  if (id === 'projectile.energy.relative-tolerance') {
    return replaceObservation(batch, 0, (value) => ({
      ...value,
      trajectory: value.trajectory.map((sample, index) =>
        index === 0
          ? { ...sample, speedMps: sample.speedMps * Math.sqrt(1 + appliedError) }
          : sample,
      ),
    }))
  }
  const at45 = batch.observations.find(
    ({ input }) => input.initialSpeedMps === 30 && input.launchAngleDeg === 45,
  )
  const at30Index = batch.observations.findIndex(
    ({ input }) => input.initialSpeedMps === 30 && input.launchAngleDeg === 30,
  )
  if (at45 === undefined || at30Index < 0) throw new TypeError('Range-maximum controls are absent.')
  return replaceObservation(batch, at30Index, (value) => ({
    ...value,
    summary: {
      ...value.summary,
      rangeM: at45.summary.rangeM + projectileReference(at45.input).rangeM * appliedError,
    },
  }))
}

const findingForThreshold = (id: string): string => {
  switch (id) {
    case 'projectile.range.relative-tolerance':
      return PROJECTILE_FINDING_IDS.rangeMismatch
    case 'projectile.apex.relative-tolerance':
      return PROJECTILE_FINDING_IDS.apexMismatch
    case 'projectile.flight-time.relative-tolerance':
      return PROJECTILE_FINDING_IDS.flightTimeMismatch
    case 'projectile.trajectory-y.relative-tolerance':
      return PROJECTILE_FINDING_IDS.trajectoryResidual
    case 'projectile.trajectory-time.relative-scale':
      return PROJECTILE_FINDING_IDS.sampleCoverageInsufficient
    case 'projectile.trajectory-x.relative-tolerance':
      return PROJECTILE_FINDING_IDS.sampleLocationMismatch
    case 'projectile.energy.relative-tolerance':
      return PROJECTILE_FINDING_IDS.energyDrift
    case 'projectile.range-maximum.relative-ordering':
      return PROJECTILE_FINDING_IDS.rangeMaximumViolation
    default:
      return ''
  }
}

const thresholdPasses = (id: string, below: number, equal: number, above: number): boolean => {
  const target = findingForThreshold(id)
  if (target === '') return false
  const [belowOutcome, equalOutcome, aboveOutcome] = [below, equal, above].map((error) =>
    verifyProjectile(mutateForThreshold(id, error)),
  )
  const hasTarget = (outcome: ReturnType<typeof verifyProjectile> | undefined) => {
    return (
      outcome?.ok === true &&
      outcome.result.findings.some(({ id: findingId }) => findingId === target)
    )
  }
  return !hasTarget(belowOutcome) && !hasTarget(equalOutcome) && hasTarget(aboveOutcome)
}

const endpointPasses = (id: string, below: number, equal: number, above: number): boolean => {
  const applicable = (input: ProjectileInput) => {
    const result = projectileApplicability(input, CANONICAL_PROJECTILE_UNITS)
    return result.applicable
  }
  const boundaryFailure = (input: ProjectileInput) => {
    const result = projectileApplicability(input, CANONICAL_PROJECTILE_UNITS)
    return (
      !result.applicable && result.findingId === PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation
    )
  }
  if (id === 'initial-speed.minimum') {
    return (
      boundaryFailure({ initialSpeedMps: below, launchAngleDeg: 45 }) &&
      applicable({ initialSpeedMps: equal, launchAngleDeg: 45 }) &&
      applicable({ initialSpeedMps: above, launchAngleDeg: 45 })
    )
  }
  if (id === 'initial-speed.maximum') {
    return (
      applicable({ initialSpeedMps: below, launchAngleDeg: 45 }) &&
      applicable({ initialSpeedMps: equal, launchAngleDeg: 45 }) &&
      boundaryFailure({ initialSpeedMps: above, launchAngleDeg: 45 })
    )
  }
  if (id === 'launch-angle.minimum') {
    return (
      boundaryFailure({ initialSpeedMps: 30, launchAngleDeg: below }) &&
      applicable({ initialSpeedMps: 30, launchAngleDeg: equal }) &&
      applicable({ initialSpeedMps: 30, launchAngleDeg: above })
    )
  }
  return (
    applicable({ initialSpeedMps: 30, launchAngleDeg: below }) &&
    applicable({ initialSpeedMps: 30, launchAngleDeg: equal }) &&
    boundaryFailure({ initialSpeedMps: 30, launchAngleDeg: above })
  )
}

export const PROJECTILE_CONFORMANCE_CASES: DomainPackConformanceCases<
  ProjectileInput,
  ProjectilePreview
> = {
  referenceInputs: PROJECTILE_POLICY.sampling.cases,
  supportedInputs: PROJECTILE_POLICY.sampling.cases,
  unsupportedInputs: [
    { initialSpeedMps: 14.99, launchAngleDeg: 45 },
    { initialSpeedMps: 30, launchAngleDeg: 75.01 },
  ],
  accessibleInputs: [samplePreview],
  isApplicable: (input) => projectileApplicability(input, CANONICAL_PROJECTILE_UNITS).applicable,
  runPropertyControl: ({ allowedError, id, runCount, seed }) =>
    id === 'projectile-analytic-relations' &&
    allowedError.unit === 'ratio' &&
    propertyPasses(seed, runCount, allowedError.value),
  runBoundaryControl: ({ cases, covers, threshold }) => {
    if (cases.equal !== threshold.value) return false
    return covers.kind === 'applicability-endpoint'
      ? endpointPasses(covers.id, cases.below, cases.equal, cases.above)
      : covers.kind === 'tolerance-threshold' &&
          thresholdPasses(covers.id, cases.below, cases.equal, cases.above)
  },
}
