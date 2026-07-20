import { describe, expect, it } from 'vitest'

import {
  CURRENT_DOMAIN_PACK_SDK_VERSION,
  domainPackManifestSchema,
  isSdkVersionCompatible,
} from './index.js'
import { completeManifest } from './test-fixtures.js'

describe('domain-pack manifest boundary', () => {
  it('accepts complete reviewed scientific metadata', () => {
    expect(domainPackManifestSchema.parse(completeManifest())).toEqual(completeManifest())
  })

  it.each([
    ['citation', { citations: [] }],
    ['learning scope', { learningScope: [] }],
    ['applicability bound', { applicability: { ...completeManifest().applicability, bounds: [] } }],
    ['positive control', { controls: { ...completeManifest().controls, positive: [] } }],
    ['negative control', { controls: { ...completeManifest().controls, negative: [] } }],
    ['property control', { controls: { ...completeManifest().controls, property: [] } }],
    ['boundary control', { controls: { ...completeManifest().controls, boundary: [] } }],
    [
      'reviewer',
      {
        scientificReview: {
          ...completeManifest().scientificReview,
          audits: completeManifest().scientificReview.audits.filter(
            ({ kind }) => kind !== 'scientific',
          ),
        },
      },
    ],
    [
      'maintainer',
      { scientificReview: { ...completeManifest().scientificReview, maintainers: [] } },
    ],
  ])('rejects a manifest missing required %s evidence', (_name, replacement) => {
    expect(
      domainPackManifestSchema.safeParse({ ...completeManifest(), ...replacement }).success,
    ).toBe(false)
  })

  it('requires explicit structured singularity coverage while allowing a reviewed empty set', () => {
    const base = completeManifest()
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        applicability: { ...base.applicability, singularities: [] },
      }).success,
    ).toBe(true)
    const { singularities: _singularities, ...withoutSingularities } = base.applicability
    expect(
      domainPackManifestSchema.safeParse({ ...base, applicability: withoutSingularities }).success,
    ).toBe(false)
  })

  it('requires every governing claim kind, unique claim IDs, and declared evidence', () => {
    const base = completeManifest()
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        claims: base.claims.map((claim) =>
          claim.kind === 'assumption' ? { ...claim, kind: 'equation' as const } : claim,
        ),
      }).success,
    ).toBe(false)
    expect(
      domainPackManifestSchema.safeParse({ ...base, claims: [...base.claims, base.claims[0]] })
        .success,
    ).toBe(false)
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        claims: base.claims.map((claim, index) =>
          index === 0 ? { ...claim, evidenceIds: ['undeclared-evidence'] } : claim,
        ),
      }).success,
    ).toBe(false)
  })

  it('rejects ambiguous, duplicate, or dimension-conflicting units', () => {
    const base = completeManifest()
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        units: [...base.units, { quantity: 'distance', symbol: 's', dimension: 'length' }],
      }).success,
    ).toBe(false)
    expect(
      domainPackManifestSchema.safeParse({ ...base, units: [...base.units, base.units[0]] })
        .success,
    ).toBe(false)
  })

  it('rejects malformed compatibility intervals and checks the installed SDK exactly', () => {
    expect(CURRENT_DOMAIN_PACK_SDK_VERSION).toBe('1.0.0')
    expect(isSdkVersionCompatible({ minimum: '1.0.0', maximumExclusive: '2.0.0' })).toBe(true)
    expect(isSdkVersionCompatible({ minimum: '1.1.0', maximumExclusive: '2.0.0' })).toBe(false)
    expect(isSdkVersionCompatible({ minimum: '1.0.0', maximumExclusive: '2.0.0' }, '1.0')).toBe(
      false,
    )
    expect(
      domainPackManifestSchema.safeParse({
        ...completeManifest(),
        sdkCompatibility: { minimum: '2.0.0', maximumExclusive: '1.0.0' },
      }).success,
    ).toBe(false)
  })

  it('rejects duplicate stable IDs and undeclared inventory paths', () => {
    const base = completeManifest()
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        findings: [...base.findings, base.findings[0]],
      }).success,
    ).toBe(false)
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        contentInventory: [...base.contentInventory, '../outside.ts'],
      }).success,
    ).toBe(false)
  })

  it('rejects a control ID reused across control classes', () => {
    const base = completeManifest()
    const boundary = base.controls.boundary[0]
    expect(boundary).toBeDefined()
    if (boundary === undefined) return
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        controls: {
          ...base.controls,
          boundary: [{ ...boundary, id: base.controls.property[0]?.id ?? boundary.id }],
        },
      }).success,
    ).toBe(false)
  })

  it.each([
    '../outside.json',
    '/absolute.json',
    'fixtures/../outside.json',
    'fixtures\\outside.json',
  ])('rejects non-canonical fixture path %s', (path) => {
    const base = completeManifest()
    const positive = base.controls.positive[0]
    expect(positive).toBeDefined()
    if (positive === undefined) return

    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        controls: {
          ...base.controls,
          positive: [{ ...positive, path }],
        },
      }).success,
    ).toBe(false)
  })

  it.each([
    [
      'review',
      (base: ReturnType<typeof completeManifest>) => ({ ...base.scientificReview, extra: true }),
    ],
    [
      'subject',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base.scientificReview,
        subject: { ...base.scientificReview.subject, extra: true },
      }),
    ],
    [
      'audit actor',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base.scientificReview,
        audits: base.scientificReview.audits.map((audit, index) =>
          index === 0 ? { ...audit, actor: { ...audit.actor, extra: true } } : audit,
        ),
      }),
    ],
    [
      'change control',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base.scientificReview,
        changeControl: { ...base.scientificReview.changeControl, extra: true },
      }),
    ],
  ])('rejects unknown nested scientific-review field in %s', (_label, replacement) => {
    const base = completeManifest()
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        scientificReview: replacement(base),
      }).success,
    ).toBe(false)
  })

  it('rejects oversized scientific-review collections and text at max plus one', () => {
    const base = completeManifest()
    const audit = base.scientificReview.audits[0]
    const maintainer = base.scientificReview.maintainers[0]
    expect(audit).toBeDefined()
    expect(maintainer).toBeDefined()
    if (audit === undefined || maintainer === undefined) return

    const candidates = [
      {
        ...base.scientificReview,
        audits: Array.from({ length: 31 }, (_, index) => ({
          ...audit,
          id: `example.audit.${index}`,
        })),
      },
      {
        ...base.scientificReview,
        audits: [
          {
            ...audit,
            exactChecks: Array.from({ length: 101 }, (_, index) => ({
              ...audit.exactChecks[0],
              id: `example.check.${index}`,
            })),
          },
          ...base.scientificReview.audits.slice(1),
        ],
      },
      {
        ...base.scientificReview,
        audits: [
          {
            ...audit,
            evidenceIds: Array.from({ length: 101 }, (_, index) => `example.evidence.${index}`),
          },
          ...base.scientificReview.audits.slice(1),
        ],
      },
      {
        ...base.scientificReview,
        audits: [
          {
            ...audit,
            exactChecks: [{ ...audit.exactChecks[0], command: 'a'.repeat(501) }],
          },
          ...base.scientificReview.audits.slice(1),
        ],
      },
      {
        ...base.scientificReview,
        audits: [
          {
            ...audit,
            actor: { ...audit.actor, displayName: 'a'.repeat(161) },
          },
          ...base.scientificReview.audits.slice(1),
        ],
      },
      {
        ...base.scientificReview,
        maintainers: Array.from({ length: 31 }, (_, index) => ({
          ...maintainer,
          id: `example.maintainer.${index}`,
        })),
      },
      {
        ...base.scientificReview,
        maintainers: [{ ...maintainer, contact: 'a'.repeat(321) }],
      },
      {
        ...base.scientificReview,
        subject: {
          ...base.scientificReview.subject,
          policies: Array.from({ length: 51 }, (_, index) => ({
            id: `example.policy.${index}`,
            version: '1.0.0',
          })),
        },
      },
      {
        ...base.scientificReview,
        changeControl: {
          ...base.scientificReview.changeControl,
          staleReasons: Array.from({ length: 8 }, () => 'domain-pack-changed' as const),
        },
      },
    ]

    for (const scientificReview of candidates) {
      expect(domainPackManifestSchema.safeParse({ ...base, scientificReview }).success).toBe(false)
    }
  })

  it('requires explicit honest actors, immutable review references, and exact subject bindings', () => {
    const base = completeManifest()
    const audit = base.scientificReview.audits[0]
    expect(audit).toBeDefined()
    if (audit === undefined) return
    const { humanCredentialClaim: _claim, ...actorWithoutClaim } = audit.actor
    const replaceAudit = (replacement: unknown) => ({
      ...base.scientificReview,
      audits: [replacement, ...base.scientificReview.audits.slice(1)],
    })
    const candidates = [
      replaceAudit({ ...audit, actor: actorWithoutClaim }),
      replaceAudit({ ...audit, actor: { ...audit.actor, humanCredentialClaim: true } }),
      {
        ...base.scientificReview,
        reviewArtifact: {
          ...base.scientificReview.reviewArtifact,
          baseRevision: { kind: 'git-commit', reference: 'a'.repeat(39) },
        },
      },
      {
        ...base.scientificReview,
        subject: {
          ...base.scientificReview.subject,
          pack: { ...base.scientificReview.subject.pack, id: 'other' },
        },
      },
      {
        ...base.scientificReview,
        subject: { ...base.scientificReview.subject, policies: [] },
      },
      {
        ...base.scientificReview,
        changeControl: {
          ...base.scientificReview.changeControl,
          compatibility: 'backward-compatible',
        },
      },
      {
        ...base.scientificReview,
        changeControl: {
          ...base.scientificReview.changeControl,
          classifications: ['scientific', 'scientific'],
        },
      },
    ]

    for (const scientificReview of candidates) {
      expect(domainPackManifestSchema.safeParse({ ...base, scientificReview }).success).toBe(false)
    }
  })

  it('rejects unknown fields in review artifacts, exact checks, and maintainers', () => {
    const base = completeManifest()
    const audit = base.scientificReview.audits[0]
    const maintainer = base.scientificReview.maintainers[0]
    expect(audit).toBeDefined()
    expect(maintainer).toBeDefined()
    if (audit === undefined || maintainer === undefined) return

    const candidates = [
      {
        ...base.scientificReview,
        reviewArtifact: { ...base.scientificReview.reviewArtifact, extra: true },
      },
      {
        ...base.scientificReview,
        audits: [
          {
            ...audit,
            exactChecks: [{ ...audit.exactChecks[0], extra: true }],
          },
          ...base.scientificReview.audits.slice(1),
        ],
      },
      {
        ...base.scientificReview,
        maintainers: [{ ...maintainer, extra: true }],
      },
    ]

    for (const scientificReview of candidates) {
      expect(domainPackManifestSchema.safeParse({ ...base, scientificReview }).success).toBe(false)
    }
  })
})
