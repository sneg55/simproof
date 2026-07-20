import { describe, expect, it } from 'vitest'

import {
  conceptCompilationResultSchema,
  generationBudgetSchema,
  generationErrorSchema,
  generationProvenanceSchema,
  generationRequestSchema,
  generationStateSchema,
  generationTerminalOutcomeSchema,
  generationTransitionSchema,
  isGenerationTransitionAllowed,
  orchestrationAttemptSchema,
} from '../index.js'

const timestamp = '2026-07-16T12:00:00.000Z'
const hash = `sha256:${'a'.repeat(64)}`
const secondHash = `sha256:${'b'.repeat(64)}`

const projectileConcept = {
  schemaVersion: '1',
  domain: 'projectile',
  title: 'Explore projectile motion',
  parameters: {
    initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 15, max: 40 } },
    launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
  },
  requestedControls: ['initialSpeed', 'launchAngle'],
} as const

const usage = { inputTokens: 120, outputTokens: 80, requestCount: 1, costMicrousd: 2_500 }
const compilerProvenance = {
  provider: 'openai-responses',
  model: 'gpt-5.1',
  templateVersion: '1.0.0',
  requestIds: ['resp_123'],
  threadId: null,
  usage,
} as const

describe('generation request contract', () => {
  it('accepts an exact bounded request', () => {
    const request = {
      schemaVersion: '1',
      simulationVersionId: '123e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: 'generate:lesson-42:revision-1',
      prompt: 'Build a projectile simulation with speed and angle controls.',
      maxAttempts: 3,
      budget: {
        maxProviderRequests: 6,
        maxInputTokens: 20_000,
        maxOutputTokens: 8_000,
        maxCostMicrousd: 100_000,
        maxArtifactBytes: 1_000_000,
      },
    }
    expect(generationRequestSchema.parse(request)).toEqual(request)
  })

  it.each([
    ['missing idempotency key', { idempotencyKey: undefined }],
    ['blank idempotency key', { idempotencyKey: '' }],
    ['too many attempts', { maxAttempts: 4 }],
    ['empty prompt', { prompt: '' }],
    ['unknown field', { credential: 'secret' }],
  ])('rejects %s', (_name, override) => {
    const candidate = {
      schemaVersion: '1',
      simulationVersionId: '123e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: 'generate:lesson-42:revision-1',
      prompt: 'Build a projectile simulation.',
      maxAttempts: 3,
      budget: {
        maxProviderRequests: 6,
        maxInputTokens: 20_000,
        maxOutputTokens: 8_000,
        maxCostMicrousd: 100_000,
        maxArtifactBytes: 1_000_000,
      },
      ...override,
    }
    expect(generationRequestSchema.safeParse(candidate).success).toBe(false)
  })
})

describe('generation state machine', () => {
  const states = generationStateSchema.options

  it('defines every state as either terminal or with at least one legal successor', () => {
    const terminal = new Set([
      'verified',
      'rejected',
      'cancelled',
      'provider_failed',
      'runner_failed',
      'budget_exhausted',
      'invariant_failed',
    ])
    for (const state of states) {
      const successors = states.filter((candidate) =>
        isGenerationTransitionAllowed(state, candidate),
      )
      expect(terminal.has(state) ? successors : successors.length > 0).toBeTruthy()
    }
  })

  it.each([
    ['queued', 'compiling'],
    ['compiling', 'generating'],
    ['generating', 'executing'],
    ['executing', 'verifying'],
    ['verifying', 'repairing'],
    ['repairing', 'executing'],
    ['verifying', 'verified'],
  ] as const)('accepts %s -> %s', (from, to) => {
    expect(generationTransitionSchema.safeParse({ from, to, occurredAt: timestamp }).success).toBe(
      true,
    )
  })

  it.each([
    ['queued', 'verified'],
    ['compiling', 'executing'],
    ['executing', 'repairing'],
    ['repairing', 'generating'],
    ['verified', 'queued'],
    ['cancelled', 'compiling'],
  ] as const)('rejects invalid transition %s -> %s', (from, to) => {
    expect(generationTransitionSchema.safeParse({ from, to, occurredAt: timestamp }).success).toBe(
      false,
    )
  })
})

