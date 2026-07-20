import { describe, expect, it } from 'vitest'

import {
  currentVerificationBindingsSchema,
  pendulumVerificationPolicySchema,
  projectileVerificationPolicySchema,
  reportValiditySchema,
  verificationFindingSchema,
  verificationPolicySchema,
  verificationReportSchema,
} from '../index.js'

const hash = `sha256:${'a'.repeat(64)}`

const projectilePolicy = {
  schemaVersion: '1',
  id: 'projectile.standard',
  version: '1.0.0',
  domain: 'projectile',
  checks: [
    'projectile.range',
    'projectile.apex-height',
    'projectile.flight-time',
    'projectile.trajectory-curve',
    'projectile.energy-conservation',
    'projectile.range-maximum',
  ],
  applicability: {
    initialSpeedMps: { min: 15, max: 40 },
    launchAngleDeg: { min: 15, max: 75 },
    gravityMps2: 9.81,
  },
  sampling: {
    cases: [{ initialSpeedMps: 30, launchAngleDeg: 45 }],
    trajectoryFractions: [0, 0.25, 0.5, 0.75, 1],
    rangeMaximum: { initialSpeedMps: 30, launchAnglesDeg: [30, 40, 45, 50, 60] },
  },
  tolerances: {
    rangeM: { mode: 'relative', relative: 0.01 },
    apexHeightM: { mode: 'relative', relative: 0.01 },
    flightTimeS: { mode: 'relative', relative: 0.01 },
    trajectoryYM: { relativeTo: 'apexHeightM', relative: 0.02 },
    trajectoryTimeS: { relativeScale: 1e-10 },
    trajectoryXM: { relativeTo: 'rangeM', relative: 0.01 },
    specificEnergy: { mode: 'relative', relative: 0.02 },
    rangeMaximum: { expectedAngleDeg: 45, relativeOrdering: 0.01 },
  },
  assumptions: ['Uniform gravity and no aerodynamic drag.'],
  limitations: ['Verification is bounded to the recorded sampling grid.'],
} as const

const report = {
  schemaVersion: '1',
  reportId: '8d4448d2-45a1-4cb7-bd38-54341404304f',
  createdAt: '2026-07-16T12:00:00.000Z',
  conceptSpecHash: hash,
  artifact: { hash },
  policy: { id: 'projectile.standard', version: '1.0.0', contentHash: hash },
  domainPack: { id: 'projectile', version: '1.0.0', contentHash: hash },
  runner: { version: '1.0.0', protocolVersion: '1' },
  observationHash: hash,
  verdict: 'verified',
  checks: [{ id: 'projectile.range', outcome: 'passed', sampleCount: 5 }],
  findings: [],
  testedScope: {
    parameters: [
      { parameter: 'initialSpeed', unit: 'm/s', min: 15, max: 40, sampledValues: [15, 30, 40] },
    ],
    sampleCount: 5,
    samplingGridHash: hash,
  },
  assumptions: ['Uniform gravity and no aerodynamic drag.'],
  limitations: ['Verification is bounded to the recorded sampling grid.'],
} as const

describe('verification policies', () => {
  it('accepts the exact projectile policy through both schemas', () => {
    expect(projectileVerificationPolicySchema.safeParse(projectilePolicy).success).toBe(true)
    expect(verificationPolicySchema.safeParse(projectilePolicy).success).toBe(true)
  })

  it('accepts an exact pendulum policy', () => {
    expect(
      pendulumVerificationPolicySchema.safeParse({
        schemaVersion: '1',
        id: 'pendulum.small-angle',
        version: '1.0.0',
        domain: 'pendulum',
        checks: ['pendulum.period'],
        applicability: {
          lengthM: { min: 0.5, max: 2 },
          amplitudeDeg: { minExclusive: 0, max: 15 },
          gravityMps2: 9.81,
          model: 'small-angle',
        },
        sampling: { cases: [{ lengthM: 1, amplitudeDeg: 5 }] },
        tolerances: { periodS: { mode: 'relative', relative: 0.01 } },
        assumptions: ['Small-angle approximation.'],
        limitations: ['Not applicable above the configured amplitude.'],
      }).success,
    ).toBe(true)
  })

  it.each([
    ['unknown check', { ...projectilePolicy, checks: ['projectile.range', 'projectile.magic'] }],
    [
      'peak grid without 45 degrees',
      {
        ...projectilePolicy,
        sampling: {
          ...projectilePolicy.sampling,
          rangeMaximum: {
            ...projectilePolicy.sampling.rangeMaximum,
            launchAnglesDeg: [30, 40, 50, 60],
          },
        },
      },
    ],
    [
      'unsorted trajectory fractions',
      {
        ...projectilePolicy,
        sampling: { ...projectilePolicy.sampling, trajectoryFractions: [0, 0.75, 0.5, 1] },
      },
    ],
    ['extra policy key', { ...projectilePolicy, mutable: true }],
    ['non-semver version', { ...projectilePolicy, version: 'v1' }],
  ])('rejects %s', (_name, value) => {
    expect(verificationPolicySchema.safeParse(value).success).toBe(false)
  })
})

