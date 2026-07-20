import { describe, expect, it } from 'vitest'

import { createDomainPackRegistry, defineDomainPack } from './index.js'
import { examplePack } from './test-pack.js'

const exampleManifestForId = (id: string) => {
  const manifest = examplePack().manifest
  return {
    ...manifest,
    id,
    scientificReview: {
      ...manifest.scientificReview,
      subject: { ...manifest.scientificReview.subject, pack: { id, version: manifest.version } },
      reviewArtifact: { ...manifest.scientificReview.reviewArtifact, id: `${id}.review.1` },
      audits: manifest.scientificReview.audits.map((audit) => ({
        ...audit,
        id: audit.id.replace('example.', `${id}.`),
        actor:
          audit.kind === 'maintainer' ? { ...audit.actor, id: `${id}.maintainer` } : audit.actor,
        exactChecks: audit.exactChecks.map((check) => ({
          ...check,
          id: check.id.replace('example.', `${id}.`),
        })),
      })),
      maintainers: manifest.scientificReview.maintainers.map((maintainer) => ({
        ...maintainer,
        id: `${id}.maintainer`,
      })),
    },
  }
}

describe('compile-time domain-pack registration', () => {
  it('registers an explicit reviewed pack and returns it by stable domain ID', () => {
    const pack = defineDomainPack(examplePack())
    const registry = createDomainPackRegistry([pack] as const)
    expect(registry.ids).toEqual(['example'])
    expect(registry.get('example')).toBe(pack)
    expect(registry.get('missing')).toBeUndefined()
  })

  it('rejects duplicate IDs before constructing the registry', () => {
    const pack = defineDomainPack(examplePack())
    expect(() => createDomainPackRegistry([pack, pack])).toThrow(/duplicate/iu)
  })

  it('rejects duplicate active policy IDs across packs', () => {
    const first = defineDomainPack(examplePack())
    const otherManifest = exampleManifestForId('other')
    const second = defineDomainPack({
      ...examplePack(),
      id: 'other',
      manifest: otherManifest,
      policy: { ...examplePack().policy, domain: 'other' },
      reviewBinding: {
        ...examplePack().reviewBinding,
        reviewArtifactId: otherManifest.scientificReview.reviewArtifact.id,
        pack: { ...examplePack().reviewBinding.pack, id: 'other' },
        auditIds: otherManifest.scientificReview.audits.map(({ id }) => id),
      },
    })
    expect(() => createDomainPackRegistry([first, second])).toThrow(/policy/iu)
  })

  it('returns a deeply immutable pack bound to the parsed manifest', () => {
    const raw = examplePack()
    const defined = defineDomainPack({
      ...raw,
      manifest: { ...raw.manifest, title: `  ${raw.manifest.title}  ` },
    })
    expect(defined.manifest.title).toBe(raw.manifest.title)
    expect(Object.isFrozen(defined)).toBe(true)
    expect(Object.isFrozen(defined.manifest.scientificReview.audits[0])).toBe(true)
    expect(Object.isFrozen(defined.policy)).toBe(true)
    expect(Object.isFrozen(defined.policy.sampling)).toBe(true)
    expect(Object.isFrozen(defined.reviewBinding)).toBe(true)
    expect(Object.isFrozen(defined.reviewBinding.pack)).toBe(true)
    expect(Object.isFrozen(defined.report)).toBe(true)
    expect(Object.isFrozen(defined.report.verifyObservations)).toBe(true)
    expect(Object.isFrozen(defined.accessible)).toBe(true)
    expect(Object.isFrozen(defined.accessible.verifiedOutputSchema)).toBe(true)
    expect(Object.isFrozen(defined.accessible.sceneSchema)).toBe(true)
    expect(Object.isFrozen(defined.accessible.fromVerifiedOutput)).toBe(true)
    expect(Object.isFrozen(defined.conformance)).toBe(true)
    expect(Object.isFrozen(defined.conformance.referenceInputs)).toBe(true)
    expect(Object.isFrozen(defined.conformance.referenceInputs[0])).toBe(true)
    expect(Object.isFrozen(defined.conformance.isApplicable)).toBe(true)
    expect(defined.conceptSchema.safeParse({ domain: 'example' }).success).toBe(true)
    expect(defined.accessible.verifiedOutputSchema.safeParse({ output: 2 }).success).toBe(true)
    expect(
      defined.accessible.sceneSchema.safeParse(
        defined.accessible.fromVerifiedOutput({ output: 2 }).scene,
      ).success,
    ).toBe(true)
  })

  it('rejects mutation attempts across every trust-sensitive pack component', () => {
    const defined = defineDomainPack(examplePack())
    const mutableReport = defined.report as { expectedInputs: () => readonly unknown[] }
    const mutableAccessible = defined.accessible as { rendererId: string }
    const mutableVerifiedOutputSchema = defined.accessible.verifiedOutputSchema as {
      safeParse: () => { success: true; data: { output: number } }
    }
    const mutableReferenceInput = defined.conformance.referenceInputs[0] as { value: number }
    const mutableReferenceInputs = defined.conformance.referenceInputs as { value: number }[]
    const mutableReviewPack = defined.reviewBinding.pack as { contentHash: string }

    expect(() => {
      mutableReport.expectedInputs = () => []
    }).toThrow(TypeError)
    expect(() => {
      Object.defineProperty(defined.report.verifyObservations, 'compromised', { value: true })
    }).toThrow(TypeError)
    expect(() => {
      mutableAccessible.rendererId = 'unreviewed-renderer'
    }).toThrow(TypeError)
    expect(() => {
      mutableVerifiedOutputSchema.safeParse = () => ({ success: true, data: { output: 0 } })
    }).toThrow(TypeError)
    expect(() => {
      mutableReferenceInput.value = 99
    }).toThrow(TypeError)
    expect(() => {
      mutableReferenceInputs.push({ value: 99 })
    }).toThrow(TypeError)
    expect(() => {
      mutableReviewPack.contentHash = `sha256:${'2'.repeat(64)}`
    }).toThrow(TypeError)
  })

  it('freezes valid packs even when callers bypass defineDomainPack', () => {
    const raw = Object.freeze(examplePack())
    const registry = createDomainPackRegistry([raw] as const)
    const registered = registry.get('example')
    const mutableValues = registry.values as unknown[]
    const mutableSupportedInput = raw.conformance.supportedInputs[0] as { value: number }

    expect(registered).toBe(raw)
    expect(Object.isFrozen(registered)).toBe(true)
    expect(Object.isFrozen(registered?.policy.sampling)).toBe(true)
    expect(Object.isFrozen(registered?.conceptSchema)).toBe(true)
    expect(Object.isFrozen(registered?.report)).toBe(true)
    expect(Object.isFrozen(registered?.accessible)).toBe(true)
    expect(Object.isFrozen(registered?.accessible.verifiedOutputSchema)).toBe(true)
    expect(Object.isFrozen(registered?.accessible.sceneSchema)).toBe(true)
    expect(Object.isFrozen(registered?.conformance)).toBe(true)
    expect(Object.isFrozen(registry)).toBe(true)
    expect(Object.isFrozen(registry.ids)).toBe(true)
    expect(Object.isFrozen(registry.values)).toBe(true)
    expect(Object.isFrozen(registry.get)).toBe(true)
    expect(() => {
      mutableValues.push(examplePack())
    }).toThrow(TypeError)
    expect(() => {
      mutableSupportedInput.value = 99
    }).toThrow(TypeError)
  })

  it.each([
    ['manifest and policy domain', { manifest: { ...examplePack().manifest, id: 'other' } }],
    ['pack and manifest version', { version: '1.1.0' }],
    ['manifest policy declaration', { policy: { ...examplePack().policy, id: 'other.policy' } }],
    [
      'exact review fingerprint binding',
      {
        reviewBinding: {
          ...examplePack().reviewBinding,
          pack: {
            ...examplePack().reviewBinding.pack,
            contentHash: `sha256:${'2'.repeat(64)}`,
          },
        },
      },
    ],
    [
      'SDK compatibility',
      {
        manifest: {
          ...examplePack().manifest,
          sdkCompatibility: { minimum: '2.0.0', maximumExclusive: '3.0.0' },
        },
      },
    ],
  ])('rejects %s mismatch', (_name, replacement) => {
    expect(() => defineDomainPack({ ...examplePack(), ...replacement })).toThrow()
  })

  it('rejects duplicate check and finding IDs', () => {
    expect(() =>
      defineDomainPack({
        ...examplePack(),
        policy: { ...examplePack().policy, checks: ['example.output', 'example.output'] },
      }),
    ).toThrow(/check/iu)
    expect(() =>
      defineDomainPack({
        ...examplePack(),
        manifest: {
          ...examplePack().manifest,
          findings: [
            ...examplePack().manifest.findings,
            examplePack().manifest.findings[0] ?? examplePack().manifest.findings.at(-1)!,
          ],
        },
      }),
    ).toThrow()
  })

  it('validates every pack at the registry boundary even when defineDomainPack is bypassed', () => {
    const raw = examplePack()
    expect(() =>
      createDomainPackRegistry([
        {
          ...raw,
          manifest: { ...raw.manifest, citations: [] },
        },
      ]),
    ).toThrow()
    expect(() =>
      createDomainPackRegistry([
        {
          ...raw,
          policy: { ...raw.policy, id: 'example.undeclared-policy' },
        },
      ]),
    ).toThrow(/policy/iu)
  })
})
