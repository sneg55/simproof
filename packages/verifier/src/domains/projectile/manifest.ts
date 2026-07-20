// LOC-EXEMPT: This declarative scientific record is easier to audit as one cohesive manifest.
import { domainPackManifestSchema } from '@simproof/domain-pack-sdk'
import { PROJECTILE_CONCEPT_ERROR_IDS } from './concept.js'
import inventory from './inventory.json' with { type: 'json' }
import {
  PROJECTILE_BOUNDARY_ERROR_IDS,
  PROJECTILE_FINDING_IDS,
  PROJECTILE_POLICY,
} from './policy.js'

const evidenceId = 'projectile.controls'
const derivationEvidenceId = 'projectile.derivation'
const applicabilityEvidenceId = 'projectile.applicability'
const toleranceEvidenceId = 'projectile.tolerance'
const boundaryFailure = 'boundary-failure' as const
const speedUnit = 'm/s'
const speedDimension = 'speed'
const ratioUnit = 'ratio'
const dimensionless = 'dimensionless'
const initialSpeedQuantity = 'initial-speed'
const launchAngleQuantity = 'launch-angle'
const scientific = (id: string, checkId: string, category = 'reference') => ({
  id,
  classification: 'scientific' as const,
  checkId,
  category,
  severity: 'error' as const,
  lifecycle: 'finding' as const,
  explanation: 'The candidate violates a trusted projectile policy check.',
})
const boundary = (id: string, classification: 'candidate-boundary' | 'concept-boundary') => ({
  id,
  classification,
  checkId: null,
  category: 'boundary' as const,
  severity: 'error' as const,
  lifecycle: boundaryFailure,
  explanation: 'The value fails a strict application-owned projectile boundary.',
})
const exact = (verdict: 'rejected' | 'verified', findingIds: readonly string[]) => ({
  kind: 'scientific' as const,
  verdict,
  findingIds: [...findingIds],
  sampleCount: 9,
})
const ids = PROJECTILE_FINDING_IDS
const coarse: string[] = [
  ...Array.from({ length: 5 }, () => [
    ids.rangeMismatch,
    ids.apexMismatch,
    ids.flightTimeMismatch,
    ids.trajectoryResidual,
    ids.energyDrift,
  ]).flat(),
  ids.rangeMaximumViolation,
]
const dropped = [
  ids.rangeMismatch,
  ids.sampleLocationMismatch,
  ids.trajectoryResidual,
  ids.energyDrift,
  ids.rangeMismatch,
  ids.sampleLocationMismatch,
  ids.trajectoryResidual,
  ids.energyDrift,
  ids.trajectoryResidual,
  ids.energyDrift,
  ids.rangeMismatch,
  ids.sampleLocationMismatch,
  ids.trajectoryResidual,
  ids.energyDrift,
  ids.rangeMismatch,
  ids.sampleLocationMismatch,
  ids.trajectoryResidual,
  ids.energyDrift,
  ids.rangeMaximumViolation,
]
const radians: string[] = [
  ...Array.from({ length: 5 }, () => [
    ids.rangeMismatch,
    ids.apexMismatch,
    ids.flightTimeMismatch,
    ids.sampleLocationMismatch,
    ids.trajectoryResidual,
  ]).flat(),
  ids.energyDrift,
]

const projectileThresholds = [
  {
    id: 'projectile.range.relative-tolerance',
    quantity: 'range-error',
    unit: 'ratio',
    value: 0.01,
  },
  { id: 'projectile.apex.relative-tolerance', quantity: 'apex-error', unit: 'ratio', value: 0.01 },
  {
    id: 'projectile.flight-time.relative-tolerance',
    quantity: 'flight-time-error',
    unit: 'ratio',
    value: 0.01,
  },
  {
    id: 'projectile.trajectory-y.relative-tolerance',
    quantity: 'trajectory-y-error',
    unit: 'ratio',
    value: 0.02,
  },
  {
    id: 'projectile.trajectory-time.relative-scale',
    quantity: 'trajectory-time-error',
    unit: 'ratio',
    value: 1e-10,
  },
  {
    id: 'projectile.trajectory-x.relative-tolerance',
    quantity: 'trajectory-x-error',
    unit: 'ratio',
    value: 1e-10,
  },
  {
    id: 'projectile.energy.relative-tolerance',
    quantity: 'specific-energy-error',
    unit: 'ratio',
    value: 0.02,
  },
  {
    id: 'projectile.range-maximum.relative-ordering',
    quantity: 'range-ordering-error',
    unit: 'ratio',
    value: 0.01,
  },
] as const

