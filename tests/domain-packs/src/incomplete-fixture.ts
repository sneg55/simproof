import {
  DOMAIN_PACK_CONFORMANCE_IDS,
  type DomainPack,
  type DomainPackConformanceHarness,
  type DomainPackConformanceId,
  evaluateDomainPackConformance,
} from '@simproof/domain-pack-sdk'

type Candidate = DomainPack

const evaluate = (
  pack: Candidate,
  harness: DomainPackConformanceHarness,
  replacement: Partial<Candidate> = {},
  harnessReplacement: Partial<DomainPackConformanceHarness> = {},
) =>
  evaluateDomainPackConformance(
    { ...pack, ...replacement },
    { ...harness, incompleteFixtureCoverage: () => true, ...harnessReplacement },
  )

export const incompleteFixtureMissingGates = (
  source: unknown,
  harness: DomainPackConformanceHarness,
): readonly DomainPackConformanceId[] => {
  const pack = source as Candidate
  const boundaryFailure = (kind: string) => ({
    ...pack.conformance,
    runBoundaryControl: (control: Parameters<typeof pack.conformance.runBoundaryControl>[0]) =>
      control.covers.kind !== kind,
  })
  const uncitedEvidence = {
    id: 'incomplete.uncited-evidence',
    kind: 'verification-control' as const,
    description: 'Intentionally uncited conformance evidence.',
  }
  const firstClaim = pack.manifest.claims[0]
  const scientificFinding = pack.manifest.findings.find(({ lifecycle }) => lifecycle === 'finding')
  const cases: readonly [DomainPackConformanceId, ReturnType<typeof evaluate>][] = [
    [DOMAIN_PACK_CONFORMANCE_IDS.manifest, evaluate(pack, harness, { manifest: {} as never })],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.registration,
      evaluate(pack, harness, {}, { registrationValid: () => false }),
    ],
    [DOMAIN_PACK_CONFORMANCE_IDS.identity, evaluate(pack, harness, { version: '99.0.0' })],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.compatibility,
      evaluate(pack, harness, {
        manifest: {
          ...pack.manifest,
          sdkCompatibility: { minimum: '99.0.0', maximumExclusive: '100.0.0' },
        },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.inventoryCanonical,
      evaluate(
        pack,
        harness,
        {},
        {
          inspectInventory: () => ({
            canonical: false,
            complete: true,
            inRoot: true,
            regularFiles: true,
            attacksRejected: true,
          }),
        },
      ),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.inventoryAttacks,
      evaluate(
        pack,
        harness,
        {},
        {
          inspectInventory: () => ({
            canonical: true,
            complete: true,
            inRoot: true,
            regularFiles: true,
            attacksRejected: false,
          }),
        },
      ),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.fingerprint,
      evaluate(pack, harness, { contentHash: `sha256:${'f'.repeat(64)}` }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.evidenceLinks,
      evaluate(pack, harness, {
        manifest: {
          ...pack.manifest,
          evidence: [...pack.manifest.evidence, uncitedEvidence],
          claims:
            firstClaim === undefined
              ? pack.manifest.claims
              : pack.manifest.claims.map((claim, index) =>
                  index === 0 ? { ...claim, evidenceIds: [uncitedEvidence.id] } : claim,
                ),
        },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.unitIntegrity,
      evaluate(pack, harness, {}, { unitIntegrity: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.applicabilitySemantics,
      evaluate(pack, harness, {
        conformance: { ...pack.conformance, supportedInputs: [], unsupportedInputs: [] },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.singularityCoverage,
      evaluate(pack, harness, {
        manifest: {
          ...pack.manifest,
          applicability: {
            ...pack.manifest.applicability,
            singularities: [
              ...pack.manifest.applicability.singularities,
              {
                id: `${pack.id}.incomplete-singularity`,
                condition: 'An intentionally uncovered singularity.',
                disposition: 'inapplicable',
              },
            ],
          },
        },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.stableIds,
      evaluate(pack, harness, {
        manifest: {
          ...pack.manifest,
          findings: pack.manifest.findings.map((finding) =>
            finding === scientificFinding ? { ...finding, checkId: 'undeclared.check' } : finding,
          ),
        },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.fixtureParity,
      evaluate(pack, harness, {}, { readFixture: () => null }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.toleranceBoundaries,
      evaluate(pack, harness, { conformance: boundaryFailure('tolerance-threshold') }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.applicabilityBoundaries,
      evaluate(pack, harness, { conformance: boundaryFailure('applicability-endpoint') }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.propertyControls,
      evaluate(pack, harness, {
        conformance: { ...pack.conformance, runPropertyControl: () => false },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.adapterSchema,
      evaluate(pack, harness, {}, { rendererRegistered: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.rendererFeatures,
      evaluate(pack, harness, {}, { rendererFeaturesValid: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent,
      evaluate(pack, harness, {
        conformance: { ...pack.conformance, accessibleInputs: [] },
      }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.sdkDomainNeutral,
      evaluate(pack, harness, {}, { sdkIsDomainNeutral: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.staticRegistration,
      evaluate(pack, harness, {}, { registrationIsStatic: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.staleEvidence,
      evaluate(
        pack,
        harness,
        {},
        {
          staleEvidence: () => ({
            individual: [],
            combined: [],
            blocksBadge: false,
            blocksPreview: false,
            blocksPublish: false,
          }),
        },
      ),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.incompleteFixture,
      evaluate(pack, harness, {}, { incompleteFixtureCoverage: () => false }),
    ],
    [
      DOMAIN_PACK_CONFORMANCE_IDS.unsupportedDomains,
      evaluate(pack, harness, {}, { unsupportedDomainsAbsent: () => false }),
    ],
  ]
  const catalog = Object.values(DOMAIN_PACK_CONFORMANCE_IDS)
  if (cases.length !== catalog.length) return catalog
  return cases
    .filter(([gate, result]) => result.ok || !result.failures.includes(gate))
    .map(([gate]) => gate)
}

export const incompleteFixtureCoversEveryGate = (
  source: unknown,
  harness: DomainPackConformanceHarness,
): boolean => incompleteFixtureMissingGates(source, harness).length === 0
