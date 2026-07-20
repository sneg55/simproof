import type { GenerationAccepted, GenerationStatus } from '@simproof/contracts'
import { vi } from 'vitest'

import type { EducatorGenerationApi } from '@/api/educator-api'
import type { GenerationTarget } from '@/generation/generation-workspace'

export const runId = '33333333-3333-4333-8333-333333333333'
export const csrfToken = 'c'.repeat(43)
export const conceptSpecHash = `sha256:${'a'.repeat(64)}`
export const simulationId = '11111111-1111-4111-8111-111111111111'
export const target: GenerationTarget = {
  simulationTitle: 'Classroom pendulum',
  simulationVersionId: '22222222-2222-4222-8222-222222222222',
  expectedVersionRevision: 3,
}
export const accepted: GenerationAccepted = { runId, created: true, state: 'queued', revision: 0 }

export function api(overrides: Partial<EducatorGenerationApi> = {}): EducatorGenerationApi {
  return {
    startGeneration: vi
      .fn<EducatorGenerationApi['startGeneration']>()
      .mockResolvedValue({ ok: true, value: accepted }),
    generationStatus: vi
      .fn<EducatorGenerationApi['generationStatus']>()
      .mockImplementation(() => new Promise(() => undefined)),
    decideConcept: vi.fn<EducatorGenerationApi['decideConcept']>(),
    cancelGeneration: vi.fn<EducatorGenerationApi['cancelGeneration']>(),
    ...overrides,
  }
}

export function status(
  state: GenerationStatus['state'],
  overrides: Partial<GenerationStatus> = {},
): GenerationStatus {
  const now = '2026-07-16T12:00:00.000Z'
  return {
    runId,
    simulationVersionId: target.simulationVersionId,
    state,
    revision: 4,
    maxAttempts: 3,
    budget: {
      limits: {
        maxProviderRequests: 6,
        maxInputTokens: 120_000,
        maxOutputTokens: 30_000,
        maxCostMicrousd: 5_000_000,
        maxArtifactBytes: 2_000_000,
      },
      consumed: {
        providerRequests: 1,
        inputTokens: 200,
        outputTokens: 100,
        costMicrousd: 2_000,
        artifactBytes: 0,
      },
    },
    conceptReview: { status: 'not-ready' },
    cancellationRequestedAt: null,
    error: null,
    attempts: [],
    transitions: [{ sequence: 0, from: null, to: state, occurredAt: now }],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  }
}
