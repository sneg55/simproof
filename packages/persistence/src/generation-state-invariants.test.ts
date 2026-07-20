import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import type { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

async function createDraft(name: string) {
  const context = await fixture(name)
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.createSimulation({
      id: simulationId,
      title: 'State invariant fixture',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  expectOk(
    context.database.createDraftVersion({
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
    }),
  )
  return { ...context, versionId }
}

function request(versionId: string, key: string) {
  return {
    versionId,
    expectedRevision: 0,
    idempotencyKey: key,
    updatedAt: NOW,
    run: { id: id(), maxAttempts: 3, codexSessionId: null, createdAt: NOW },
    budgets: {
      providerRequests: 8,
      inputTokens: 10_000,
      outputTokens: 5_000,
      costMicrousd: 100_000,
      artifactBytes: 1_000_000,
    },
  }
}

function startAttempt(runId: string, attemptNumber: number) {
  return {
    id: id(),
    runId,
    attemptNumber,
    provider: 'fake',
    modelId: 'fake-coder-v1',
    templateVersion: attemptNumber === 1 ? 'generation.v1' : 'repair.v1',
    createdAt: NOW,
  }
}

function externalCall(
  runId: string,
  attemptId: string | null,
  operation: 'concept_compile' | 'code_generate' | 'code_repair',
  providerRequestId: string,
) {
  return {
    id: id(),
    runId,
    attemptId,
    operation,
    provider: 'fake',
    modelId: operation === 'concept_compile' ? 'fake-concept-v1' : 'fake-coder-v1',
    templateVersion: operation === 'code_repair' ? 'repair.v1' : 'generation.v1',
    providerRequestId,
    codexThreadId: null,
    stableErrorId: null,
    usage: {
      providerRequests: 1,
      inputTokens: 10,
      outputTokens: 10,
      costMicrousd: 10,
      artifactBytes: 10,
    },
    recordedAt: LATER,
  }
}

function completeCancelled(database: ReturnType<typeof createPersistence>, attemptId: string) {
  return database.generation.completeAttempt({
    id: attemptId,
    outcome: 'cancelled',
    providerRequestId: null,
    codexThreadId: null,
    artifactHash: null,
    generatedArtifactId: null,
    verificationRunId: null,
    findingsReference: null,
    completedAt: LATER,
  })
}

describe('generation repository state invariants', () => {
  it('starts attempts only in generating or repairing and only after the prior attempt is terminal', async () => {
    const context = await createDraft('generation-attempt-state')
    try {
      const run = expectOk(
        context.database.beginOrReplayGeneration(request(context.versionId, 'attempt-state-key')),
      ).run
      expect(context.database.generation.startAttempt(startAttempt(run.id, 1))).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      expectOk(
        context.database.generation.transition({
          runId: run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: LATER,
        }),
      )
      expectOk(
        context.database.generation.recordExternalCall(
          externalCall(run.id, null, 'concept_compile', 'attempt_state_concept'),
        ),
      )
      expect(context.database.generation.startAttempt(startAttempt(run.id, 1))).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      expectOk(
        context.database.generation.transition({
          runId: run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      )
      const first = expectOk(context.database.generation.startAttempt(startAttempt(run.id, 1)))
      expect(context.database.generation.startAttempt(startAttempt(run.id, 2))).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      expectOk(
        context.database.generation.recordExternalCall(
          externalCall(run.id, first.id, 'code_generate', 'attempt_state_code'),
        ),
      )
      for (const [expectedRevision, to] of [
        [2, 'executing'],
        [3, 'verifying'],
      ] as const) {
        expectOk(
          context.database.generation.transition({
            runId: run.id,
            expectedRevision,
            to,
            at: LATER,
          }),
        )
      }
      expectOk(completeCancelled(context.database, first.id))
      expect(context.database.generation.startAttempt(startAttempt(run.id, 2))).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      const raw = new DatabaseSync(context.database.path)
      try {
        raw
          .prepare("UPDATE generation_pipeline_runs SET state='repairing',revision=5 WHERE id=?")
          .run(run.id)
        raw
          .prepare(`INSERT INTO generation_pipeline_transitions(
          run_id,sequence,from_state,to_state,transitioned_at
        ) VALUES (?,5,'verifying','repairing',?)`)
          .run(run.id, LATER)
      } finally {
        raw.close()
      }
      const second = expectOk(context.database.generation.startAttempt(startAttempt(run.id, 2)))
      expect(
        context.database.generation.recordExternalCall(
          externalCall(run.id, first.id, 'code_repair', 'stale_attempt_request'),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(second.outcome).toBe('pending')
    } finally {
      await context.cleanup()
    }
  })

  it('binds each external operation to its exact state and current pending attempt', async () => {
    const context = await createDraft('generation-call-state')
    try {
      const run = expectOk(
        context.database.beginOrReplayGeneration(request(context.versionId, 'call-state-key')),
      ).run
      expect(
        context.database.generation.recordExternalCall(
          externalCall(run.id, null, 'concept_compile', 'same_fake_request'),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expectOk(
        context.database.generation.transition({
          runId: run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: LATER,
        }),
      )
      expectOk(
        context.database.generation.recordExternalCall(
          externalCall(run.id, null, 'concept_compile', 'same_fake_request'),
        ),
      )
      expect(
        context.database.generation.recordExternalCall(
          externalCall(run.id, null, 'concept_compile', 'second_concept_success'),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expectOk(
        context.database.generation.transition({
          runId: run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      )
      const first = expectOk(context.database.generation.startAttempt(startAttempt(run.id, 1)))
      expect(
        context.database.generation.recordExternalCall(
          externalCall(run.id, first.id, 'code_repair', 'wrong_operation'),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expectOk(
        context.database.generation.recordExternalCall(
          externalCall(run.id, first.id, 'code_generate', 'code_request'),
        ),
      )
      expectOk(completeCancelled(context.database, first.id))
      expect(
        context.database.generation.recordExternalCall(
          externalCall(run.id, first.id, 'code_generate', 'completed_attempt'),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    } finally {
      await context.cleanup()
    }
  })

  it('scopes deterministic provider request IDs to one durable run', async () => {
    const context = await createDraft('generation-request-scope')
    try {
      const secondSimulationId = id()
      const secondVersionId = id()
      expectOk(
        context.database.createSimulation({
          id: secondSimulationId,
          title: 'Second deterministic request owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.createDraftVersion({
          id: secondVersionId,
          simulationId: secondSimulationId,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      for (const [versionId, key] of [
        [context.versionId, 'request-scope-first'],
        [secondVersionId, 'request-scope-second'],
      ] as const) {
        const run = expectOk(context.database.beginOrReplayGeneration(request(versionId, key))).run
        expectOk(
          context.database.generation.transition({
            runId: run.id,
            expectedRevision: 0,
            to: 'compiling',
            at: LATER,
          }),
        )
        expectOk(
          context.database.generation.recordExternalCall(
            externalCall(run.id, null, 'concept_compile', 'deterministic_fake_request'),
          ),
        )
      }
    } finally {
      await context.cleanup()
    }
  })
})
