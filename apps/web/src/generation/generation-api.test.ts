import type { EducatorGenerationStartRequest } from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createEducatorGenerationApi } from '@/api/educator-api'
import type { HttpClient } from '@/api/http-client'

const runId = '33333333-3333-4333-8333-333333333333'
const csrfToken = 'c'.repeat(43)
const conceptSpecHash = `sha256:${'a'.repeat(64)}`
const request: EducatorGenerationStartRequest = {
  schemaVersion: '1',
  simulationVersionId: '22222222-2222-4222-8222-222222222222',
  expectedVersionRevision: 3,
  idempotencyKey: 'web:22222222:fixture',
  teacher: {
    prompt: 'Build a pendulum model.',
    externalProviderDisclosureAccepted: true,
    promptRetention: 'discard',
  },
  maxAttempts: 3,
  budget: {
    maxProviderRequests: 6,
    maxInputTokens: 120_000,
    maxOutputTokens: 30_000,
    maxCostMicrousd: 5_000_000,
    maxArtifactBytes: 2_000_000,
  },
}

describe('educator generation API', () => {
  it('uses strict schemas, CSRF, and canonical generation targets', async () => {
    const requestMock = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { kind: 'unavailable' as const, id: 'fixture' },
      }),
    )
    const client: HttpClient = {
      request: requestMock,
    }
    const api = createEducatorGenerationApi(client)

    await api.startGeneration(request, csrfToken)
    await api.generationStatus(runId)
    await api.decideConcept(
      runId,
      {
        expectedRunRevision: 4,
        expectedReviewRevision: 0,
        conceptSpecHash,
        decision: 'accept',
      },
      csrfToken,
    )
    await api.cancelGeneration(runId, { expectedRunRevision: 5 }, csrfToken)

    expect(requestMock).toHaveBeenNthCalledWith(1, '/api/generations', expect.anything(), {
      method: 'POST',
      body: request,
      csrfToken,
    })
    expect(requestMock).toHaveBeenNthCalledWith(2, `/api/generations/${runId}`, expect.anything(), {
      signal: undefined,
    })
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      `/api/generations/${runId}/concept-review`,
      expect.anything(),
      {
        method: 'POST',
        body: {
          expectedRunRevision: 4,
          expectedReviewRevision: 0,
          conceptSpecHash,
          decision: 'accept',
        },
        csrfToken,
      },
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      4,
      `/api/generations/${runId}/cancellation`,
      expect.anything(),
      { method: 'POST', body: { expectedRunRevision: 5 }, csrfToken },
    )
  })

  it('rejects invalid request data and identifiers before the HTTP boundary', async () => {
    const requestMock = vi.fn()
    const client: HttpClient = { request: requestMock }
    const api = createEducatorGenerationApi(client)

    await expect(
      api.startGeneration(
        { ...request, teacher: { ...request.teacher, prompt: '   ' } },
        csrfToken,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-request', id: 'web.invalid-request' },
    })
    await expect(api.generationStatus('../secrets')).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-request', id: 'web.invalid-request' },
    })
    expect(requestMock).not.toHaveBeenCalled()
  })
})