describe('attempt and budget contracts', () => {
  it('caps attempts at three and requires repair evidence only on repair attempts', () => {
    expect(
      orchestrationAttemptSchema.safeParse({
        attemptNumber: 2,
        kind: 'repair',
        startedAt: timestamp,
        sourceArtifactHash: hash,
        findingsHash: secondHash,
      }).success,
    ).toBe(true)
    expect(
      orchestrationAttemptSchema.safeParse({
        attemptNumber: 4,
        kind: 'repair',
        startedAt: timestamp,
        sourceArtifactHash: hash,
        findingsHash: secondHash,
      }).success,
    ).toBe(false)
    expect(
      orchestrationAttemptSchema.safeParse({
        attemptNumber: 2,
        kind: 'repair',
        startedAt: timestamp,
        sourceArtifactHash: null,
        findingsHash: null,
      }).success,
    ).toBe(false)
  })

  it('rejects aggregate consumption beyond any configured budget', () => {
    const limits = {
      maxProviderRequests: 2,
      maxInputTokens: 100,
      maxOutputTokens: 50,
      maxCostMicrousd: 5_000,
      maxArtifactBytes: 1_000,
    }
    expect(
      generationBudgetSchema.safeParse({
        limits,
        consumed: {
          providerRequests: 2,
          inputTokens: 100,
          outputTokens: 50,
          costMicrousd: 5_000,
          artifactBytes: 1_000,
        },
      }).success,
    ).toBe(true)
    expect(
      generationBudgetSchema.safeParse({
        limits,
        consumed: {
          providerRequests: 3,
          inputTokens: 100,
          outputTokens: 50,
          costMicrousd: 5_000,
          artifactBytes: 1_000,
        },
      }).success,
    ).toBe(false)
    expect(
      generationBudgetSchema.safeParse({
        limits,
        consumed: {
          providerRequests: 2,
          inputTokens: 100,
          outputTokens: 50,
          costMicrousd: 5_001,
          artifactBytes: 1_000,
        },
      }).success,
    ).toBe(false)
    expect(
      generationBudgetSchema.safeParse({
        limits,
        consumed: {
          providerRequests: -1,
          inputTokens: 100,
          outputTokens: 50,
          costMicrousd: 5_000,
          artifactBytes: 1_000,
        },
      }).success,
    ).toBe(false)
  })
})

describe('provider errors and terminal outcomes', () => {
  it.each([
    ['authentication', 'provider.authentication-failed'],
    ['quota', 'provider.quota-exceeded'],
    ['transient', 'provider.transient-failure'],
    ['malformed-response', 'provider.malformed-response'],
    ['cancellation', 'generation.cancelled'],
    ['budget', 'generation.budget-exhausted'],
    ['runner', 'runner.execution-failed'],
    ['verifier-rejection', 'verifier.scientific-rejection'],
    ['invariant', 'orchestration.invariant-failed'],
  ] as const)('binds %s to stable ID %s', (category, stableErrorId) => {
    expect(
      generationErrorSchema.safeParse({ category, stableErrorId, retryable: false }).success,
    ).toBe(true)
    expect(
      generationErrorSchema.safeParse({ category, stableErrorId: 'wrong.id', retryable: false })
        .success,
    ).toBe(false)
  })

  it('keeps scientific rejection distinct from operational failures', () => {
    expect(
      generationTerminalOutcomeSchema.safeParse({
        state: 'rejected',
        attemptCount: 3,
        artifactHash: hash,
        verificationReportHash: secondHash,
        findingsCount: 2,
      }).success,
    ).toBe(true)
    expect(
      generationTerminalOutcomeSchema.safeParse({
        state: 'provider_failed',
        attemptCount: 1,
        error: {
          category: 'authentication',
          stableErrorId: 'provider.authentication-failed',
          retryable: false,
        },
      }).success,
    ).toBe(true)
    expect(
      generationTerminalOutcomeSchema.safeParse({
        state: 'rejected',
        attemptCount: 3,
        error: {
          category: 'runner',
          stableErrorId: 'runner.execution-failed',
          retryable: false,
        },
      }).success,
    ).toBe(false)
  })
})

describe('model output and provenance boundaries', () => {
  it('accepts schema-only concept data with redacted provenance', () => {
    expect(
      conceptCompilationResultSchema.safeParse({
        conceptSpec: projectileConcept,
        provenance: compilerProvenance,
      }).success,
    ).toBe(true)
  })

  it.each([
    ['executable code', { code: 'process.exit(1)' }],
    ['model-provided equations', { equations: ['x = v*t'] }],
    ['model-provided tolerance', { tolerance: 0.5 }],
    ['raw reasoning', { reasoning: 'hidden chain of thought' }],
  ])('rejects %s in concept output', (_name, extra) => {
    expect(
      conceptCompilationResultSchema.safeParse({
        conceptSpec: { ...projectileConcept, ...extra },
        provenance: compilerProvenance,
      }).success,
    ).toBe(false)
  })

  it('requires a Codex thread and rejects secret or raw prompt provenance fields', () => {
    const provenance = {
      schemaVersion: '1',
      conceptCompiler: compilerProvenance,
      codeGenerator: {
        provider: 'codex-sdk',
        model: 'gpt-5.1-codex',
        templateVersion: '1.0.0',
        requestIds: [],
        threadId: 'thread_789',
        usage,
      },
      conceptSpecHash: hash,
      artifactHashes: [secondHash],
      verification: {
        policyId: 'projectile.default',
        policyVersion: '1.0.0',
        policyHash: hash,
        domainPackId: 'projectile.core',
        domainPackVersion: '1.0.0',
        domainPackHash: secondHash,
        runnerVersion: '1.0.0',
      },
    }
    expect(generationProvenanceSchema.safeParse(provenance).success).toBe(true)
    expect(
      generationProvenanceSchema.safeParse({ ...provenance, apiKey: 'sk-secret' }).success,
    ).toBe(false)
    expect(
      generationProvenanceSchema.safeParse({
        ...provenance,
        conceptCompiler: { ...compilerProvenance, requestIds: [] },
      }).success,
    ).toBe(false)
    expect(
      generationProvenanceSchema.safeParse({
        ...provenance,
        codeGenerator: { ...provenance.codeGenerator, threadId: null },
      }).success,
    ).toBe(false)
  })
})