describe('findings and reports', () => {
  const finding = {
    id: 'projectile.range.relative-error',
    category: 'mismatch',
    severity: 'error',
    checkId: 'projectile.range',
    quantity: 'rangeM',
    inputs: { initialSpeed: { value: 30, unit: 'm/s' }, launchAngle: { value: 45, unit: 'deg' } },
    expected: { value: 91.74, unit: 'm' },
    actual: { value: 60, unit: 'm' },
    tolerance: { mode: 'relative', relative: 0.01 },
    error: { mode: 'relative', value: 0.346 },
    explanation: 'The sampled range exceeds the accepted relative error.',
  } as const

  it('accepts structured findings and a coherent verified report', () => {
    expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
    expect(verificationReportSchema.safeParse(report).success).toBe(true)
  })

  it.each([
    ['verified report with error finding', { ...report, findings: [finding] }],
    [
      'verified report with failed check',
      { ...report, checks: [{ ...report.checks[0], outcome: 'failed' }] },
    ],
    [
      'verified report with a check count inconsistent with tested scope',
      { ...report, checks: [{ ...report.checks[0], sampleCount: 6 }] },
    ],
    [
      'verified report with an empty tested sample count',
      {
        ...report,
        checks: [{ ...report.checks[0], sampleCount: 0 }],
        testedScope: { ...report.testedScope, sampleCount: 0 },
      },
    ],
    ['rejected report without finding', { ...report, verdict: 'rejected' }],
    [
      'inapplicable report with scientific failure',
      {
        ...report,
        verdict: 'inapplicable',
        checks: [{ ...report.checks[0], outcome: 'failed' }],
        findings: [finding],
      },
    ],
    ['unknown report key', { ...report, safeToShip: true }],
  ])('rejects %s', (_name, value) => {
    expect(verificationReportSchema.safeParse(value).success).toBe(false)
  })
})

describe('report validity contracts', () => {
  it('accepts current bindings and discriminated validity results', () => {
    expect(
      currentVerificationBindingsSchema.safeParse({
        conceptSpecHash: hash,
        artifactHash: hash,
        observationHash: hash,
        policy: { id: 'projectile.standard', version: '1.0.0', contentHash: hash },
        domainPack: { id: 'projectile', version: '1.0.0', contentHash: hash },
        runner: { version: '1.0.0', protocolVersion: '1' },
      }).success,
    ).toBe(true)
    expect(reportValiditySchema.safeParse({ status: 'current' }).success).toBe(true)
    expect(
      reportValiditySchema.safeParse({
        status: 'stale',
        reasons: [
          'artifact-changed',
          'dependencies-changed',
          'observations-changed',
          'policy-changed',
        ],
      }).success,
    ).toBe(true)
  })

  it.each([
    ['empty stale reasons', { status: 'stale', reasons: [] }],
    [
      'duplicate stale reasons',
      { status: 'stale', reasons: ['artifact-changed', 'artifact-changed'] },
    ],
    ['unknown stale reason', { status: 'stale', reasons: ['weather-changed'] }],
    ['extra current property', { status: 'current', reasons: [] }],
  ])('rejects %s', (_name, value) => {
    expect(reportValiditySchema.safeParse(value).success).toBe(false)
  })
})
