import type {
  RunnerBinding,
  VerificationDependencyBinding,
  VerificationRun,
} from '@simproof/contracts'
import { getDomainPack, hashCanonicalJson } from '@simproof/verifier'
import { describe, expect, it } from 'vitest'

import { createInstalledVerificationAuthorityResolver } from './installed-verification-authority.js'

const runner: RunnerBinding = { version: '2.0.0', protocolVersion: '1' }
const dependencies: VerificationDependencyBinding = {
  schemaVersion: '1',
  entries: [
    {
      id: 'runner-runtime',
      version: '2.0.0',
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
  ],
  contentHash: `sha256:${'b'.repeat(64)}`,
}

function runFor(options: {
  readonly policyReferenceId?: string
  readonly domainPackReferenceId?: string
  readonly policyContentHash: `sha256:${string}`
  readonly domainPackContentHash: `sha256:${string}`
}): VerificationRun {
  return {
    policyReferenceId: options.policyReferenceId ?? '11111111-1111-4111-8111-111111111111',
    domainPackReferenceId: options.domainPackReferenceId ?? '22222222-2222-4222-8222-222222222222',
    policyContentHash: options.policyContentHash,
    domainPackContentHash: options.domainPackContentHash,
    runnerVersion: '0.1.0',
    runnerProtocolVersion: '1',
    dependencies: {
      schemaVersion: '1',
      entries: [],
      contentHash: `sha256:${'c'.repeat(64)}`,
    },
  } as unknown as VerificationRun
}

function requiredDomainPack(domain: 'pendulum' | 'projectile') {
  const pack = getDomainPack(domain)
  if (pack === undefined) throw new TypeError(`Missing test domain pack: ${domain}`)
  return pack
}

const policyHash = (domain: 'pendulum' | 'projectile') =>
  hashCanonicalJson(requiredDomainPack(domain).policy) as `sha256:${string}`

function trustedRun(
  domain: 'pendulum' | 'projectile',
  references?: { readonly policy: string; readonly domainPack: string },
): VerificationRun {
  const pack = requiredDomainPack(domain)
  return runFor({
    ...(references === undefined
      ? {}
      : {
          policyReferenceId: references.policy,
          domainPackReferenceId: references.domainPack,
        }),
    policyContentHash: policyHash(domain),
    domainPackContentHash: pack.contentHash as `sha256:${string}`,
  })
}

describe('installed verification authority resolver', () => {
  it.each(['pendulum', 'projectile'] as const)(
    'accepts the exact currently installed %s policy/domain-pack pair',
    (domain) => {
      const run = trustedRun(domain)
      const resolve = createInstalledVerificationAuthorityResolver({ runner, dependencies })

      expect(resolve(run)).toEqual({
        ok: true,
        value: {
          policyReferenceId: run.policyReferenceId,
          policyContentHash: run.policyContentHash,
          domainPackReferenceId: run.domainPackReferenceId,
          domainPackContentHash: run.domainPackContentHash,
          runnerVersion: runner.version,
          runnerProtocolVersion: runner.protocolVersion,
          dependencies,
        },
      })
    },
  )

  it('resolves authority independently for each run without mutable domain selection', () => {
    const resolve = createInstalledVerificationAuthorityResolver({ runner, dependencies })
    const projectile = trustedRun('projectile', {
      policy: '33333333-3333-4333-8333-333333333333',
      domainPack: '44444444-4444-4444-8444-444444444444',
    })
    const pendulum = trustedRun('pendulum', {
      policy: '55555555-5555-4555-8555-555555555555',
      domainPack: '66666666-6666-4666-8666-666666666666',
    })

    expect(resolve(projectile)).toMatchObject({
      ok: true,
      value: {
        policyReferenceId: projectile.policyReferenceId,
        domainPackReferenceId: projectile.domainPackReferenceId,
      },
    })
    expect(resolve(pendulum)).toMatchObject({
      ok: true,
      value: {
        policyReferenceId: pendulum.policyReferenceId,
        domainPackReferenceId: pendulum.domainPackReferenceId,
      },
    })
  })

  it.each([
    [
      'mixed installed pair',
      runFor({
        policyContentHash: policyHash('pendulum'),
        domainPackContentHash: requiredDomainPack('projectile').contentHash as `sha256:${string}`,
      }),
    ],
    [
      'stale policy',
      runFor({
        policyContentHash: `sha256:${'d'.repeat(64)}`,
        domainPackContentHash: requiredDomainPack('pendulum').contentHash as `sha256:${string}`,
      }),
    ],
    [
      'stale domain pack',
      runFor({
        policyContentHash: policyHash('projectile'),
        domainPackContentHash: `sha256:${'e'.repeat(64)}`,
      }),
    ],
    [
      'unknown pair',
      runFor({
        policyContentHash: `sha256:${'f'.repeat(64)}`,
        domainPackContentHash: `sha256:${'0'.repeat(64)}`,
      }),
    ],
  ] as const)('rejects a %s with one stable persistence error', (_name, run) => {
    const resolve = createInstalledVerificationAuthorityResolver({ runner, dependencies })

    expect(resolve(run)).toEqual({
      ok: false,
      error: {
        code: 'invalid-state',
        message: 'Verification run does not match an installed trusted policy and domain pack.',
      },
    })
  })

  it('captures validated runner and dependency configuration immutably', () => {
    const mutableDependencies = {
      schemaVersion: '1' as const,
      entries: dependencies.entries.map((entry) => ({ ...entry })),
      contentHash: dependencies.contentHash,
    }
    const resolve = createInstalledVerificationAuthorityResolver({
      runner,
      dependencies: mutableDependencies,
    })
    mutableDependencies.entries[0]!.version = '9.0.0'

    const result = resolve(trustedRun('pendulum'))

    expect(result).toMatchObject({
      ok: true,
      value: { dependencies },
    })
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true)
      expect(Object.isFrozen(result.value.dependencies.entries)).toBe(true)
    }
  })
})
