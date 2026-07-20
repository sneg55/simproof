import { domainPackManifestSchema } from './manifest.js'

const derivationEvidenceId = 'example-derivation'
const applicabilityEvidenceId = 'example-applicability'
const toleranceEvidenceId = 'example-tolerance'
const controlsEvidenceId = 'example-controls'

export const completeManifest = () =>
  domainPackManifestSchema.parse({
    schemaVersion: '1',
    id: 'example',
    version: '1.0.0',
    title: 'Reviewed example',
    description: 'A complete test-only scientific domain.',
    learningScope: ['Relate one measured input to one modeled output.'],
    evidence: [
      { id: derivationEvidenceId, kind: 'derivation', description: 'Reference derivation.' },
      { id: applicabilityEvidenceId, kind: 'applicability', description: 'Supported bounds.' },
      { id: toleranceEvidenceId, kind: 'tolerance-calibration', description: 'Exact tolerance.' },
      { id: controlsEvidenceId, kind: 'verification-control', description: 'Control outcomes.' },
      { id: 'example-pedagogy', kind: 'pedagogy', description: 'Learning review.' },
    ],
    claims: [
      {
        id: 'example.equation',
        kind: 'equation',
        subject: 'reference.ts#example',
        statement: 'output = 2 * input',
        evidenceIds: [derivationEvidenceId],
      },
      {
        id: 'example.constant',
        kind: 'constant',
        subject: 'policy.ts#scale',
        statement: 'scale = 2',
        evidenceIds: [derivationEvidenceId],
      },
      {
        id: 'example.assumption',
        kind: 'assumption',
        subject: 'policy.assumptions[0]',
        statement: 'Inputs are exact finite values.',
        evidenceIds: [derivationEvidenceId],
      },
      {
        id: 'example.method',
        kind: 'numerical-method',
        subject: 'reference.ts#example',
        statement: 'The trusted reference is closed-form.',
        evidenceIds: [derivationEvidenceId],
      },
    ],
    citations: [
      {
        id: 'example-source',
        title: 'Example source',
        authors: ['A. Reviewer'],
        edition: '1st edition',
        locator: { source: 'https://example.test/source', section: 'Section 1', equation: 'Eq. 1' },
        supportedEvidenceIds: [derivationEvidenceId, applicabilityEvidenceId, toleranceEvidenceId],
      },
    ],
    units: [
      { quantity: 'distance', symbol: 'm', dimension: 'length' },
      { quantity: 'elapsed-time', symbol: 's', dimension: 'time' },
      { quantity: 'output-error', symbol: 'm', dimension: 'length' },
    ],
    applicability: {
      description: 'Distance must be finite and positive.',
      bounds: [
        {
          quantity: 'distance',
          unit: 'm',
          minimum: { value: 0, inclusive: false },
          maximum: { value: 10, inclusive: true },
          outOfRange: 'inapplicable',
        },
      ],
      singularities: [
        { id: 'example.distance.zero', condition: 'distance = 0', disposition: 'inapplicable' },
      ],
      evidenceIds: [applicabilityEvidenceId],
    },
    policies: [
      {
        id: 'example.policy',
        version: '1.0.0',
        evidenceIds: [derivationEvidenceId],
        toleranceEvidenceIds: [toleranceEvidenceId],
        thresholds: [
          {
            id: 'example.output.exact',
            quantity: 'output-error',
            unit: 'm',
            value: 0,
            evidenceIds: [toleranceEvidenceId],
          },
        ],
      },
    ],
    findings: [
      {
        id: 'example.output.mismatch',
        classification: 'scientific',
        checkId: 'example.output',
        category: 'reference',
        severity: 'error',
        lifecycle: 'finding',
        explanation: 'Output differs from the reference.',
      },
    ],
    controls: {
      positive: [
        {
          id: 'example-correct',
          evidenceId: controlsEvidenceId,
          path: 'fixtures/example-correct.json',
          expected: { kind: 'scientific', verdict: 'verified', findingIds: [], sampleCount: 1 },
        },
      ],
      negative: [
        {
          id: 'example-wrong',
          evidenceId: controlsEvidenceId,
          path: 'fixtures/example-wrong.json',
          expected: {
            kind: 'scientific',
            verdict: 'rejected',
            findingIds: ['example.output.mismatch'],
            sampleCount: 1,
          },
        },
      ],
      property: [
        {
          id: 'example-scale',
          evidenceId: controlsEvidenceId,
          seed: 1,
          runCount: 100,
          generator: {
            description: 'Finite positive distances inside the supported range.',
            ranges: [{ quantity: 'distance', unit: 'm', min: 1, max: 10 }],
          },
          invariantId: 'example.linear-scale',
          allowedError: { value: 0, unit: 'm' },
          expected: 'passed',
        },
      ],
      boundary: [
        {
          id: 'example-zero',
          evidenceId: controlsEvidenceId,
          threshold: { quantity: 'distance', unit: 'm', value: 0 },
          covers: { kind: 'applicability-endpoint', id: 'distance.minimum' },
          cases: { below: -1, equal: 0, above: 1 },
          expected: 'passed',
        },
        {
          id: 'example-ten',
          evidenceId: controlsEvidenceId,
          threshold: { quantity: 'distance', unit: 'm', value: 10 },
          covers: { kind: 'applicability-endpoint', id: 'distance.maximum' },
          cases: { below: 9.999, equal: 10, above: 10.001 },
          expected: 'passed',
        },
        {
          id: 'example-singularity-zero',
          evidenceId: controlsEvidenceId,
          threshold: { quantity: 'distance', unit: 'm', value: 0 },
          covers: { kind: 'singularity', id: 'example.distance.zero' },
          cases: { below: -1, equal: 0, above: 1 },
          expected: 'passed',
        },
        {
          id: 'example-output-threshold',
          evidenceId: controlsEvidenceId,
          threshold: { quantity: 'output-error', unit: 'm', value: 0 },
          covers: { kind: 'tolerance-threshold', id: 'example.output.exact' },
          cases: { below: -0.001, equal: 0, above: 0.001 },
          expected: 'passed',
        },
      ],
    },
    capabilities: {
      renderer: 'example-line',
      features: [],
      accessibleRepresentation: { summary: true, table: true },
    },
    sdkCompatibility: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    scientificReview: {
      reviewedAt: '2026-07-17',
      subject: {
        pack: { id: 'example', version: '1.0.0' },
        policies: [{ id: 'example.policy', version: '1.0.0' }],
      },
      reviewArtifact: {
        id: 'example.review.1',
        baseRevision: { kind: 'git-commit', reference: 'a'.repeat(40) },
      },
      audits: [
        {
          id: 'example.audit.scientific',
          kind: 'scientific',
          actor: {
            id: 'codex.scientific-review',
            displayName: 'Automated scientific review',
            type: 'automated',
            humanCredentialClaim: false,
          },
          decision: 'accepted',
          evidenceIds: [derivationEvidenceId, toleranceEvidenceId, controlsEvidenceId],
          exactChecks: [
            {
              id: 'example.check.scientific-controls',
              command: 'pnpm --filter @simproof/domain-pack-sdk test',
              outcome: 'passed',
            },
          ],
        },
        {
          id: 'example.audit.pedagogical',
          kind: 'pedagogical',
          actor: {
            id: 'codex.pedagogical-review',
            displayName: 'Automated pedagogical review',
            type: 'automated',
            humanCredentialClaim: false,
          },
          decision: 'accepted',
          evidenceIds: ['example-pedagogy'],
          exactChecks: [
            {
              id: 'example.check.pedagogical-scope',
              command: 'pnpm --filter @simproof/domain-pack-sdk test',
              outcome: 'passed',
            },
          ],
        },
        {
          id: 'example.audit.accessibility',
          kind: 'accessibility',
          actor: {
            id: 'codex.accessibility-review',
            displayName: 'Automated accessibility review',
            type: 'automated',
            humanCredentialClaim: false,
          },
          decision: 'accepted',
          evidenceIds: ['example-pedagogy'],
          exactChecks: [
            {
              id: 'example.check.accessible-equivalence',
              command: 'pnpm --filter @simproof/domain-pack-sdk test',
              outcome: 'passed',
            },
          ],
        },
        {
          id: 'example.audit.maintainer',
          kind: 'maintainer',
          actor: {
            id: 'example.maintainer',
            displayName: 'Example pack maintainer',
            type: 'human',
            humanCredentialClaim: false,
          },
          decision: 'accepted',
          evidenceIds: [controlsEvidenceId],
          exactChecks: [
            {
              id: 'example.check.maintainer-review',
              command: 'pnpm --filter @simproof/domain-pack-sdk typecheck',
              outcome: 'passed',
            },
          ],
        },
      ],
      applicabilityDerivation: 'The cited definition is finite exactly for the supported range.',
      numericalMethodJustification: 'The exact reference requires no numerical integration.',
      changeControl: {
        compatibility: 'initial',
        classifications: ['scientific', 'pedagogical', 'accessibility', 'governance'],
        staleReasons: [],
      },
      maintainers: [
        {
          id: 'example.maintainer',
          name: 'Pack Maintainer',
          contact: 'maintainer@example.test',
          actorType: 'human',
          humanCredentialClaim: false,
        },
      ],
    },
    contentInventory: ['manifest.ts', 'policy.ts', 'reference.ts', 'verifier.ts'],
  })
