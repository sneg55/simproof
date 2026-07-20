import {
  normalizedProjectilePreviewSchema,
  type ParameterRange,
  type ProjectileObservation,
  type ProjectilePreview,
  projectileConceptSpecSchema,
  projectileDomainSceneSchema,
  projectileObservationSchema,
} from '@simproof/contracts'
import type { AccessibleDomainRepresentation, DomainReportAdapter } from '@simproof/domain-pack-sdk'
import { CANONICAL_PROJECTILE_UNITS, PROJECTILE_POLICY } from './policy.js'
import { verifyProjectile } from './verifier.js'

const unique = (values: readonly number[]) => [...new Set(values)]
const parameterRange = (
  parameter: string,
  unit: string,
  values: readonly number[],
): ParameterRange => ({
  parameter,
  unit,
  min: Math.min(...values),
  max: Math.max(...values),
  sampledValues: unique(values),
})

const validateObservations = (values: readonly unknown[]): readonly ProjectileObservation[] => {
  if (values.length === 0) throw new TypeError('Projectile observations must not be empty.')
  return values.map((value) => projectileObservationSchema.parse(value))
}

const expectedInputs = () => {
  const inputs = [
    ...PROJECTILE_POLICY.sampling.cases,
    ...PROJECTILE_POLICY.sampling.rangeMaximum.launchAnglesDeg.map((launchAngleDeg) => ({
      initialSpeedMps: PROJECTILE_POLICY.sampling.rangeMaximum.initialSpeedMps,
      launchAngleDeg,
    })),
  ]
  return [
    ...new Map(
      inputs.map((input) => [`${input.initialSpeedMps}:${input.launchAngleDeg}`, input]),
    ).values(),
  ]
}

export const PROJECTILE_REPORT_ADAPTER: DomainReportAdapter = {
  validateObservations,
  verifyObservations: (values) => {
    const outcome = verifyProjectile({
      units: CANONICAL_PROJECTILE_UNITS,
      observations: validateObservations(values),
    })
    if (!outcome.ok)
      throw new TypeError(`Cannot verify projectile observations: ${outcome.error.id}`)
    return outcome.result
  },
  expectedInputs,
  observationInput: (value) => projectileObservationSchema.parse(value).input,
  testedParameters: (values) => {
    const observations = validateObservations(values)
    return [
      parameterRange(
        'initialSpeedMps',
        'm/s',
        observations.map(({ input }) => input.initialSpeedMps),
      ),
      parameterRange(
        'launchAngleDeg',
        'deg',
        observations.map(({ input }) => input.launchAngleDeg),
      ),
    ]
  },
  sampleCountForCheck: (checkId, result) => {
    if (result.verdict === 'inapplicable') return result.sampleCount
    return checkId === 'projectile.range-maximum'
      ? PROJECTILE_POLICY.sampling.rangeMaximum.launchAnglesDeg.length
      : PROJECTILE_POLICY.sampling.cases.length
  },
}

export const projectileAccessibleRepresentation = (
  preview: ProjectilePreview,
): AccessibleDomainRepresentation => {
  const verified = normalizedProjectilePreviewSchema.parse(preview)
  const rows = verified.samples.flatMap((sample) => {
    const events = verified.events.filter(({ sampleIndex }) => sampleIndex === sample.index)
    return (events.length === 0 ? [{ kind: 'none' as const }] : events).map(({ kind }) => ({
      initialSpeedMps: verified.input.initialSpeedMps,
      launchAngleDeg: verified.input.launchAngleDeg,
      timeS: sample.timeS,
      xM: sample.xM,
      yM: sample.yM,
      speedMps: sample.speedMps,
      velocityXMps: sample.velocityXMps ?? ('not-provided' as const),
      velocityYMps: sample.velocityYMps ?? ('not-provided' as const),
      event: kind,
    }))
  })
  const scene = projectileDomainSceneSchema.parse({
    renderer: 'projectile-trajectory',
    rows,
    assumptions: verified.evidence.assumptions,
    limitations: verified.evidence.limitations,
  })
  return {
    scene,
    assumptions: scene.assumptions,
    limitations: scene.limitations,
    summary:
      'Projectile input, position, speed, velocity, and events from verified preview output.',
    table: {
      caption: 'Verified projectile preview evidence',
      columns: [
        { key: 'initialSpeedMps', label: 'Initial speed', quantity: 'initial-speed', unit: 'm/s' },
        { key: 'launchAngleDeg', label: 'Launch angle', quantity: 'launch-angle', unit: 'deg' },
        { key: 'timeS', label: 'Time', quantity: 'time', unit: 's' },
        { key: 'xM', label: 'Horizontal position', quantity: 'range', unit: 'm' },
        { key: 'yM', label: 'Vertical position', quantity: 'height', unit: 'm' },
        { key: 'speedMps', label: 'Speed', quantity: 'speed', unit: 'm/s' },
        {
          key: 'velocityXMps',
          label: 'Horizontal velocity',
          quantity: 'velocity-x',
          unit: 'm/s',
        },
        {
          key: 'velocityYMps',
          label: 'Vertical velocity',
          quantity: 'velocity-y',
          unit: 'm/s',
        },
        { key: 'event', label: 'Event', quantity: null, unit: null },
      ],
      rows: scene.rows,
    },
  }
}

export const PROJECTILE_CONCEPT_SCHEMA = projectileConceptSpecSchema
export const PROJECTILE_SCENE_SCHEMA = projectileDomainSceneSchema
export const PROJECTILE_VERIFIED_OUTPUT_SCHEMA = normalizedProjectilePreviewSchema
