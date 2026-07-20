import { describe, expect, it } from 'vitest'

import {
  counterReferenceReplacement,
  conformanceHarness as harness,
  staleReasons,
} from './conformance-test-harness.js'
import {
  DOMAIN_PACK_CONFORMANCE_IDS,
  defineDomainPack,
  evaluateDomainPackConformance,
} from './index.js'
import { examplePack } from './test-pack.js'

describe('reusable domain-pack conformance kit', () => {
  it('passes every stable gate for a complete deterministic pack', () => {
    const result = evaluateDomainPackConformance(defineDomainPack(examplePack()), harness())
    expect(result).toEqual({
      ok: true,
      failures: [],
      passed: Object.values(DOMAIN_PACK_CONFORMANCE_IDS),
    })
  })

  it.each([
    [
      DOMAIN_PACK_CONFORMANCE_IDS.manifest,
      { manifest: { ...examplePack().manifest, citations: [] } },
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.compatibility,
      {
        manifest: {
          ...examplePack().manifest,
          sdkCompatibility: { minimum: '2.0.0', maximumExclusive: '3.0.0' },
        },
      },
    ],
    [DOMAIN_PACK_CONFORMANCE_IDS.fingerprint, { policy: { ...examplePack().policy } }],
    [DOMAIN_PACK_CONFORMANCE_IDS.fingerprint, counterReferenceReplacement()],
    [DOMAIN_PACK_CONFORMANCE_IDS.fingerprint, { reference: () => ({ output: Number.NaN }) }],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.applicabilitySemantics,
      { conformance: { ...examplePack().conformance, isApplicable: () => true } },
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.propertyControls,
      { conformance: { ...examplePack().conformance, runPropertyControl: () => false } },
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.toleranceBoundaries,
      { conformance: { ...examplePack().conformance, runBoundaryControl: () => false } },
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent,
      {
        accessible: {
          ...examplePack().accessible,
          fromVerifiedOutput: () => ({
            ...examplePack().accessible.fromVerifiedOutput({ output: 2 }),
            scene: {
              renderer: 'example-line',
              rows: [{ output: 3 }],
              assumptions: ['Exact example.'],
              limitations: ['Test only.'],
            },
          }),
        },
      },
    ],
  ])('reports the exact stable gate for an incomplete pack: %s', (gate, replacement) => {
    const result = evaluateDomainPackConformance({ ...examplePack(), ...replacement }, harness())
    expect(result.ok).toBe(false)
    expect(result.failures).toContain(gate)
  })

  it('preserves exact ordered finding multiplicity, sample count, and boundary errors', () => {
    const broken = harness()
    const result = evaluateDomainPackConformance(examplePack(), {
      ...broken,
      readFixture: (path) => (path.endsWith('wrong.json') ? 'correct' : 'wrong'),
    })
    expect(result.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.fixtureParity)
  })

  it('rejects executable values returned by an accessible adapter', () => {
    const base = examplePack()
    const result = evaluateDomainPackConformance(
      {
        ...base,
        accessible: {
          ...base.accessible,
          sceneSchema: { safeParse: () => ({ success: true as const, data: {} as never }) },
          fromVerifiedOutput: () => ({
            ...base.accessible.fromVerifiedOutput({ output: 2 }),
            scene: {
              ...base.accessible.fromVerifiedOutput({ output: 2 }).scene,
              onClick: () => undefined,
            } as never,
          }),
        },
      },
      harness(),
    )

    expect(result.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.adapterSchema)
    expect(result.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent)
  })

  it('fails PACK-008 when a governing claim uses declared but uncited evidence', () => {
    const base = examplePack()
    const result = evaluateDomainPackConformance(
      {
        ...base,
        manifest: {
          ...base.manifest,
          claims: base.manifest.claims.map((claim, index) =>
            index === 0 ? { ...claim, evidenceIds: ['example-controls'] } : claim,
          ),
        },
      },
      harness(),
    )
    expect(result.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.evidenceLinks)
  })

  it('requires canonical complete regular in-root inventory and the exact seven-reason stale matrix', () => {
    const inventory = evaluateDomainPackConformance(examplePack(), {
      ...harness(),
      inspectInventory: () => ({
        canonical: false,
        complete: false,
        inRoot: false,
        regularFiles: false,
        attacksRejected: false,
      }),
    })
    expect(inventory.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.inventoryCanonical)
    expect(inventory.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.inventoryAttacks)

    const stale = evaluateDomainPackConformance(examplePack(), {
      ...harness(),
      staleEvidence: () => ({
        individual: staleReasons.slice(0, -1).map((reason) => [reason]),
        combined: staleReasons.slice(0, -1),
        blocksBadge: false,
        blocksPreview: false,
        blocksPublish: false,
      }),
    })
    expect(stale.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.staleEvidence)
  })

  it('is total for an incomplete pack and reaches every stable PACK-001 through PACK-024 gate', () => {
    const result = evaluateDomainPackConformance(
      { ...examplePack(), manifest: {} as never },
      harness(),
    )
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual(Object.values(DOMAIN_PACK_CONFORMANCE_IDS))
    expect(result.passed).toEqual([])
  })

  it('has a targeted failing perturbation for every canonical gate', () => {
    const base = examplePack()
    const malformed = { ...base, manifest: {} as never }
    const withoutSingularity = {
      ...base,
      manifest: {
        ...base.manifest,
        controls: {
          ...base.manifest.controls,
          boundary: base.manifest.controls.boundary.filter(
            ({ covers }) => covers.kind !== 'singularity',
          ),
        },
      },
    }
    const boundaryFailure = (kind: string) => ({
      ...base.conformance,
      runBoundaryControl: (control: Parameters<typeof base.conformance.runBoundaryControl>[0]) =>
        control.covers.kind !== kind,
    })
    const cases: readonly [string, ReturnType<typeof evaluateDomainPackConformance>][] = [
      [DOMAIN_PACK_CONFORMANCE_IDS.manifest, evaluateDomainPackConformance(malformed, harness())],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.registration,
        evaluateDomainPackConformance(base, { ...harness(), registrationValid: () => false }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.identity,
        evaluateDomainPackConformance({ ...base, version: '1.1.0' }, harness()),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.compatibility,
        evaluateDomainPackConformance(
          {
            ...base,
            manifest: {
              ...base.manifest,
              sdkCompatibility: { minimum: '2.0.0', maximumExclusive: '3.0.0' },
            },
          },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.inventoryCanonical,
        evaluateDomainPackConformance(base, {
          ...harness(),
          inspectInventory: () => ({
            canonical: false,
            complete: true,
            inRoot: true,
            regularFiles: true,
            attacksRejected: true,
          }),
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.inventoryAttacks,
        evaluateDomainPackConformance(base, {
          ...harness(),
          inspectInventory: () => ({
            canonical: true,
            complete: true,
            inRoot: true,
            regularFiles: true,
            attacksRejected: false,
          }),
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.fingerprint,
        evaluateDomainPackConformance(base, {
          ...harness(),
          computeContentHash: () => `sha256:${'2'.repeat(64)}`,
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.evidenceLinks,
        evaluateDomainPackConformance(
          {
            ...base,
            manifest: {
              ...base.manifest,
              citations: base.manifest.citations.map((citation) => ({
                ...citation,
                supportedEvidenceIds: ['example-derivation'],
              })),
            },
          },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.unitIntegrity,
        evaluateDomainPackConformance(base, { ...harness(), unitIntegrity: () => false }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.applicabilitySemantics,
        evaluateDomainPackConformance(
          { ...base, conformance: { ...base.conformance, isApplicable: () => true } },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.singularityCoverage,
        evaluateDomainPackConformance(withoutSingularity, harness()),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.stableIds,
        evaluateDomainPackConformance(
          {
            ...base,
            manifest: {
              ...base.manifest,
              findings: base.manifest.findings.map((finding) => ({
                ...finding,
                checkId: 'example.undeclared-check',
              })),
            },
          },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.fixtureParity,
        evaluateDomainPackConformance(base, {
          ...harness(),
          readFixture: (path) => (path.endsWith('wrong.json') ? 'correct' : 'wrong'),
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.toleranceBoundaries,
        evaluateDomainPackConformance(
          { ...base, conformance: boundaryFailure('tolerance-threshold') },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.applicabilityBoundaries,
        evaluateDomainPackConformance(
          { ...base, conformance: boundaryFailure('applicability-endpoint') },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.propertyControls,
        evaluateDomainPackConformance(
          { ...base, conformance: { ...base.conformance, runPropertyControl: () => false } },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.adapterSchema,
        evaluateDomainPackConformance(base, { ...harness(), rendererRegistered: () => false }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.rendererFeatures,
        evaluateDomainPackConformance(base, {
          ...harness(),
          rendererFeaturesValid: () => false,
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent,
        evaluateDomainPackConformance(
          {
            ...base,
            accessible: {
              ...base.accessible,
              fromVerifiedOutput: () => ({
                ...base.accessible.fromVerifiedOutput({ output: 2 }),
                scene: {
                  renderer: 'example-line',
                  rows: [{ output: 3 }],
                  assumptions: ['Exact example.'],
                  limitations: ['Test only.'],
                },
              }),
            },
          },
          harness(),
        ),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.sdkDomainNeutral,
        evaluateDomainPackConformance(base, { ...harness(), sdkIsDomainNeutral: () => false }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.staticRegistration,
        evaluateDomainPackConformance(base, { ...harness(), registrationIsStatic: () => false }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.staleEvidence,
        evaluateDomainPackConformance(base, {
          ...harness(),
          staleEvidence: () => ({
            individual: [],
            combined: [],
            blocksBadge: false,
            blocksPreview: false,
            blocksPublish: false,
          }),
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.incompleteFixture,
        evaluateDomainPackConformance(base, {
          ...harness(),
          incompleteFixtureCoverage: () => false,
        }),
      ],
      [
        DOMAIN_PACK_CONFORMANCE_IDS.unsupportedDomains,
        evaluateDomainPackConformance(base, {
          ...harness(),
          unsupportedDomainsAbsent: () => false,
        }),
      ],
    ]
    expect(cases.map(([id]) => id)).toEqual(Object.values(DOMAIN_PACK_CONFORMANCE_IDS))
    for (const [id, result] of cases) expect(result.failures).toContain(id)
  })
})
