import {
  normalizedPendulumPreviewSchema,
  type ParameterRange,
  type PendulumInput,
  type PendulumObservation,
  type PendulumPreview,
  pendulumConceptSpecSchema,
  pendulumDomainSceneSchema,
  pendulumObservationSchema,
} from '@simproof/contracts'
import type {
  AccessibleDomainRepresentation,
  DomainPackConformanceCases,
  DomainReportAdapter,
} from '@simproof/domain-pack-sdk'
import { PENDULUM_PERIOD_RELATIVE_TOLERANCE, PENDULUM_POLICY } from './policy.js'
import { isPendulumInputApplicable, pendulumPeriodSeconds } from './reference.js'
import { CANONICAL_PENDULUM_UNITS, verifyPendulumCandidate } from './verifier.js'

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

const validateObservations = (values: readonly unknown[]): readonly PendulumObservation[] => {
  if (values.length === 0) throw new TypeError('Pendulum observations must not be empty.')
  return values.map((value) => pendulumObservationSchema.parse(value))
}

export const PENDULUM_REPORT_ADAPTER: DomainReportAdapter = {
  validateObservations,
  verifyObservations: (values) => {
    const observations = validateObservations(values)
    const outcome = verifyPendulumCandidate({
      domain: 'pendulum',
      units: CANONICAL_PENDULUM_UNITS,
      observations,
    })
    if (!outcome.ok) throw new TypeError(`Cannot verify pendulum observations: ${outcome.error.id}`)
    return outcome.result
  },
  expectedInputs: () => PENDULUM_POLICY.sampling.cases,
  observationInput: (value) => pendulumObservationSchema.parse(value).input,
  testedParameters: (values) => {
    const observations = validateObservations(values)
    return [
      parameterRange(
        'lengthM',
        'm',
        observations.map(({ input }) => input.lengthM),
      ),
      parameterRange(
        'amplitudeDeg',
        'deg',
        observations.map(({ input }) => input.amplitudeDeg),
      ),
    ]
  },
  sampleCountForCheck: (_checkId, result) =>
    result.verdict === 'inapplicable' ? result.sampleCount : PENDULUM_POLICY.sampling.cases.length,
}

export const pendulumAccessibleRepresentation = (
  preview: PendulumPreview,
): AccessibleDomainRepresentation => {
  const verified = normalizedPendulumPreviewSchema.parse(preview)
  const rows = verified.samples.flatMap((sample) => {
    const events = verified.events.filter(({ sampleIndex }) => sampleIndex === sample.index)
    return (events.length === 0 ? [{ kind: 'none' as const }] : events).map(({ kind }) => ({
      lengthM: verified.input.lengthM,
      amplitudeDeg: verified.input.amplitudeDeg,
      periodS: verified.periodS,
      timeS: sample.timeS,
      angleDeg: sample.angleDeg,
      angularVelocityDegPerS: sample.angularVelocityDegPerS ?? ('not-provided' as const),
      event: kind,
    }))
  })
  const scene = pendulumDomainSceneSchema.parse({
    renderer: 'pendulum-bob',
    rows,
    assumptions: verified.evidence.assumptions,
    limitations: verified.evidence.limitations,
  })
  return {
    scene,
    assumptions: scene.assumptions,
    limitations: scene.limitations,
    summary:
      'Pendulum input, period, angular state, and event values from verified preview output.',
    table: {
      caption: 'Verified pendulum preview evidence',
      columns: [
        { key: 'lengthM', label: 'Length', quantity: 'length', unit: 'm' },
        { key: 'amplitudeDeg', label: 'Amplitude', quantity: 'amplitude', unit: 'deg' },
        { key: 'periodS', label: 'Period', quantity: 'period', unit: 's' },
        { key: 'timeS', label: 'Time', quantity: 'time', unit: 's' },
        { key: 'angleDeg', label: 'Angle', quantity: 'angle', unit: 'deg' },
        {
          key: 'angularVelocityDegPerS',
          label: 'Angular velocity',
          quantity: 'angular-velocity',
          unit: 'deg/s',
        },
        { key: 'event', label: 'Event', quantity: null, unit: null },
      ],
      rows: scene.rows,
    },
  }
}

const samplePreview = normalizedPendulumPreviewSchema.parse({
  schemaVersion: '1',
  domain: 'pendulum',
  simulationVersionId: '11111111-1111-4111-8111-111111111111',
  conceptSpec: {
    schemaVersion: '1',
    domain: 'pendulum',
    title: 'Conformance pendulum',
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 0.001, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  },
  renderer: {
    schemaVersion: '1',
    domain: 'pendulum',
    renderer: 'pendulum-bob',
    features: ['equilibrium-line', 'turning-points'],
  },
  input: { lengthM: 1, amplitudeDeg: 5 },
  periodS: pendulumPeriodSeconds(1),
  evidence: {
    verificationRunId: '22222222-2222-4222-8222-222222222222',
    artifactHash: `sha256:${'1'.repeat(64)}`,
    validity: { status: 'current' },
    assumptions: PENDULUM_POLICY.assumptions,
    limitations: PENDULUM_POLICY.limitations,
  },
  samples: [
    { index: 0, timeS: 0, angleDeg: 5, angularVelocityDegPerS: 0 },
    { index: 1, timeS: 0.5, angleDeg: 0, angularVelocityDegPerS: -10 },
  ],
  events: [
    { kind: 'left-turning-point', sampleIndex: 0 },
    { kind: 'equilibrium-crossing', sampleIndex: 1 },
  ],
})

