import type { GenerationPipelineRun } from '@simproof/persistence'
import { describe, expect, it } from 'vitest'

import { publicGenerationError } from './public-generation-error.js'

const run = (stableErrorId: string | null): GenerationPipelineRun => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  simulationVersionId: '223e4567-e89b-42d3-a456-426614174000',
  idempotencyKeyHash: 'idempotency-hash',
  state: 'provider_failed',
  revision: 3,
  maxAttempts: 3,
  budgets: {
    providerRequests: 6,
    inputTokens: 1_000,
    outputTokens: 1_000,
    costMicrousd: 10_000,
    artifactBytes: 100_000,
  },
  usage: {
    providerRequests: 1,
    inputTokens: 0,
    outputTokens: 0,
    costMicrousd: 0,
    artifactBytes: 0,
  },
  cancellationRequestedAt: null,
  terminalClassification: 'provider_failure',
  stableErrorId,
  findingsReference: null,
  createdAt: '2026-07-16T12:00:00.000Z',
  updatedAt: '2026-07-16T12:01:00.000Z',
  completedAt: '2026-07-16T12:01:00.000Z',
})

describe('public provider error classification', () => {
  it.each([
    ['provider.authentication-failed', 'authentication', false],
    ['provider.quota-exceeded', 'quota', false],
    ['provider.transient-failure', 'transient', true],
    ['provider.malformed-response', 'malformed-response', false],
  ] as const)('preserves trusted %s classification', (stableErrorId, category, retryable) => {
    expect(publicGenerationError(run(stableErrorId))).toEqual({
      category,
      stableErrorId,
      retryable,
    })
  })

  it('redacts untrusted identifiers to the safe transient classification', () => {
    expect(publicGenerationError(run('provider.raw-message-with-secret'))).toEqual({
      category: 'transient',
      stableErrorId: 'provider.transient-failure',
      retryable: true,
    })
  })
})
