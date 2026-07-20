// LOC-EXEMPT: This declarative scientific record is easier to audit as one cohesive manifest.
import { domainPackManifestSchema } from '@simproof/domain-pack-sdk'
import inventory from './inventory.json' with { type: 'json' }

import { PENDULUM_FINDING_IDS, PENDULUM_POLICY } from './policy.js'

const scientificFinding = (id: string, category: 'applicability' | 'reference') => ({
  id,
  classification: 'scientific' as const,
  checkId: 'pendulum.period',
  category,
  severity: 'error' as const,
  lifecycle: 'finding' as const,
  explanation:
    category === 'applicability'
      ? 'The input is outside the reviewed small-angle pendulum scope.'
      : 'The candidate period exceeds the reviewed relative-error tolerance.',
})

const boundaryFinding = (
  id: string,
  classification: 'candidate-boundary' | 'concept-boundary',
) => ({
  id,
  classification,
  checkId: null,
  category: 'boundary' as const,
  severity: 'error' as const,
  lifecycle: 'boundary-failure' as const,
  explanation: 'The value fails a strict application-owned pendulum boundary.',
})

const exactScientific = (
  verdict: 'inapplicable' | 'rejected' | 'verified',
  findingIds: readonly string[],
) => ({ kind: 'scientific' as const, verdict, findingIds: [...findingIds], sampleCount: 3 })

const evidenceId = 'pendulum.controls'
const derivationEvidenceId = 'pendulum.derivation'
const applicabilityEvidenceId = 'pendulum.applicability'
const toleranceEvidenceId = 'pendulum.tolerance'