const boundaryControl = (input: {
  readonly id: string
  readonly quantity: string
  readonly unit: string
  readonly value: number
  readonly kind: 'applicability-endpoint' | 'tolerance-threshold'
  readonly coversId: string
  readonly below: number
  readonly above: number
}) => ({
  id: input.id,
  evidenceId,
  threshold: { quantity: input.quantity, unit: input.unit, value: input.value },
  covers: { kind: input.kind, id: input.coversId },
  cases: { below: input.below, equal: input.value, above: input.above },
  expected: 'passed' as const,
})

export const PROJECTILE_DOMAIN_MANIFEST = domainPackManifestSchema.parse({
  schemaVersion: '1',
  id: 'projectile',
  version: '1.1.0',
  title: 'Vacuum projectile motion on level ground',
  description: 'Trusted analytic verification for point-mass projectile motion without drag.',
  learningScope: [
    'Explore launch speed and angle effects in the reviewed level-ground vacuum model.',
    'Compare scalar, trajectory, energy, and maximum-range invariants.',
  ],
  evidence: [
    {
      id: derivationEvidenceId,
      kind: 'derivation',
      description: 'Constant-gravity kinematic derivation.',
    },
    {
      id: applicabilityEvidenceId,
      kind: 'applicability',
      description: 'Reviewed speed and angle bounds.',
    },
    {
      id: toleranceEvidenceId,
      kind: 'tolerance-calibration',
      description: 'Scalar, trajectory, and invariant error budgets.',
    },
    { id: 'projectile.units', kind: 'derivation', description: 'Canonical SI and angular units.' },
    {
      id: evidenceId,
      kind: 'verification-control',
      description: 'Exact positive, defect, property, and boundary controls.',
    },
    {
      id: 'projectile.pedagogy',
      kind: 'pedagogy',
      description: 'Teacher-facing learning and accessibility review.',
    },
  ],
  claims: [
    {
      id: 'projectile.kinematic-equations',
      kind: 'equation',
      subject: 'reference.ts#projectileReference',
      statement: 'Vacuum component kinematics determine range, apex height, and flight time.',
      evidenceIds: [derivationEvidenceId],
    },
    {
      id: 'projectile.gravity-constant',
      kind: 'constant',
      subject: 'policy.applicability.gravityMps2',
      statement: 'Configured gravity is 9.81 m/s^2.',
      evidenceIds: [derivationEvidenceId],
    },
    {
      id: 'projectile.range-maximum',
      kind: 'equation',
      subject: 'policy.tolerances.rangeMaximum',
      statement: 'Level-ground vacuum range is maximal at 45 degrees.',
      evidenceIds: [derivationEvidenceId],
    },
    {
      id: 'projectile.vacuum-assumptions',
      kind: 'assumption',
      subject: 'policy.assumptions',
      statement: 'The model is vacuum, level-ground, constant-gravity point-mass motion.',
      evidenceIds: [derivationEvidenceId, applicabilityEvidenceId],
    },
    {
      id: 'projectile.closed-form-method',
      kind: 'numerical-method',
      subject: 'reference.ts#projectileReference',
      statement: 'The trusted reference uses deterministic analytic component equations.',
      evidenceIds: [derivationEvidenceId],
    },
  ],
  citations: [
    {
      id: 'projectile.openstax.motion',
      title: 'College Physics: Projectile Motion',
      authors: ['Paul Peter Urone', 'Roger Hinrichs'],
      edition: '2012 edition',
      locator: {
        source: 'https://openstax.org/books/college-physics/pages/3-4-projectile-motion',
        section: 'Section 3.4',
        equation: 'Projectile-motion component equations',
      },
      supportedEvidenceIds: [derivationEvidenceId],
    },
    {
      id: 'units.bipm.si-9',
      title: 'The International System of Units (SI Brochure)',
      authors: [],
      issuingBody: 'Bureau International des Poids et Mesures',
      edition: '9th edition, version 4.01',
      locator: {
        source: 'https://www.bipm.org/en/publications/si-brochure',
        section: 'Sections 2.3.3–2.3.4',
      },
      supportedEvidenceIds: ['projectile.units'],
    },
    {
      id: 'gravity.nist.sp811',
      title: 'NIST Guide for the Use of the International System of Units',
      authors: ['Ambler Thompson', 'Barry N. Taylor'],
      edition: '2008 edition',
      locator: {
        source:
          'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8',
        section: 'Appendix B.8, acceleration of free fall, standard',
      },
      supportedEvidenceIds: [derivationEvidenceId],
    },
  ],
  units: [
    { quantity: initialSpeedQuantity, symbol: speedUnit, dimension: speedDimension },
    { quantity: launchAngleQuantity, symbol: 'deg', dimension: 'angle' },
    { quantity: 'range', symbol: 'm', dimension: 'length' },
    { quantity: 'height', symbol: 'm', dimension: 'length' },
    { quantity: 'time', symbol: 's', dimension: 'time' },
    { quantity: 'speed', symbol: speedUnit, dimension: speedDimension },
    { quantity: 'velocity-x', symbol: speedUnit, dimension: speedDimension },
    { quantity: 'velocity-y', symbol: speedUnit, dimension: speedDimension },
    { quantity: 'gravity', symbol: 'm/s^2', dimension: 'acceleration' },
    { quantity: 'specific-energy', symbol: 'J/kg', dimension: 'specific-energy' },
    { quantity: 'range-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'apex-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'flight-time-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'trajectory-y-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'trajectory-time-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'trajectory-x-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'specific-energy-error', symbol: ratioUnit, dimension: dimensionless },
    { quantity: 'range-ordering-error', symbol: ratioUnit, dimension: dimensionless },
  ],
  applicability: {
    description: 'Speed and launch angle use closed reviewed instructional ranges.',
    bounds: [
      {
        quantity: initialSpeedQuantity,
        unit: 'm/s',
        minimum: { value: 15, inclusive: true },
        maximum: { value: 40, inclusive: true },
        outOfRange: boundaryFailure,
      },
      {
        quantity: launchAngleQuantity,
        unit: 'deg',
        minimum: { value: 15, inclusive: true },
        maximum: { value: 75, inclusive: true },
        outOfRange: boundaryFailure,
      },
    ],
    singularities: [],
    evidenceIds: [applicabilityEvidenceId],
  },
  policies: [
    {
      id: PROJECTILE_POLICY.id,
      version: PROJECTILE_POLICY.version,
      evidenceIds: [derivationEvidenceId, applicabilityEvidenceId],
      toleranceEvidenceIds: [toleranceEvidenceId],
      thresholds: projectileThresholds.map((threshold) => ({
        ...threshold,
        evidenceIds: [toleranceEvidenceId],
      })),
    },
  ],
  findings: [
    boundary(PROJECTILE_CONCEPT_ERROR_IDS.invalid, 'concept-boundary'),
    boundary(PROJECTILE_CONCEPT_ERROR_IDS.outOfPolicy, 'concept-boundary'),
    boundary(PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation, 'candidate-boundary'),
    boundary(PROJECTILE_BOUNDARY_ERROR_IDS.unsupportedUnits, 'candidate-boundary'),
    scientific(ids.rangeMismatch, 'projectile.range'),
    scientific(ids.apexMismatch, 'projectile.apex-height'),
    scientific(ids.flightTimeMismatch, 'projectile.flight-time'),
    scientific(ids.trajectoryResidual, 'projectile.trajectory-curve'),
    scientific(ids.energyDrift, 'projectile.energy-conservation', 'invariant'),
    scientific(ids.rangeMaximumViolation, 'projectile.range-maximum', 'invariant'),
    scientific(ids.sampleCoverageInsufficient, 'projectile.trajectory-curve'),
    scientific(ids.sampleLocationMismatch, 'projectile.trajectory-curve'),
  ],
  controls: {
    positive: [
      {
        id: 'projectile-analytic',
        evidenceId,
        path: 'tests/fixtures/correct/projectile-analytic.json',
        expected: exact('verified', []),
      },
      {
        id: 'projectile-fine-symplectic',
        evidenceId,
        path: 'tests/fixtures/correct/projectile-fine-symplectic.json',
        expected: exact('verified', []),
      },
    ],
    negative: [
      {
        id: 'projectile-bad-output',
        evidenceId,
        path: 'tests/fixtures/negative-controls/projectile-bad-output.json',
        expected: {
          kind: boundaryFailure,
          errorId: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        },
      },
      {
        id: 'projectile-bad-units',
        evidenceId,
        path: 'tests/fixtures/negative-controls/projectile-bad-units.json',
        expected: {
          kind: boundaryFailure,
          errorId: PROJECTILE_BOUNDARY_ERROR_IDS.unsupportedUnits,
        },
      },
      {
        id: 'projectile-coarse-euler',
        evidenceId,
        path: 'tests/fixtures/negative-controls/projectile-coarse-euler.json',
        expected: exact('rejected', coarse),
      },
      {
        id: 'projectile-dropped-factor',
        evidenceId,
        path: 'tests/fixtures/negative-controls/projectile-dropped-factor.json',
        expected: exact('rejected', dropped),
      },
      {
        id: 'projectile-radians',
        evidenceId,
        path: 'tests/fixtures/negative-controls/projectile-radians.json',
        expected: exact('rejected', radians),
      },
    ],
    property: [
      {
        id: 'projectile-analytic-relations',
        evidenceId,
        seed: 20_260_716,
        runCount: 100,
        generator: {
          description: 'Finite supported speed and launch-angle pairs.',
          ranges: [
            { quantity: initialSpeedQuantity, unit: 'm/s', min: 15, max: 40 },
            { quantity: launchAngleQuantity, unit: 'deg', min: 15, max: 75 },
          ],
        },
        invariantId: 'projectile.analytic-relations',
        allowedError: { value: 1e-12, unit: 'ratio' },
        expected: 'passed',
      },
    ],
    boundary: [
      boundaryControl({
        id: 'projectile-speed-minimum',
        quantity: initialSpeedQuantity,
        unit: 'm/s',
        value: 15,
        kind: 'applicability-endpoint',
        coversId: 'initial-speed.minimum',
        below: 14.999_999,
        above: 15.000_001,
      }),
      boundaryControl({
        id: 'projectile-speed-maximum',
        quantity: initialSpeedQuantity,
        unit: 'm/s',
        value: 40,
        kind: 'applicability-endpoint',
        coversId: 'initial-speed.maximum',
        below: 39.999_999,
        above: 40.000_001,
      }),
      boundaryControl({
        id: 'projectile-angle-minimum',
        quantity: launchAngleQuantity,
        unit: 'deg',
        value: 15,
        kind: 'applicability-endpoint',
        coversId: 'launch-angle.minimum',
        below: 14.999_999,
        above: 15.000_001,
      }),
      boundaryControl({
        id: 'projectile-angle-maximum',
        quantity: launchAngleQuantity,
        unit: 'deg',
        value: 75,
        kind: 'applicability-endpoint',
        coversId: 'launch-angle.maximum',
        below: 74.999_999,
        above: 75.000_001,
      }),
      ...projectileThresholds.map(({ id, quantity, unit, value }) =>
        boundaryControl({
          id: `control-${id}`,
          quantity,
          unit,
          value,
          kind: 'tolerance-threshold',
          coversId: id,
          below: value - Math.max(value * 0.001, 1e-12),
          above: value + Math.max(value * 0.001, 1e-12),
        }),
      ),
    ],
  },
  capabilities: {
    renderer: 'projectile-trajectory',
    features: ['trail', 'apex-marker', 'impact-marker'],
    accessibleRepresentation: { summary: true, table: true },
  },
  sdkCompatibility: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
  scientificReview: {
    reviewedAt: '2026-07-17',
    subject: {
      pack: { id: 'projectile', version: '1.1.0' },
      policies: [{ id: PROJECTILE_POLICY.id, version: PROJECTILE_POLICY.version }],
    },
    reviewArtifact: {
      id: 'projectile.review.1-1-0',
      baseRevision: {
        kind: 'git-commit',
        reference: '34255b495c2e01b66c44942b3ec9568c12f6de9b',
      },
    },
    audits: [
      {
        id: 'projectile.audit.scientific.1-1-0',
        kind: 'scientific',
        actor: {
          id: 'codex.cp011-science-review',
          displayName: 'Plan 011 independent automated scientific audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: [
          derivationEvidenceId,
          applicabilityEvidenceId,
          toleranceEvidenceId,
          evidenceId,
        ],
        exactChecks: [
          {
            id: 'projectile.check.domain-pack-conformance',
            command: 'pnpm test:domain-packs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'projectile.audit.pedagogical.1-1-0',
        kind: 'pedagogical',
        actor: {
          id: 'codex.cp011-pedagogical-review',
          displayName: 'Plan 011 automated pedagogical audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: ['projectile.pedagogy'],
        exactChecks: [
          {
            id: 'projectile.check.documentation',
            command: 'pnpm test --filter docs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'projectile.audit.accessibility.1-1-0',
        kind: 'accessibility',
        actor: {
          id: 'codex.cp011-accessibility-review',
          displayName: 'Plan 011 automated accessibility audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: ['projectile.pedagogy'],
        exactChecks: [
          {
            id: 'projectile.check.accessible-equivalence',
            command: 'pnpm test:domain-packs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'projectile.audit.maintainer.1-1-0',
        kind: 'maintainer',
        actor: {
          id: 'simproof.maintainers',
          displayName: 'SimProof automated checkpoint maintainer audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: [evidenceId],
        exactChecks: [
          {
            id: 'projectile.check.repository-gate',
            command: 'pnpm check',
            outcome: 'passed',
          },
        ],
      },
    ],
    applicabilityDerivation:
      'The reviewed instructional grid is closed over speed 15–40 m/s and angle 15–75°.',
    numericalMethodJustification:
      'The trusted reference is analytic; numerical candidates are compared only at verifier-owned samples.',
    changeControl: {
      compatibility: 'backward-compatible',
      classifications: [
        'scientific',
        'implementation',
        'governance',
        'pedagogical',
        'accessibility',
      ],
      staleReasons: ['policy-changed', 'domain-pack-changed'],
    },
    maintainers: [
      {
        id: 'simproof.maintainers',
        name: 'SimProof maintainers',
        contact: 'repository maintainers',
        actorType: 'automated',
        humanCredentialClaim: false,
      },
    ],
  },
  contentInventory: inventory.paths,
})