const propertyPasses = (seed: number, runCount: number, allowedError: number): boolean => {
  let state = seed >>> 0
  for (let index = 0; index < runCount; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const first = 0.5 + (state / 0xffff_ffff) * 1.5
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const second = 0.5 + (state / 0xffff_ffff) * 1.5
    const ratio = pendulumPeriodSeconds(second) / pendulumPeriodSeconds(first)
    if (Math.abs(ratio - Math.sqrt(second / first)) > allowedError) return false
  }
  return true
}

const endpointPasses = (id: string, below: number, equal: number, above: number): boolean => {
  if (id === 'length.minimum') {
    return (
      !isPendulumInputApplicable(below, 5) &&
      isPendulumInputApplicable(equal, 5) &&
      isPendulumInputApplicable(above, 5)
    )
  }
  if (id === 'length.maximum') {
    return (
      isPendulumInputApplicable(below, 5) &&
      isPendulumInputApplicable(equal, 5) &&
      !isPendulumInputApplicable(above, 5)
    )
  }
  if (id === 'amplitude.minimum') {
    return (
      !isPendulumInputApplicable(1, below) &&
      !isPendulumInputApplicable(1, equal) &&
      isPendulumInputApplicable(1, above)
    )
  }
  return (
    isPendulumInputApplicable(1, below) &&
    isPendulumInputApplicable(1, equal) &&
    !isPendulumInputApplicable(1, above)
  )
}

const representableBoundaryError = (relativeError: number): number =>
  Math.max(0, relativeError - 4 * Number.EPSILON * Math.max(1, Math.abs(relativeError)))

const toleranceOutcome = (relativeError: number) =>
  verifyPendulumCandidate({
    domain: 'pendulum',
    units: CANONICAL_PENDULUM_UNITS,
    observations: PENDULUM_POLICY.sampling.cases.map((input) => {
      const expected = pendulumPeriodSeconds(input.lengthM)
      return {
        input,
        // Use the nearest accepted-side representation so multiplication cannot
        // round the mathematical equality case above the policy threshold.
        periodS: expected + expected * representableBoundaryError(relativeError),
      }
    }),
  })

const toleranceBoundaryPasses = (below: number, equal: number, above: number): boolean => {
  const belowOutcome = toleranceOutcome(below)
  const equalOutcome = toleranceOutcome(equal)
  const aboveOutcome = toleranceOutcome(above)
  return (
    belowOutcome.ok &&
    belowOutcome.result.verdict === 'verified' &&
    belowOutcome.result.findings.length === 0 &&
    equalOutcome.ok &&
    equalOutcome.result.verdict === 'verified' &&
    equalOutcome.result.findings.length === 0 &&
    aboveOutcome.ok &&
    aboveOutcome.result.verdict === 'rejected' &&
    aboveOutcome.result.findings.length === 3 &&
    aboveOutcome.result.findings.every(({ id }) => id === 'pendulum.period.relative-error')
  )
}

const singularityBoundaryPasses = (below: number, equal: number, above: number): boolean =>
  below < 0 &&
  equal === 0 &&
  above > 0 &&
  !isPendulumInputApplicable(below, 5) &&
  !isPendulumInputApplicable(equal, 5) &&
  !isPendulumInputApplicable(above, 5) &&
  Number.isNaN(pendulumPeriodSeconds(below)) &&
  pendulumPeriodSeconds(equal) === 0 &&
  Number.isFinite(pendulumPeriodSeconds(above)) &&
  pendulumPeriodSeconds(above) > 0

export const PENDULUM_CONFORMANCE_CASES: DomainPackConformanceCases<
  PendulumInput,
  PendulumPreview
> = {
  referenceInputs: PENDULUM_POLICY.sampling.cases,
  supportedInputs: PENDULUM_POLICY.sampling.cases,
  unsupportedInputs: [
    { lengthM: 0.49, amplitudeDeg: 5 },
    { lengthM: 1, amplitudeDeg: 15.01 },
  ],
  accessibleInputs: [samplePreview],
  isApplicable: ({ amplitudeDeg, lengthM }) => isPendulumInputApplicable(lengthM, amplitudeDeg),
  runPropertyControl: ({ allowedError, id, runCount, seed }) =>
    id === 'pendulum-sqrt-length' &&
    allowedError.unit === 'ratio' &&
    propertyPasses(seed, runCount, allowedError.value),
  runBoundaryControl: ({ cases, covers, threshold }) => {
    if (cases.equal !== threshold.value) return false
    if (covers.kind === 'applicability-endpoint') {
      return endpointPasses(covers.id, cases.below, cases.equal, cases.above)
    }
    if (covers.kind === 'singularity') {
      return (
        covers.id === 'pendulum.zero-length' &&
        singularityBoundaryPasses(cases.below, cases.equal, cases.above)
      )
    }
    return (
      covers.id === 'pendulum.period.relative-tolerance' &&
      cases.equal === PENDULUM_PERIOD_RELATIVE_TOLERANCE &&
      toleranceBoundaryPasses(cases.below, cases.equal, cases.above)
    )
  },
}

export const PENDULUM_CONCEPT_SCHEMA = pendulumConceptSpecSchema
export const PENDULUM_SCENE_SCHEMA = pendulumDomainSceneSchema
export const PENDULUM_VERIFIED_OUTPUT_SCHEMA = normalizedPendulumPreviewSchema
