import { describe, expect, it } from 'vitest'

import {
  conceptReviewDecisionSchema,
  conceptReviewSchema,
  educatorGenerationStartRequestSchema,
  educatorGenerationStateSchema,
  generationAcceptedSchema,
  generationStatusSchema,
  publishVersionRequestSchema,
  verificationReportDisplaySchema,
} from '../index.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
const secondId = '223e4567-e89b-42d3-a456-426614174000'
const timestamp = '2026-07-16T12:00:00.000Z'
const hash = `sha256:${'a'.repeat(64)}`
const otherHash = `sha256:${'b'.repeat(64)}`

const concept = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Small-angle pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
} as const

const limits = {
  maxProviderRequests: 6,
  maxInputTokens: 20_000,
  maxOutputTokens: 8_000,
  maxCostMicrousd: 100_000,
  maxArtifactBytes: 1_000_000,
} as const

const budget = {
  limits,
  consumed: {
    providerRequests: 1,
    inputTokens: 100,
    outputTokens: 50,
    costMicrousd: 500,
    artifactBytes: 1_000,
  },
} as const

describe('browser generation contracts', () => {
  it('requires disclosure and bounds the accepted start request', () => {
    const request = {
      schemaVersion: '1',
      simulationVersionId: id,
      expectedVersionRevision: 0,
      idempotencyKey: 'generation:pendulum:1',
      teacher: {
        prompt: 'Create a pendulum simulation.',
        externalProviderDisclosureAccepted: true,
        promptRetention: 'discard',
      },
      maxAttempts: 3,
      budget: limits,
    }
    expect(educatorGenerationStartRequestSchema.safeParse(request).success).toBe(true)
    expect(
      educatorGenerationStartRequestSchema.safeParse({
        ...request,
        teacher: { ...request.teacher, externalProviderDisclosureAccepted: false },
      }).success,
    ).toBe(false)
    expect(
      educatorGenerationStartRequestSchema.safeParse({ ...request, apiKey: 'secret' }).success,
    ).toBe(false)
  })

  it('represents every operational state plus the derived confirmation state', () => {
    const states = [
      'queued',
      'compiling',
      'awaiting_confirmation',
      'generating',
      'executing',
      'verifying',
      'repairing',
      'verified',
      'rejected',
      'cancelled',
      'provider_failed',
      'runner_failed',
      'budget_exhausted',
      'invariant_failed',
    ] as const
    for (const state of states)
      expect(educatorGenerationStateSchema.safeParse(state).success).toBe(true)
    expect(educatorGenerationStateSchema.safeParse('invalid-output').success).toBe(false)
  })

  it('returns the actual durable state for idempotent acceptance replay', () => {
    expect(
      generationAcceptedSchema.safeParse({
        runId: id,
        created: false,
        state: 'awaiting_confirmation',
        revision: 2,
      }).success,
    ).toBe(true)
    expect(
      generationAcceptedSchema.safeParse({
        runId: id,
        created: false,
        state: 'unknown',
        revision: 2,
      }).success,
    ).toBe(false)
  })

  it('keeps concept review strict and binds pending review to exact concept data', () => {
    expect(
      conceptReviewSchema.safeParse({
        status: 'pending',
        reviewRevision: 0,
        conceptSpec: concept,
        conceptSpecHash: hash,
      }).success,
    ).toBe(true)
    expect(
      conceptReviewSchema.safeParse({
        status: 'pending',
        reviewRevision: 0,
        conceptSpec: concept,
        conceptSpecHash: hash,
        rawPrompt: 'must not return',
      }).success,
    ).toBe(false)
  })

  it('requires both durable revisions for an exact concept decision', () => {
    expect(
      conceptReviewDecisionSchema.safeParse({
        expectedRunRevision: 2,
        expectedReviewRevision: 0,
        conceptSpecHash: hash,
        decision: 'accept',
      }).success,
    ).toBe(true)
    expect(
      conceptReviewDecisionSchema.safeParse({
        expectedRunRevision: 2,
        conceptSpecHash: hash,
        decision: 'accept',
      }).success,
    ).toBe(false)
  })

  it('exposes exact bounded public status keys and no provider identifiers', () => {
    const status = generationStatusSchema.parse({
      runId: id,
      simulationVersionId: secondId,
      state: 'awaiting_confirmation',
      revision: 2,
      maxAttempts: 3,
      budget,
      conceptReview: {
        status: 'pending',
        reviewRevision: 0,
        conceptSpec: concept,
        conceptSpecHash: hash,
      },
      cancellationRequestedAt: null,
      error: null,
      attempts: [],
      transitions: [
        { sequence: 0, from: null, to: 'queued', occurredAt: timestamp },
        { sequence: 1, from: 'queued', to: 'compiling', occurredAt: timestamp },
        { sequence: 2, from: 'compiling', to: 'awaiting_confirmation', occurredAt: timestamp },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    })
    expect(Object.keys(status).sort()).toEqual([
      'attempts',
      'budget',
      'cancellationRequestedAt',
      'completedAt',
      'conceptReview',
      'createdAt',
      'error',
      'maxAttempts',
      'revision',
      'runId',
      'simulationVersionId',
      'state',
      'transitions',
      'updatedAt',
    ])
    expect(
      generationStatusSchema.safeParse({ ...status, codexThreadId: 'thread-secret' }).success,
    ).toBe(false)
  })
})

describe('report and publication contracts', () => {
  const policy = {
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
    sampling: { cases: [{ lengthM: 1, amplitudeDeg: 10 }] },
    tolerances: { periodS: { mode: 'relative', relative: 0.01 } },
    assumptions: ['Uniform gravity.'],
    limitations: ['Small-angle approximation only.'],
  } as const
  const report = {
    schemaVersion: '1',
    reportId: secondId,
    createdAt: timestamp,
    conceptSpecHash: hash,
    artifact: { hash },
    policy: { id: policy.id, version: policy.version, contentHash: otherHash },
    domainPack: { id: 'pendulum', version: '1.0.0', contentHash: hash },
    runner: { version: '1.0.0', protocolVersion: '1' },
    observationHash: otherHash,
    verdict: 'verified',
    checks: [{ id: 'pendulum.period', outcome: 'passed', sampleCount: 1 }],
    findings: [],
    testedScope: {
      parameters: [{ parameter: 'lengthM', unit: 'm', min: 1, max: 1 }],
      sampleCount: 1,
      samplingGridHash: hash,
    },
    assumptions: policy.assumptions,
    limitations: policy.limitations,
  } as const
  const display = {
    simulationVersionId: id,
    verificationRunId: secondId,
    reportArtifactHash: otherHash,
    versionRevision: 4,
    conceptSpec: concept,
    report,
    validity: { status: 'current' },
    policy,
    publication: { published: false },
    badgeActive: true,
    publishable: true,
  } as const

  it('binds report, policy, domain, badge, and publication authority', () => {
    expect(verificationReportDisplaySchema.safeParse(display).success).toBe(true)
    expect(
      verificationReportDisplaySchema.safeParse({
        ...display,
        reportArtifactHash: undefined,
      }).success,
    ).toBe(false)
    expect(
      verificationReportDisplaySchema.safeParse({
        ...display,
        validity: { status: 'stale', reasons: ['policy-changed'] },
      }).success,
    ).toBe(false)
    expect(
      verificationReportDisplaySchema.safeParse({
        ...display,
        validity: { status: 'stale', reasons: ['policy-changed'] },
        badgeActive: false,
        publishable: false,
      }).success,
    ).toBe(true)
    expect(
      verificationReportDisplaySchema.safeParse({
        ...display,
        report: { ...report, limitations: ['Different limitation.'] },
      }).success,
    ).toBe(false)
  })

  it('requires exact publication concurrency and license inputs', () => {
    expect(
      publishVersionRequestSchema.safeParse({
        expectedRevision: 4,
        verificationRunId: secondId,
        exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
      }).success,
    ).toBe(true)
    expect(
      publishVersionRequestSchema.safeParse({
        expectedRevision: 4,
        verificationRunId: secondId,
        exportLicense: { kind: 'none' },
        force: true,
      }).success,
    ).toBe(false)
  })
})