export const PENDULUM_DOMAIN_MANIFEST = domainPackManifestSchema.parse({
  schemaVersion: '1',
  id: 'pendulum',
  version: '1.0.0',
  title: 'Ideal small-angle pendulum',
  description: 'Trusted period verification for an ideal undamped small-angle pendulum.',
  learningScope: [
    'Explore how pendulum length changes period under the small-angle approximation.',
    'Distinguish the supported ideal model from nonlinear, damped, and driven pendulums.',
  ],
  evidence: [
    {
      id: derivationEvidenceId,
      kind: 'derivation',
      description: 'Small-angle period derivation.',
    },
    {
      id: applicabilityEvidenceId,
      kind: 'applicability',
      description: 'Reviewed length and amplitude bounds.',
    },
    {
      id: toleranceEvidenceId,
      kind: 'tolerance-calibration',
      description: 'Nonlinear endpoint comparison and error budget.',
    },
    { id: 'pendulum.units', kind: 'derivation', description: 'Canonical SI and angular units.' },
    {
      id: evidenceId,
      kind: 'verification-control',
      description: 'Exact positive, negative, property, and boundary controls.',
    },
    {
      id: 'pendulum.pedagogy',
      kind: 'pedagogy',
      description: 'Teacher-facing learning and accessibility review.',
    },
  ],
  claims: [
    {
      id: 'pendulum.period-equation',
      kind: 'equation',
      subject: 'reference.ts#pendulumPeriodSeconds',
      statement: 'T = 2 pi sqrt(L / g).',
      evidenceIds: [derivationEvidenceId],
    },
    {
      id: 'pendulum.gravity-constant',
      kind: 'constant',
      subject: 'policy.ts#EARTH_GRAVITY_MPS2',
      statement: 'Configured gravity is 9.81 m/s^2.',
      evidenceIds: [derivationEvidenceId],
    },
    {
      id: 'pendulum.small-angle-assumption',
      kind: 'assumption',
      subject: 'policy.assumptions[0]',
      statement: 'The ideal undamped pendulum follows the small-angle approximation.',
      evidenceIds: [derivationEvidenceId, applicabilityEvidenceId],
    },
    {
      id: 'pendulum.closed-form-method',
      kind: 'numerical-method',
      subject: 'reference.ts#pendulumPeriodSeconds',
      statement: 'The trusted reference is a deterministic closed-form evaluation.',
      evidenceIds: [derivationEvidenceId],
    },
  ],
  citations: [
    {
      id: 'pendulum.openstax.simple-period',
      title: 'College Physics: The Simple Pendulum',
      authors: ['Paul Peter Urone', 'Roger Hinrichs'],
      edition: '2012 edition',
      locator: {
        source: 'https://openstax.org/books/college-physics/pages/16-4-the-simple-pendulum',
        section: 'Section 16.4',
        equation: 'Equations 16.23–16.29',
      },
      supportedEvidenceIds: [derivationEvidenceId, applicabilityEvidenceId],
    },
    {
      id: 'pendulum.nist.nonlinear-period',
      title: 'DLMF Classical Dynamics: The Pendulum',
      authors: [],
      issuingBody: 'National Institute of Standards and Technology',
      edition: 'DLMF version 1.2.7',
      locator: {
        source: 'https://dlmf.nist.gov/22.19.i',
        section: 'Section 22.19(i)',
        equation: 'Equations 22.19.1–22.19.2',
      },
      supportedEvidenceIds: [toleranceEvidenceId, applicabilityEvidenceId],
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
      supportedEvidenceIds: ['pendulum.units'],
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
    { quantity: 'length', symbol: 'm', dimension: 'length' },
    { quantity: 'amplitude', symbol: 'deg', dimension: 'angle' },
    { quantity: 'period', symbol: 's', dimension: 'time' },
    { quantity: 'time', symbol: 's', dimension: 'time' },
    { quantity: 'angle', symbol: 'deg', dimension: 'angle' },
    { quantity: 'angular-velocity', symbol: 'deg/s', dimension: 'angular-velocity' },
    { quantity: 'period-relative-error', symbol: 'ratio', dimension: 'dimensionless' },
    { quantity: 'gravity', symbol: 'm/s^2', dimension: 'acceleration' },
  ],
  applicability: {
    description: 'Length is closed from 0.5 m to 2 m; amplitude is open at 0° and closed at 15°.',
    bounds: [
      {
        quantity: 'length',
        unit: 'm',
        minimum: { value: 0.5, inclusive: true },
        maximum: { value: 2, inclusive: true },
        outOfRange: 'inapplicable',
      },
      {
        quantity: 'amplitude',
        unit: 'deg',
        minimum: { value: 0, inclusive: false },
        maximum: { value: 15, inclusive: true },
        outOfRange: 'inapplicable',
      },
    ],
    singularities: [
      { id: 'pendulum.zero-length', condition: 'length <= 0 m', disposition: 'inapplicable' },
    ],
    evidenceIds: [applicabilityEvidenceId],
  },
  policies: [
    {
      id: PENDULUM_POLICY.id,
      version: PENDULUM_POLICY.version,
      evidenceIds: [derivationEvidenceId, applicabilityEvidenceId],
      toleranceEvidenceIds: [toleranceEvidenceId],
      thresholds: [
        {
          id: 'pendulum.period.relative-tolerance',
          quantity: 'period-relative-error',
          unit: 'ratio',
          value: 0.01,
          evidenceIds: [toleranceEvidenceId],
        },
      ],
    },
  ],
  findings: [
    boundaryFinding('pendulum.concept.invalid', 'concept-boundary'),
    boundaryFinding('pendulum.concept.unsupported-domain', 'concept-boundary'),
    boundaryFinding('pendulum.concept.out-of-domain', 'concept-boundary'),
    boundaryFinding(PENDULUM_FINDING_IDS.invalidCandidate, 'candidate-boundary'),
    boundaryFinding(PENDULUM_FINDING_IDS.invalidUnits, 'candidate-boundary'),
    boundaryFinding(PENDULUM_FINDING_IDS.nonFiniteOutput, 'candidate-boundary'),
    scientificFinding(PENDULUM_FINDING_IDS.outsideApplicability, 'applicability'),
    scientificFinding(PENDULUM_FINDING_IDS.periodRelativeError, 'reference'),
  ],
  controls: {
    positive: [
      {
        id: 'pendulum-correct',
        evidenceId,
        path: 'tests/fixtures/correct/pendulum-correct.json',
        expected: exactScientific('verified', []),
      },
    ],
    negative: [
      {
        id: 'pendulum-bad-units',
        evidenceId,
        path: 'tests/fixtures/negative-controls/pendulum-bad-units.json',
        expected: { kind: 'boundary-failure', errorId: PENDULUM_FINDING_IDS.invalidUnits },
      },
      {
        id: 'pendulum-inverted-ratio',
        evidenceId,
        path: 'tests/fixtures/negative-controls/pendulum-inverted-ratio.json',
        expected: exactScientific(
          'rejected',
          Array(3).fill(PENDULUM_FINDING_IDS.periodRelativeError),
        ),
      },
      {
        id: 'pendulum-nonfinite-output',
        evidenceId,
        path: 'tests/fixtures/negative-controls/pendulum-nonfinite-output.json',
        expected: { kind: 'boundary-failure', errorId: PENDULUM_FINDING_IDS.nonFiniteOutput },
      },
      {
        id: 'pendulum-out-of-domain',
        evidenceId,
        path: 'tests/fixtures/negative-controls/pendulum-out-of-domain.json',
        expected: exactScientific(
          'inapplicable',
          Array(3).fill(PENDULUM_FINDING_IDS.outsideApplicability),
        ),
      },
    ],
    property: [
      {
        id: 'pendulum-sqrt-length',
        evidenceId,
        seed: 20_260_716,
        runCount: 100,
        generator: {
          description: 'Pairs of finite supported lengths.',
          ranges: [{ quantity: 'length', unit: 'm', min: 0.5, max: 2 }],
        },
        invariantId: 'pendulum.period.sqrt-length',
        allowedError: { value: 1e-12, unit: 'ratio' },
        expected: 'passed',
      },
    ],
    boundary: [
      [
        'pendulum-length-minimum',
        'length',
        'm',
        0.5,
        'applicability-endpoint',
        'length.minimum',
        0.499_999,
        0.500_001,
      ],
      [
        'pendulum-length-maximum',
        'length',
        'm',
        2,
        'applicability-endpoint',
        'length.maximum',
        1.999_999,
        2.000_001,
      ],
      [
        'pendulum-amplitude-minimum',
        'amplitude',
        'deg',
        0,
        'applicability-endpoint',
        'amplitude.minimum',
        -0.000_001,
        0.000_001,
      ],
      [
        'pendulum-amplitude-maximum',
        'amplitude',
        'deg',
        15,
        'applicability-endpoint',
        'amplitude.maximum',
        14.999_999,
        15.000_001,
      ],
      [
        'pendulum-zero-length',
        'length',
        'm',
        0,
        'singularity',
        'pendulum.zero-length',
        -0.000_001,
        0.000_001,
      ],
      [
        'pendulum-period-tolerance',
        'period-relative-error',
        'ratio',
        0.01,
        'tolerance-threshold',
        'pendulum.period.relative-tolerance',
        0.009_999,
        0.010_001,
      ],
    ].map(([id, quantity, unit, value, kind, coversId, below, above]) => ({
      id,
      evidenceId,
      threshold: { quantity, unit, value },
      covers: { kind, id: coversId },
      cases: { below, equal: value, above },
      expected: 'passed',
    })),
  },
  capabilities: {
    renderer: 'pendulum-bob',
    features: ['equilibrium-line', 'turning-points'],
    accessibleRepresentation: { summary: true, table: true },
  },
  sdkCompatibility: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
  scientificReview: {
    reviewedAt: '2026-07-17',
    subject: {
      pack: { id: 'pendulum', version: '1.0.0' },
      policies: [{ id: PENDULUM_POLICY.id, version: PENDULUM_POLICY.version }],
    },
    reviewArtifact: {
      id: 'pendulum.review.1-0-0',
      baseRevision: {
        kind: 'git-commit',
        reference: '34255b495c2e01b66c44942b3ec9568c12f6de9b',
      },
    },
    audits: [
      {
        id: 'pendulum.audit.scientific.1-0-0',
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
            id: 'pendulum.check.domain-pack-conformance',
            command: 'pnpm test:domain-packs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'pendulum.audit.pedagogical.1-0-0',
        kind: 'pedagogical',
        actor: {
          id: 'codex.cp011-pedagogical-review',
          displayName: 'Plan 011 automated pedagogical audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: ['pendulum.pedagogy'],
        exactChecks: [
          {
            id: 'pendulum.check.documentation',
            command: 'pnpm test --filter docs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'pendulum.audit.accessibility.1-0-0',
        kind: 'accessibility',
        actor: {
          id: 'codex.cp011-accessibility-review',
          displayName: 'Plan 011 automated accessibility audit',
          type: 'automated',
          humanCredentialClaim: false,
        },
        decision: 'accepted',
        evidenceIds: ['pendulum.pedagogy'],
        exactChecks: [
          {
            id: 'pendulum.check.accessible-equivalence',
            command: 'pnpm test:domain-packs',
            outcome: 'passed',
          },
        ],
      },
      {
        id: 'pendulum.audit.maintainer.1-0-0',
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
            id: 'pendulum.check.repository-gate',
            command: 'pnpm check',
            outcome: 'passed',
          },
        ],
      },
    ],
    applicabilityDerivation:
      'The small-angle approximation is bounded to amplitudes above 0° through 15° and the reviewed instructional length range.',
    numericalMethodJustification:
      'The trusted reference is closed-form; nonlinear elliptic-period evaluation is calibration evidence only.',
    changeControl: {
      compatibility: 'backward-compatible',
      classifications: ['scientific', 'governance', 'pedagogical', 'accessibility'],
      staleReasons: ['domain-pack-changed'],
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
