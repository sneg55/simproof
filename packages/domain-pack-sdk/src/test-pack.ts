import { z } from 'zod'

import type { DomainPack, DomainPolicy } from './domain-pack.js'
import { completeManifest } from './test-fixtures.js'

const conceptSchema = z.object({ domain: z.literal('example') }).strict()
const rendererSchema = z
  .object({
    renderer: z.literal('example-line'),
    rows: z.array(z.object({ output: z.number().finite() }).strict()).min(1),
    assumptions: z.array(z.string()).min(1),
    limitations: z.array(z.string()).min(1),
  })
  .strict()

export const examplePack = (): DomainPack<
  DomainPolicy,
  { readonly domain: 'example' },
  { readonly value: number },
  { readonly output: number },
  { readonly output: number }
> => ({
  manifest: completeManifest(),
  id: 'example',
  version: '1.0.0',
  contentHash: `sha256:${'1'.repeat(64)}`,
  reviewBinding: {
    schemaVersion: '1',
    reviewArtifactId: 'example.review.1',
    pack: { id: 'example', version: '1.0.0', contentHash: `sha256:${'1'.repeat(64)}` },
    policies: [{ id: 'example.policy', version: '1.0.0' }],
    baseRevision: { kind: 'git-commit', reference: 'a'.repeat(40) },
    auditIds: [
      'example.audit.scientific',
      'example.audit.pedagogical',
      'example.audit.accessibility',
      'example.audit.maintainer',
    ],
  },
  policy: {
    domain: 'example',
    id: 'example.policy',
    version: '1.0.0',
    checks: ['example.output'],
    sampling: { cases: [{ value: 1 }] },
    assumptions: ['Exact example.'],
    limitations: ['Test only.'],
  },
  conceptSchema,
  validateConcept: (input) => ({ ok: conceptSchema.safeParse(input).success }),
  reference: ({ value }) => ({ output: value * 2 }),
  verify: (candidate) =>
    candidate === 'wrong'
      ? {
          ok: true,
          result: {
            verdict: 'rejected',
            findings: [
              {
                id: 'example.output.mismatch',
                category: 'mismatch',
                severity: 'error',
                checkId: 'example.output',
                quantity: 'output',
                inputs: { distance: { value: 1, unit: 'm' } },
                expected: { value: 2, unit: 'm' },
                actual: { value: 1, unit: 'm' },
                tolerance: { mode: 'absolute', absolute: 0, unit: 'm' },
                error: { mode: 'absolute', value: 1, unit: 'm' },
                explanation: 'Output differs from the reference.',
              },
            ],
            sampleCount: 1,
          },
        }
      : { ok: true, result: { verdict: 'verified', findings: [], sampleCount: 1 } },
  materializeFixture: (_id, source) => source,
  report: {
    validateObservations: (observations) => observations,
    verifyObservations: (observations) => ({
      verdict: 'verified',
      findings: [],
      sampleCount: observations.length,
    }),
    expectedInputs: () => [{ value: 1 }],
    observationInput: (observation) => observation,
    testedParameters: () => [],
    sampleCountForCheck: (_checkId, result) => result.sampleCount,
  },
  accessible: {
    rendererId: 'example-line',
    verifiedOutputSchema: z.object({ output: z.number().finite() }).strict(),
    sceneSchema: rendererSchema,
    fromVerifiedOutput: () => ({
      scene: {
        renderer: 'example-line',
        rows: [{ output: 2 }],
        assumptions: ['Exact example.'],
        limitations: ['Test only.'],
      },
      assumptions: ['Exact example.'],
      limitations: ['Test only.'],
      summary: 'The exact output is 2 metres.',
      table: {
        caption: 'Example output',
        columns: [{ key: 'output', label: 'Output', quantity: 'distance', unit: 'm' }],
        rows: [{ output: 2 }],
      },
    }),
  },
  conformance: {
    referenceInputs: [{ value: 1 }],
    supportedInputs: [{ value: 1 }],
    unsupportedInputs: [{ value: 0 }],
    accessibleInputs: [{ output: 2 }],
    isApplicable: ({ value }) => value > 0,
    runPropertyControl: ({ id, runCount, seed }) =>
      id === 'example-scale' && seed === 1 && runCount === 100,
    runBoundaryControl: ({ cases, id, threshold }) =>
      [
        'example-zero',
        'example-ten',
        'example-singularity-zero',
        'example-output-threshold',
      ].includes(id) && cases.equal === threshold.value,
  },
})
