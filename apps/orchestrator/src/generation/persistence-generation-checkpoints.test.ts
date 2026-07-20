import { describe, expect, it, vi } from 'vitest'

import type { GenerationArtifactWriter } from './generation-artifact-writer.js'
import { PersistenceGenerationCheckpoints } from './persistence-generation-checkpoints.js'

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000'
const VERSION_ID = '223e4567-e89b-42d3-a456-426614174000'
const CONCEPT_ID = '323e4567-e89b-42d3-a456-426614174000'
const ARTIFACT_ID = '423e4567-e89b-42d3-a456-426614174000'
const REVIEW_ID = '523e4567-e89b-42d3-a456-426614174000'
const HASH = `sha256:${'a'.repeat(64)}`
const NOW = '2026-07-16T12:00:00.000Z'

describe('PersistenceGenerationCheckpoints', () => {
  it('restores the distinct stored-artifact identity before restart confirmation resumes', async () => {
    const conceptSpec = {
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
      },
      requestedControls: ['length', 'amplitude'],
    }
    const review = {
      id: REVIEW_ID,
      runId: RUN_ID,
      simulationVersionId: VERSION_ID,
      conceptSpecId: CONCEPT_ID,
      conceptHash: HASH,
      status: 'pending' as const,
      revision: 0,
      createdAt: NOW,
      updatedAt: NOW,
      resolvedAt: null,
    }
    const durableRun = {
      id: RUN_ID,
      simulationVersionId: VERSION_ID,
      idempotencyKeyHash: 'hash',
      state: 'compiling' as const,
      revision: 2,
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
        inputTokens: 10,
        outputTokens: 20,
        costMicrousd: 30,
        artifactBytes: 0,
      },
      cancellationRequestedAt: null,
      terminalClassification: null,
      stableErrorId: null,
      findingsReference: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    }
    const restoreConcept = vi.fn()
    type AttemptsResult =
      | { readonly ok: true; readonly value: readonly [] }
      | {
          readonly ok: false
          readonly error: { readonly code: 'database-error'; readonly message: string }
        }
    const attempts = vi.fn<() => AttemptsResult>(() => ({ ok: true, value: [] }))
    const database = {
      conceptReviews: {
        snapshot: vi.fn(() => ({
          ok: true as const,
          value: { review, run: durableRun, version: { id: VERSION_ID } },
        })),
        confirm: vi.fn(() => ({ ok: true as const, value: { ...review, status: 'confirmed' } })),
      },
      records: {
        getConceptSpec: vi.fn(() => ({
          ok: true as const,
          value: { artifact: { artifactId: ARTIFACT_ID } },
        })),
      },
      generation: {
        settleConcept: vi.fn(() => ({
          ok: true as const,
          value: { ...durableRun, state: 'generating' as const, revision: 3 },
        })),
        attempts,
      },
    }
    const store = {
      get: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: Buffer.from(JSON.stringify(conceptSpec)),
        }),
      ),
    }
    const checkpoints = new PersistenceGenerationCheckpoints({
      database: database as never,
      store: store as never,
      artifacts: { restoreConcept } as unknown as GenerationArtifactWriter,
      id: vi.fn(() => REVIEW_ID),
      now: vi.fn(() => NOW),
    })

    await expect(
      checkpoints.confirmed({
        runId: RUN_ID,
        expectedRunRevision: 2,
        expectedReviewRevision: 1,
        expectedConceptHash: HASH,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Generation review changed concurrently.' },
    })
    expect(database.conceptReviews.confirm).not.toHaveBeenCalled()
    expect(restoreConcept).not.toHaveBeenCalled()

    const confirmed = await checkpoints.confirmed({
      runId: RUN_ID,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
      expectedConceptHash: HASH,
    })

    expect(confirmed).toMatchObject({
      ok: true,
      value: {
        run: { id: RUN_ID, state: 'generating' },
        simulationVersionId: VERSION_ID,
        transition: { from: 'compiling', to: 'generating' },
      },
    })
    expect(CONCEPT_ID).not.toBe(ARTIFACT_ID)
    expect(restoreConcept).toHaveBeenCalledWith({
      runId: RUN_ID,
      conceptSpecId: CONCEPT_ID,
      artifactId: ARTIFACT_ID,
      hash: HASH,
    })

    database.generation.settleConcept.mockClear()
    restoreConcept.mockClear()
    attempts.mockReturnValueOnce({
      ok: false as const,
      error: { code: 'database-error' as const, message: 'Injected attempt lookup failure.' },
    })

    await expect(
      checkpoints.confirmed({
        runId: RUN_ID,
        expectedRunRevision: 2,
        expectedReviewRevision: 0,
        expectedConceptHash: HASH,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'database-error', message: 'Injected attempt lookup failure.' },
    })
    expect(database.generation.settleConcept).not.toHaveBeenCalled()
    expect(restoreConcept).not.toHaveBeenCalled()
  })

  it('returns cancellation transition evidence only after durable settlement succeeds', () => {
    const durableRun = {
      id: RUN_ID,
      simulationVersionId: VERSION_ID,
      state: 'compiling' as const,
      revision: 2,
    }
    const settled = {
      ...durableRun,
      state: 'cancelled' as const,
      revision: 3,
      cancellationRequestedAt: NOW,
      updatedAt: NOW,
    }
    type Settlement =
      | { readonly ok: true; readonly value: typeof settled }
      | {
          readonly ok: false
          readonly error: { readonly code: 'conflict'; readonly message: string }
        }
    const settleConcept = vi.fn<() => Settlement>(() => ({ ok: true, value: settled }))
    const database = {
      generation: {
        get: vi.fn(() => ({ ok: true as const, value: durableRun })),
        settleConcept,
      },
    }
    const checkpoints = new PersistenceGenerationCheckpoints({
      database: database as never,
      store: {} as never,
      artifacts: {} as GenerationArtifactWriter,
      id: vi.fn(() => REVIEW_ID),
      now: vi.fn(() => NOW),
    })

    expect(
      checkpoints.cancel({
        runId: RUN_ID,
        expectedRunRevision: 2,
        expectedReviewRevision: 0,
      }),
    ).toEqual({
      ok: true,
      value: {
        cancellationRequestedAt: NOW,
        updatedAt: NOW,
        simulationVersionId: VERSION_ID,
        transition: { from: 'compiling', to: 'cancelled' },
      },
    })

    settleConcept.mockReturnValueOnce({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })
    expect(checkpoints.cancel({ runId: RUN_ID, expectedRunRevision: 2 })).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })
  })

  it('returns invariant transition evidence while terminal no-ops and settlement failures do not', () => {
    const active = {
      id: RUN_ID,
      simulationVersionId: VERSION_ID,
      state: 'compiling' as const,
      revision: 2,
      completedAt: null,
    }
    type Active = Omit<typeof active, 'completedAt' | 'state'> & {
      readonly completedAt: string | null
      readonly state: 'compiling' | 'invariant_failed'
    }
    type Lookup = { readonly ok: true; readonly value: Active }
    type Settlement =
      | {
          readonly ok: true
          readonly value: Active
        }
      | {
          readonly ok: false
          readonly error: { readonly code: 'conflict'; readonly message: string }
        }
    const get = vi.fn<() => Lookup>(() => ({ ok: true, value: active }))
    const settleConcept = vi.fn<() => Settlement>(() => ({
      ok: true,
      value: { ...active, state: 'invariant_failed', completedAt: NOW },
    }))
    const database = {
      generation: {
        get,
        settleConcept,
      },
    }
    const checkpoints = new PersistenceGenerationCheckpoints({
      database: database as never,
      store: {} as never,
      artifacts: {} as GenerationArtifactWriter,
      id: vi.fn(() => REVIEW_ID),
      now: vi.fn(() => NOW),
    })

    expect(checkpoints.failInvariant(RUN_ID)).toEqual({
      ok: true,
      value: {
        simulationVersionId: VERSION_ID,
        transition: { from: 'compiling', to: 'invariant_failed' },
      },
    })

    get.mockReturnValueOnce({
      ok: true,
      value: { ...active, completedAt: NOW },
    })
    expect(checkpoints.failInvariant(RUN_ID)).toEqual({ ok: true, value: undefined })
    expect(database.generation.settleConcept).toHaveBeenCalledTimes(1)

    settleConcept.mockReturnValueOnce({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })
    expect(checkpoints.failInvariant(RUN_ID)).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })
  })
})
