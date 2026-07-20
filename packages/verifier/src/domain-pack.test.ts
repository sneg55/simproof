import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { PENDULUM_FINDING_IDS } from './domains/pendulum/index.js'
import { PROJECTILE_FINDING_IDS } from './domains/projectile/index.js'
import { BUILT_IN_DOMAIN_PACK_REGISTRY, getDomainPack } from './supported-domain-packs.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function loadFixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, repositoryRoot), 'utf8')) as unknown
}

describe('supported domain packs', () => {
  it('keeps checked-in scientific fingerprints synchronized with source and fixtures', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/generate-domain-pack-fingerprints.mjs', '--check'], {
        cwd: new URL(repositoryRoot),
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  it('exposes only the two reviewed application-owned domains', () => {
    const mutableRegistryValues = BUILT_IN_DOMAIN_PACK_REGISTRY.values as unknown[]
    const mutableReport = getDomainPack('projectile').report as {
      expectedInputs: () => readonly unknown[]
    }

    expect(BUILT_IN_DOMAIN_PACK_REGISTRY.ids).toEqual(['pendulum', 'projectile'])
    expect(getDomainPack('projectile')).toBe(BUILT_IN_DOMAIN_PACK_REGISTRY.get('projectile'))
    expect(getDomainPack('circuits')).toBeUndefined()
    expect(Object.isFrozen(BUILT_IN_DOMAIN_PACK_REGISTRY)).toBe(true)
    expect(Object.isFrozen(BUILT_IN_DOMAIN_PACK_REGISTRY.values)).toBe(true)
    expect(() => {
      mutableRegistryValues.pop()
    }).toThrow(TypeError)
    expect(() => {
      mutableReport.expectedInputs = () => []
    }).toThrow(TypeError)
  })

  it('binds each policy, reference, concept validator, verifier, and controls', () => {
    const projectile = getDomainPack('projectile')
    const pendulum = getDomainPack('pendulum')

    expect(projectile.policy.domain).toBe('projectile')
    expect(projectile.reference({ initialSpeedMps: 30, launchAngleDeg: 45 }).rangeM).toBeCloseTo(
      91.743119266055,
    )
    expect(projectile.manifest.controls.negative).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'tests/fixtures/negative-controls/projectile-radians.json',
          expected: expect.objectContaining({
            findingIds: expect.arrayContaining([PROJECTILE_FINDING_IDS.rangeMismatch]),
          }),
        }),
      ]),
    )

    expect(pendulum.policy.domain).toBe('pendulum')
    expect(pendulum.reference({ lengthM: 1, amplitudeDeg: 5 })).toBeCloseTo(2.006066680711)
    expect(pendulum.manifest.controls.negative).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'tests/fixtures/negative-controls/pendulum-inverted-ratio.json',
          expected: expect.objectContaining({
            findingIds: [
              PENDULUM_FINDING_IDS.periodRelativeError,
              PENDULUM_FINDING_IDS.periodRelativeError,
              PENDULUM_FINDING_IDS.periodRelativeError,
            ],
          }),
        }),
      ]),
    )
  })

  it('registers every fixture exactly once with an explicit expected outcome and exact IDs', () => {
    const registeredFixtures = BUILT_IN_DOMAIN_PACK_REGISTRY.values.flatMap((pack) => [
      ...pack.manifest.controls.positive.map((descriptor) => ({
        descriptor,
        fixtureClass: 'correct',
        pack,
      })),
      ...pack.manifest.controls.negative.map((descriptor) => ({
        descriptor,
        fixtureClass: 'negative-control',
        pack,
      })),
    ])
    const registeredPaths = registeredFixtures.map(({ descriptor }) => descriptor.path).sort()
    const fixturePaths = ['correct', 'negative-controls']
      .flatMap((directory) =>
        readdirSync(new URL(`tests/fixtures/${directory}/`, repositoryRoot), {
          withFileTypes: true,
        })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => `tests/fixtures/${directory}/${entry.name}`),
      )
      .sort()

    expect(registeredPaths).toEqual(fixturePaths)
    expect(new Set(registeredPaths).size).toBe(registeredPaths.length)

    for (const { descriptor, fixtureClass, pack } of registeredFixtures) {
      expect(descriptor.expected).toEqual(expect.any(Object))
      expect(descriptor.path.split('/').at(-1)?.startsWith(`${pack.id}-`)).toBe(true)
      if (fixtureClass === 'correct') {
        expect(descriptor.expected).toMatchObject({ kind: 'scientific', verdict: 'verified' })
      } else {
        expect(descriptor.expected).not.toMatchObject({ verdict: 'verified' })
      }

      const rawFixture = loadFixture(descriptor.path)
      const candidate = pack.materializeFixture(descriptor.id, rawFixture)
      const outcome = pack.verify(candidate) as
        | { readonly ok: false; readonly error: { readonly id: string } }
        | {
            readonly ok: true
            readonly result: {
              readonly verdict: 'inapplicable' | 'rejected' | 'verified'
              readonly findings: readonly { readonly id: string }[]
              readonly sampleCount: number
            }
          }

      if (!outcome.ok) {
        expect(descriptor.expected).toEqual({
          kind: 'boundary-failure',
          errorId: outcome.error.id,
        })
      } else {
        expect({
          kind: 'scientific',
          verdict: outcome.result.verdict,
          findingIds: outcome.result.findings.map(({ id }) => id),
          sampleCount: outcome.result.sampleCount,
        }).toEqual(descriptor.expected)
      }
    }
  })

  it('validates a whole requested concept range without clamping', () => {
    const projectile = getDomainPack('projectile')
    const validation = projectile.validateConcept({
      schemaVersion: '1',
      domain: 'projectile',
      title: 'Projectile lesson',
      parameters: {
        initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 15, max: 40 } },
        launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
      },
      requestedControls: ['initialSpeed', 'launchAngle'],
    })

    expect(validation.ok).toBe(true)
  })
})
