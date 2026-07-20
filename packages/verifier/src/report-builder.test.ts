import { verificationReportSchema } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { PENDULUM_POLICY } from './domains/pendulum/index.js'
import { PROJECTILE_POLICY, verifyProjectile } from './domains/projectile/index.js'
import { batchFromFixture } from './domains/projectile/test-fixture.js'
import { createVerificationReport, currentBindingsFor } from './report-builder.js'
import { assessReportValidity, isPublishable } from './report-validity.js'
import { PENDULUM_DOMAIN_PACK, PROJECTILE_DOMAIN_PACK } from './supported-domain-packs.js'

const conceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Small-angle pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
    amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 5, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
} as const

const reportInput = {
  reportId: '8d4448d2-45a1-4cb7-bd38-54341404304f',
  createdAt: '2026-07-16T12:00:00.000Z',
  conceptSpec,
  artifactSource: 'export const period = (length) => 2 * Math.PI * Math.sqrt(length / 9.81)\n',
  policy: PENDULUM_POLICY,
  domainPack: {
    id: 'pendulum',
    version: '1.0.0',
    contentHash: `sha256:${'c'.repeat(64)}` as const,
  },
  runner: { version: '1.0.0', protocolVersion: '1' as const },
  observations: [
    { input: { lengthM: 0.5, amplitudeDeg: 5 }, periodS: 1.419 },
    { input: { lengthM: 1, amplitudeDeg: 10 }, periodS: 2.006 },
    { input: { lengthM: 2, amplitudeDeg: 15 }, periodS: 2.837 },
  ],
}

describe('verification report construction', () => {
  it('binds a scoped report to exact artifact, policy, grid, and observations', () => {
    const report = createVerificationReport(reportInput)

    expect(verificationReportSchema.safeParse(report).success).toBe(true)
    expect(report.policy.id).toBe(PENDULUM_POLICY.id)
    expect(report.policy.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(report.domainPack).toEqual({
      id: PENDULUM_DOMAIN_PACK.id,
      version: PENDULUM_DOMAIN_PACK.version,
      contentHash: PENDULUM_DOMAIN_PACK.contentHash,
    })
    expect(report.limitations).toEqual(PENDULUM_POLICY.limitations)
    expect(report.verdict).toBe('verified')
    expect(report.checks).toEqual([{ id: 'pendulum.period', outcome: 'passed', sampleCount: 3 }])
    expect(report.testedScope).toEqual({
      parameters: [
        {
          parameter: 'lengthM',
          unit: 'm',
          min: 0.5,
          max: 2,
          sampledValues: [0.5, 1, 2],
        },
        {
          parameter: 'amplitudeDeg',
          unit: 'deg',
          min: 5,
          max: 15,
          sampledValues: [5, 10, 15],
        },
      ],
      sampleCount: 3,
      samplingGridHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    })
  })

  it.each([
    ['empty observations', []],
    ['missing policy case', reportInput.observations.slice(0, 2)],
  ])('refuses to construct a verified report from %s', (_name, observations) => {
    expect(() => createVerificationReport({ ...reportInput, observations })).toThrow(
      /observation|sampling grid/iu,
    )
  })

  it('records out-of-policy observations as inapplicable instead of a scientific rejection', () => {
    const report = createVerificationReport({
      ...reportInput,
      observations: [{ input: { lengthM: 1, amplitudeDeg: 20 }, periodS: 2.006 }],
    })

    expect(report.verdict).toBe('inapplicable')
    expect(report.checks).toEqual([
      { id: 'pendulum.period', outcome: 'not-applicable', sampleCount: 1 },
    ])
    expect(report.testedScope.sampleCount).toBe(1)
  })

  it('does not let caller assertions control the trusted scientific outcome', () => {
    const forgedInput = {
      ...reportInput,
      result: { verdict: 'rejected', findings: [], sampleCount: 99 },
    }
    const report = createVerificationReport(forgedInput)

    expect(report.verdict).toBe('verified')
    expect(report.testedScope.sampleCount).toBe(3)
  })

  it('derives domain-specific check counts and total scope from the projectile policy grid', () => {
    const batch = batchFromFixture({ id: 'report-correct', implementation: 'analytic' })
    const outcome = verifyProjectile(batch)
    expect(outcome.ok).toBe(true)

    const report = createVerificationReport({
      ...reportInput,
      policy: PROJECTILE_POLICY,
      observations: batch.observations,
    })

    expect(report.testedScope.sampleCount).toBe(9)
    expect(report.domainPack).toEqual({
      id: PROJECTILE_DOMAIN_PACK.id,
      version: PROJECTILE_DOMAIN_PACK.version,
      contentHash: PROJECTILE_DOMAIN_PACK.contentHash,
    })
    expect(report.checks).toEqual(
      PROJECTILE_POLICY.checks.map((id) => ({
        id,
        outcome: 'passed',
        sampleCount: 5,
      })),
    )
    expect(report.testedScope.parameters).toEqual([
      {
        parameter: 'initialSpeedMps',
        unit: 'm/s',
        min: 15,
        max: 40,
        sampledValues: [20, 30, 25, 40, 15],
      },
      {
        parameter: 'launchAngleDeg',
        unit: 'deg',
        min: 15,
        max: 75,
        sampledValues: [30, 45, 60, 15, 75, 40, 50],
      },
    ])
  })

  it('makes a previously verified report stale after artifact mutation', () => {
    const report = createVerificationReport(reportInput)
    const current = currentBindingsFor(reportInput)
    const mutated = currentBindingsFor({
      ...reportInput,
      artifactSource: `${reportInput.artifactSource}// candidate mutation\n`,
    })

    expect(assessReportValidity(report, current)).toEqual({ status: 'current' })
    const validity = assessReportValidity(report, mutated)
    expect(validity).toEqual({ status: 'stale', reasons: ['artifact-changed'] })
    expect(isPublishable(report, validity)).toBe(false)
  })

  it('makes a report stale when the validated observations change', () => {
    const report = createVerificationReport(reportInput)
    const mutated = currentBindingsFor({
      ...reportInput,
      observations: reportInput.observations.map((observation, index) =>
        index === 0 ? { ...observation, periodS: observation.periodS + 0.001 } : observation,
      ),
    })

    expect(assessReportValidity(report, mutated)).toEqual({
      status: 'stale',
      reasons: ['observations-changed'],
    })
  })
})
