import { describe, expect, it } from 'vitest'

import { conformanceHarness as harness } from './conformance-test-harness.js'
import { DOMAIN_PACK_CONFORMANCE_IDS, evaluateDomainPackConformance } from './index.js'
import { examplePack } from './test-pack.js'

describe('domain-pack conformance boundaries', () => {
  it('rejects empty reference, applicability, and accessible conformance samples', () => {
    const base = examplePack()
    const emptyReferences = evaluateDomainPackConformance(
      { ...base, conformance: { ...base.conformance, referenceInputs: [] } },
      harness(),
    )
    const emptyApplicability = evaluateDomainPackConformance(
      {
        ...base,
        conformance: { ...base.conformance, supportedInputs: [], unsupportedInputs: [] },
      },
      harness(),
    )
    const emptyAccessible = evaluateDomainPackConformance(
      { ...base, conformance: { ...base.conformance, accessibleInputs: [] } },
      harness(),
    )

    expect(emptyReferences.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.fingerprint)
    expect(emptyApplicability.failures).toContain(
      DOMAIN_PACK_CONFORMANCE_IDS.applicabilitySemantics,
    )
    expect(emptyAccessible.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.adapterSchema)
    expect(emptyAccessible.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent)
  })

  it('rejects an undeclared active policy and a malformed content hash', () => {
    const base = examplePack()
    const policy = evaluateDomainPackConformance(
      { ...base, policy: { ...base.policy, id: 'example.undeclared-policy' } },
      harness(),
    )
    const hash = evaluateDomainPackConformance(
      { ...base, contentHash: 'not-a-sha256' },
      { ...harness(), computeContentHash: () => 'not-a-sha256' },
    )

    expect(policy.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.identity)
    expect(hash.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.fingerprint)
  })

  it('rejects incomplete table equivalence and quantity-specific unit mismatches', () => {
    const base = examplePack()
    const incompleteTable = evaluateDomainPackConformance(
      {
        ...base,
        accessible: {
          ...base.accessible,
          fromVerifiedOutput: () => ({
            ...base.accessible.fromVerifiedOutput({ output: 2 }),
            table: {
              ...base.accessible.fromVerifiedOutput({ output: 2 }).table,
              columns: [],
            },
          }),
        },
      },
      harness(),
    )
    const wrongUnit = evaluateDomainPackConformance(
      {
        ...base,
        accessible: {
          ...base.accessible,
          fromVerifiedOutput: () => ({
            ...base.accessible.fromVerifiedOutput({ output: 2 }),
            table: {
              ...base.accessible.fromVerifiedOutput({ output: 2 }).table,
              columns: [{ key: 'output', label: 'Output', quantity: 'distance', unit: 's' }],
            },
          }),
        },
      },
      harness(),
    )

    expect(incompleteTable.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent)
    expect(wrongUnit.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.unitIntegrity)
  })

  it('reports PACK-001 for nested unknown and max-plus-one review metadata', () => {
    const base = examplePack()
    const audit = base.manifest.scientificReview.audits[0]
    expect(audit).toBeDefined()
    if (audit === undefined) return
    const manifests = [
      {
        ...base.manifest,
        scientificReview: { ...base.manifest.scientificReview, extra: true },
      },
      {
        ...base.manifest,
        scientificReview: {
          ...base.manifest.scientificReview,
          audits: [
            { ...audit, actor: { ...audit.actor, displayName: 'a'.repeat(161) } },
            ...base.manifest.scientificReview.audits.slice(1),
          ],
        },
      },
    ]

    for (const manifest of manifests) {
      const result = evaluateDomainPackConformance({ ...base, manifest }, harness())
      expect(result.failures).toContain(DOMAIN_PACK_CONFORMANCE_IDS.manifest)
      expect(result.passed).toEqual([])
    }
  })
})
