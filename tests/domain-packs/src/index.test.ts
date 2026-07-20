import { DOMAIN_PACK_CONFORMANCE_IDS } from '@simproof/domain-pack-sdk'
import { PENDULUM_DOMAIN_PACK, PROJECTILE_DOMAIN_PACK } from '@simproof/verifier'
import { describe, expect, it } from 'vitest'
import { normalizeFingerprintBytes } from './fingerprint.js'
import { incompleteFixtureMissingGates } from './incomplete-fixture.js'
import { createRepositoryConformanceHarness, evaluateBuiltInDomainPack } from './index.js'

const allGateIds = Object.values(DOMAIN_PACK_CONFORMANCE_IDS)

describe('repository domain-pack conformance harness', () => {
  it('passes every stable gate for both registered packs', () => {
    expect(evaluateBuiltInDomainPack(PENDULUM_DOMAIN_PACK)).toEqual({
      ok: true,
      failures: [],
      passed: allGateIds,
    })
    expect(evaluateBuiltInDomainPack(PROJECTILE_DOMAIN_PACK)).toEqual({
      ok: true,
      failures: [],
      passed: allGateIds,
    })
  })

  it('uses the canonical inventory and rejects traversal, omissions, and additions', () => {
    const harness = createRepositoryConformanceHarness('pendulum')
    const inventory = PENDULUM_DOMAIN_PACK.manifest.contentInventory

    expect(harness.inspectInventory(inventory)).toEqual({
      canonical: true,
      complete: true,
      inRoot: true,
      regularFiles: true,
      attacksRejected: true,
    })
    expect(harness.computeContentHash(inventory)).toBe(PENDULUM_DOMAIN_PACK.contentHash)
    expect(harness.inspectInventory(inventory.slice(1)).complete).toBe(false)
    expect(harness.inspectInventory(['../outside.ts']).canonical).toBe(false)
    expect(() => harness.computeContentHash([...inventory, 'extra.ts'])).toThrow(
      'Cannot hash an invalid pendulum inventory.',
    )
  })

  it('preserves exact fixture bytes while normalizing reviewed text sources', () => {
    const bytes = Buffer.from('{\r\n  "value": 1\r\n}\r\n', 'utf8')

    expect(normalizeFingerprintBytes('tests/fixtures/correct/control.json', bytes)).toBe(bytes)
    expect(
      normalizeFingerprintBytes('packages/verifier/src/reference.ts', bytes).toString('utf8'),
    ).toBe('{\n  "value": 1\n}\n')
  })

  it('derives all seven stale reasons from authoritative persistence comparison', () => {
    const evidence = createRepositoryConformanceHarness('projectile').staleEvidence()
    const reasons = [
      'concept-changed',
      'artifact-changed',
      'observations-changed',
      'policy-changed',
      'domain-pack-changed',
      'runner-changed',
      'dependencies-changed',
    ]

    expect(evidence.individual).toEqual(reasons.map((reason) => [reason]))
    expect(evidence.combined).toEqual(reasons)
    expect(evidence).toMatchObject({
      blocksBadge: true,
      blocksPreview: true,
      blocksPublish: true,
    })
  })

  it('checks actual renderer contracts and implemented feature evidence', () => {
    const projectile = createRepositoryConformanceHarness('projectile')
    const pendulum = createRepositoryConformanceHarness('pendulum')

    expect(projectile.rendererRegistered('projectile-trajectory')).toBe(true)
    expect(
      projectile.rendererFeaturesValid('projectile-trajectory', [
        'trail',
        'apex-marker',
        'impact-marker',
      ]),
    ).toBe(true)
    expect(projectile.rendererFeaturesValid('projectile-trajectory', ['velocity-vector'])).toBe(
      false,
    )
    expect(
      pendulum.rendererFeaturesValid('pendulum-bob', ['equilibrium-line', 'turning-points']),
    ).toBe(true)
    expect(pendulum.rendererFeaturesValid('pendulum-bob', ['period-markers'])).toBe(false)
  })

  it('rejects unsupported and unregistered pack identities', () => {
    expect(() => createRepositoryConformanceHarness('circuits')).toThrow(
      'Unsupported built-in domain pack: circuits',
    )
    expect(() => evaluateBuiltInDomainPack({ ...PENDULUM_DOMAIN_PACK })).toThrow(
      'Domain pack pendulum is not the registered instance.',
    )
  })

  it('independently perturbs the incomplete fixture through every stable diagnostic', () => {
    const pendulum = createRepositoryConformanceHarness('pendulum')
    const projectile = createRepositoryConformanceHarness('projectile')
    expect(incompleteFixtureMissingGates(PENDULUM_DOMAIN_PACK, pendulum)).toEqual([])
    expect(incompleteFixtureMissingGates(PROJECTILE_DOMAIN_PACK, projectile)).toEqual([])
    expect(pendulum.incompleteFixtureCoverage()).toBe(true)
    expect(projectile.incompleteFixtureCoverage()).toBe(true)
  })
})
