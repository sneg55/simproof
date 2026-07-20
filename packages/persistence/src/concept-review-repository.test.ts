import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW, stored } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

async function compiling(name: string) {
  const context = await fixture(name)
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.educator.createDraft({
      simulation: { id: simulationId, title: 'Review', createdAt: NOW, updatedAt: NOW },
      version: {
        id: versionId,
        simulationId,
        versionNumber: 1,
        state: 'draft',
        revision: 0,
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  )
  const run = expectOk(
    context.database.beginOrReplayGeneration({
      versionId,
      expectedRevision: 0,
      idempotencyKey: `review-${name}`,
      updatedAt: NOW,
      run: { id: id(), maxAttempts: 3, codexSessionId: null, createdAt: NOW },
      budgets: {
        providerRequests: 3,
        inputTokens: 1_000,
        outputTokens: 1_000,
        costMicrousd: 1_000,
        artifactBytes: 100_000,
      },
    }),
  ).run
  expectOk(
    context.database.generation.transition({
      runId: run.id,
      expectedRevision: 0,
      to: 'compiling',
      at: NOW,
    }),
  )
  const artifact = await stored(
    context.database,
    context.store,
    'concept-spec',
    JSON.stringify({
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Review',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 5, max: 15 } },
      },
      requestedControls: ['length', 'amplitude'],
    }),
  )
  const conceptSpecId = id()
  expectOk(
    context.database.records.insertConceptSpec({
      id: conceptSpecId,
      simulationVersionId: versionId,
      generationRunId: run.id,
      schemaVersion: '1',
      domain: 'pendulum',
      artifact: {
        artifactId: artifact.id,
        role: 'concept-spec',
        contentHash: artifact.contentHash,
      },
      createdAt: NOW,
    }),
  )
  return { ...context, artifact, conceptSpecId, run, simulationId, versionId }
}

function review(context: Awaited<ReturnType<typeof compiling>>) {
  return {
    id: id(),
    runId: context.run.id,
    simulationVersionId: context.versionId,
    conceptSpecId: context.conceptSpecId,
    conceptHash: context.artifact.contentHash,
    status: 'pending' as const,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
  }
}

function recordConceptCompilation(context: Awaited<ReturnType<typeof compiling>>) {
  return context.database.generation.recordExternalCall({
    id: id(),
    runId: context.run.id,
    attemptId: null,
    operation: 'concept_compile',
    provider: 'fake',
    modelId: 'fake-concept',
    templateVersion: 'concept.v1',
    providerRequestId: `concept-${context.run.id}`,
    codexThreadId: null,
    stableErrorId: null,
    usage: {
      providerRequests: 1,
      inputTokens: 1,
      outputTokens: 1,
      costMicrousd: 1,
      artifactBytes: 0,
    },
    recordedAt: NOW,
  })
}

describe('generation concept-review persistence', () => {
  it('accepts the concept and advances the run in one compare-and-set transaction', async () => {
    const context = await compiling('concept-review-atomic-accept')
    try {
      const input = review(context)
      expectOk(recordConceptCompilation(context))
      expectOk(context.database.conceptReviews.create(input))

      expectOk(
        context.database.generation.settleConcept({
          decision: 'accept',
          runId: context.run.id,
          expectedRunRevision: 1,
          expectedReviewRevision: 0,
          expectedConceptHash: input.conceptHash,
          at: LATER,
        }),
      )

      expect(expectOk(context.database.conceptReviews.get(input.id))).toMatchObject({
        status: 'confirmed',
        revision: 1,
        resolvedAt: LATER,
      })
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'generating',
        revision: 2,
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rolls back concept acceptance on a run fault and resumes from durable state after restart', async () => {
    const context = await compiling('concept-review-atomic-restart')
    const input = review(context)
    try {
      expectOk(recordConceptCompilation(context))
      expectOk(context.database.conceptReviews.create(input))
      const fault = new DatabaseSync(context.database.path)
      try {
        fault.exec(`CREATE TRIGGER fail_concept_settlement BEFORE UPDATE OF state
          ON generation_pipeline_runs BEGIN SELECT RAISE(ABORT,'forced concept fault'); END;`)
      } finally {
        fault.close()
      }
      expect(
        context.database.generation.settleConcept({
          decision: 'accept',
          runId: context.run.id,
          expectedRunRevision: 1,
          expectedReviewRevision: 0,
          expectedConceptHash: input.conceptHash,
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'database-error' } })
      expect(expectOk(context.database.conceptReviews.get(input.id))).toMatchObject({
        status: 'pending',
        revision: 0,
      })
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'compiling',
        revision: 1,
      })

      const repair = new DatabaseSync(context.database.path)
      try {
        repair.exec('DROP TRIGGER fail_concept_settlement')
      } finally {
        repair.close()
      }
      const restarted = createPersistence(context.database.path)
      try {
        expectOk(restarted.migrate())
        expectOk(
          restarted.generation.settleConcept({
            decision: 'accept',
            runId: context.run.id,
            expectedRunRevision: 1,
            expectedReviewRevision: 0,
            expectedConceptHash: input.conceptHash,
            at: LATER,
          }),
        )
        expect(expectOk(restarted.generation.get(context.run.id)).state).toBe('generating')
      } finally {
        restarted.close()
      }
    } finally {
      await context.cleanup()
    }
  })

  it('declines the review, settles the version, and cancels the run atomically', async () => {
    const context = await compiling('concept-review-atomic-decline')
    try {
      const input = review(context)
      expectOk(context.database.conceptReviews.create(input))
      expectOk(
        context.database.generation.settleConcept({
          decision: 'cancel',
          runId: context.run.id,
          expectedRunRevision: 1,
          expectedReviewRevision: 0,
          at: LATER,
        }),
      )
      expect(expectOk(context.database.conceptReviews.get(input.id)).status).toBe('cancelled')
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'cancelled',
        cancellationRequestedAt: LATER,
      })
      expect(expectOk(context.database.getVersion(context.versionId)).state).toBe('draft')
    } finally {
      await context.cleanup()
    }
  })

  it('creates, reads, and snapshots an owned concept checkpoint', async () => {
    const context = await compiling('concept-review-create')
    try {
      const input = review(context)
      expectOk(context.database.conceptReviews.create(input))
      expect(context.database.conceptReviews.get(input.id)).toEqual({ ok: true, value: input })
      expect(context.database.conceptReviews.forRun(context.run.id)).toEqual({
        ok: true,
        value: input,
      })
      expect(expectOk(context.database.conceptReviews.snapshot(context.run.id))).toMatchObject({
        review: input,
        run: { id: context.run.id, state: 'compiling' },
        version: { id: context.versionId, state: 'generating' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects cross-version ownership and concept hash mismatches', async () => {
    const first = await compiling('concept-review-owner-a')
    const second = await compiling('concept-review-owner-b')
    try {
      expect(
        first.database.conceptReviews.create({
          ...review(first),
          conceptSpecId: second.conceptSpecId,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(
        first.database.conceptReviews.create({
          ...review(first),
          conceptHash: `sha256:${'0'.repeat(64)}`,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    } finally {
      await first.cleanup()
      await second.cleanup()
    }
  })

  it('confirms and cancels pending checkpoints with revision and hash compare-and-set', async () => {
    const confirmed = await compiling('concept-review-confirm')
    const cancelled = await compiling('concept-review-cancel')
    const contender = createPersistence(confirmed.database.path)
    try {
      expectOk(contender.migrate())
      const first = review(confirmed)
      const second = review(cancelled)
      expectOk(confirmed.database.conceptReviews.create(first))
      expectOk(cancelled.database.conceptReviews.create(second))
      expect(
        contender.conceptReviews.confirm({
          id: first.id,
          expectedRevision: 0,
          expectedConceptHash: `sha256:${'0'.repeat(64)}`,
          resolvedAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expectOk(
        confirmed.database.conceptReviews.confirm({
          id: first.id,
          expectedRevision: 0,
          expectedConceptHash: first.conceptHash,
          resolvedAt: LATER,
        }),
      )
      expect(
        contender.conceptReviews.confirm({
          id: first.id,
          expectedRevision: 0,
          expectedConceptHash: first.conceptHash,
          resolvedAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expectOk(
        cancelled.database.conceptReviews.cancel({
          id: second.id,
          expectedRevision: 0,
          resolvedAt: LATER,
        }),
      )
      expect(expectOk(cancelled.database.conceptReviews.get(second.id))).toMatchObject({
        status: 'cancelled',
        revision: 1,
        resolvedAt: LATER,
      })
    } finally {
      contender.close()
      await confirmed.cleanup()
      await cancelled.cleanup()
    }
  })

  it('preserves only structurally valid pending review checkpoints during recovery', async () => {
    const valid = await compiling('concept-review-recovery-valid')
    const invalid = await compiling('concept-review-recovery-invalid')
    try {
      const validReview = review(valid)
      expectOk(valid.database.conceptReviews.create(validReview))

      const raw = new DatabaseSync(invalid.database.path)
      try {
        expectOk(invalid.database.conceptReviews.create(review(invalid)))
        raw
          .prepare("UPDATE generation_pipeline_runs SET state='generating' WHERE id=?")
          .run(invalid.run.id)
      } finally {
        raw.close()
      }

      expect(expectOk(valid.database.generation.recoverInterrupted({ at: LATER }))).toMatchObject({
        transitions: [],
      })
      expect(expectOk(valid.database.generation.get(valid.run.id))).toMatchObject({
        state: 'compiling',
        completedAt: null,
      })
      expect(expectOk(valid.database.getVersion(valid.versionId))).toMatchObject({
        state: 'generating',
      })

      expectOk(invalid.database.generation.recoverInterrupted({ at: LATER }))
      expect(expectOk(invalid.database.generation.get(invalid.run.id))).toMatchObject({
        state: 'invariant_failed',
        stableErrorId: 'orchestration.interrupted',
      })
      expect(expectOk(invalid.database.getVersion(invalid.versionId))).toMatchObject({
        state: 'draft',
      })
      expect(expectOk(invalid.database.conceptReviews.forRun(invalid.run.id))).toMatchObject({
        status: 'cancelled',
        revision: 1,
      })
    } finally {
      await valid.cleanup()
      await invalid.cleanup()
    }
  })

  it('does not preserve a cancelled checkpoint and leaves existing recovery behavior intact', async () => {
    const context = await compiling('concept-review-recovery-cancelled')
    try {
      const input = review(context)
      expectOk(context.database.conceptReviews.create(input))
      expectOk(
        context.database.conceptReviews.cancel({
          id: input.id,
          expectedRevision: 0,
          resolvedAt: LATER,
        }),
      )
      expectOk(context.database.generation.recoverInterrupted({ at: LATER }))
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'invariant_failed',
      })
      expect(expectOk(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'draft',
      })
    } finally {
      await context.cleanup()
    }
  })
})
