// LOC-EXEMPT: Reservation accounting and every interrupted-state recovery case share one durable database fixture.
import { DatabaseSync } from 'node:sqlite'

import { generationBudgetSchema } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

async function draft(name: string, budget = 100) {
  const context = await fixture(name)
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.createSimulation({
      id: simulationId,
      title: 'Reservation fixture',
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
  const run = expectOk(
    context.database.beginOrReplayGeneration({
      versionId,
      expectedRevision: 0,
      idempotencyKey: `reservation-${name}`,
      updatedAt: NOW,
      run: { id: id(), maxAttempts: 3, codexSessionId: null, createdAt: NOW },
      budgets: {
        providerRequests: budget,
        inputTokens: budget,
        outputTokens: budget,
        costMicrousd: budget,
        artifactBytes: budget,
      },
    }),
  ).run
  return { ...context, versionId, run }
}

function reservation(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: id(),
    runId,
    attemptId: null,
    operation: 'concept_compile' as const,
    provider: 'fake',
    modelId: 'fake-concept-v1',
    templateVersion: 'concept.v1',
    reservedUsage: {
      providerRequests: 1,
      inputTokens: 40,
      outputTokens: 30,
      costMicrousd: 20,
      artifactBytes: 0,
    },
    createdAt: NOW,
    ...overrides,
  }
}

function call(
  reservationInput: ReturnType<typeof reservation>,
  usage: {
    providerRequests: number
    inputTokens: number
    outputTokens: number
    costMicrousd: number
    artifactBytes: number
  },
) {
  return {
    id: id(),
    runId: reservationInput.runId,
    attemptId: reservationInput.attemptId,
    operation: reservationInput.operation,
    provider: reservationInput.provider,
    modelId: reservationInput.modelId,
    templateVersion: reservationInput.templateVersion,
    providerRequestId: `request-${reservationInput.id}`,
    codexThreadId: null,
    stableErrorId: null,
    usage,
    recordedAt: LATER,
  }
}

describe('durable provider reservations and recovery', () => {
  it('atomically reserves every provider dimension and replays the exact local identity', async () => {
    const context = await draft('reserve-replay')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      const input = reservation(context.run.id)
      const first = expectOk(context.database.generation.reserveExternalCall(input))
      const replay = expectOk(context.database.generation.reserveExternalCall(input))
      expect(replay).toEqual(first)
      expect(first.run.usage).toMatchObject(input.reservedUsage)
      expect(first.reservation).toMatchObject({ status: 'pending', ...input })
      expect(
        context.database.generation.reserveExternalCall({ ...input, modelId: 'other-model' }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(
        expectOk(context.database.generation.externalCallReservations(context.run.id)),
      ).toEqual([expect.objectContaining({ id: input.id, status: 'pending' })])
    } finally {
      await context.cleanup()
    }
  })

  it.each([
    ['inputTokens', 101],
    ['outputTokens', 101],
    ['costMicrousd', 101],
  ] as const)(
    'rejects a reservation when %s has insufficient remaining budget',
    async (key, value) => {
      const context = await draft(`reserve-budget-${key}`)
      try {
        expectOk(
          context.database.generation.transition({
            runId: context.run.id,
            expectedRevision: 0,
            to: 'compiling',
            at: NOW,
          }),
        )
        const input = reservation(context.run.id, {
          reservedUsage: { ...reservation(context.run.id).reservedUsage, [key]: value },
        })
        expect(context.database.generation.reserveExternalCall(input)).toMatchObject({
          ok: false,
          error: { code: 'invalid-state' },
        })
        expect(
          expectOk(context.database.generation.externalCallReservations(context.run.id)),
        ).toEqual([])
        expect(expectOk(context.database.generation.get(context.run.id)).usage).toEqual({
          providerRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          costMicrousd: 0,
          artifactBytes: 0,
        })
      } finally {
        await context.cleanup()
      }
    },
  )

  it('rejects a reservation when no provider request remains', async () => {
    const context = await draft('reserve-budget-provider')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      const raw = new DatabaseSync(context.database.path)
      try {
        raw
          .prepare('UPDATE generation_pipeline_runs SET max_provider_requests=1 WHERE id=?')
          .run(context.run.id)
      } finally {
        raw.close()
      }
      expectOk(
        context.database.generation.recordExternalCall({
          ...call(reservation(context.run.id), {
            providerRequests: 1,
            inputTokens: 0,
            outputTokens: 0,
            costMicrousd: 0,
            artifactBytes: 0,
          }),
          stableErrorId: 'provider.authentication-failed',
          providerRequestId: null,
        }),
      )
      expect(
        context.database.generation.reserveExternalCall(reservation(context.run.id)),
      ).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects a code reservation when generated-byte budget is insufficient', async () => {
    const context = await draft('reserve-budget-artifact')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      const concept = reservation(context.run.id)
      expectOk(
        context.database.generation.recordExternalCall(
          call(concept, {
            providerRequests: 1,
            inputTokens: 0,
            outputTokens: 0,
            costMicrousd: 0,
            artifactBytes: 0,
          }),
        ),
      )
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      )
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: context.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-code-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expect(
        context.database.generation.reserveExternalCall(
          reservation(context.run.id, {
            attemptId: attempt.id,
            operation: 'code_generate',
            modelId: 'fake-code-v1',
            templateVersion: 'generation.v1',
            reservedUsage: {
              providerRequests: 1,
              inputTokens: 1,
              outputTokens: 1,
              costMicrousd: 1,
              artifactBytes: 101,
            },
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    } finally {
      await context.cleanup()
    }
  })

  it('reconciles to actual usage, releases unused reservation, and retains overages', async () => {
    const context = await draft('reserve-reconcile')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      const smaller = reservation(context.run.id)
      expectOk(context.database.generation.reserveExternalCall(smaller))
      const smallerCall = call(smaller, {
        providerRequests: 1,
        inputTokens: 10,
        outputTokens: 5,
        costMicrousd: 8,
        artifactBytes: 7,
      })
      const reconciled = expectOk(
        context.database.generation.reconcileExternalCall({
          reservationId: smaller.id,
          call: smallerCall,
          reconciledAt: LATER,
        }),
      )
      expect(reconciled.run.usage).toEqual(smallerCall.usage)
      expect(reconciled.reservation).toMatchObject({
        status: 'reconciled',
        externalCallId: smallerCall.id,
        reconciledAt: LATER,
      })
      expectOk(
        context.database.generation.reconcileExternalCall({
          reservationId: smaller.id,
          call: smallerCall,
          reconciledAt: LATER,
        }),
      )

      const second = await draft('reserve-overage', 50)
      try {
        expectOk(
          second.database.generation.transition({
            runId: second.run.id,
            expectedRevision: 0,
            to: 'compiling',
            at: NOW,
          }),
        )
        const over = reservation(second.run.id)
        expectOk(second.database.generation.reserveExternalCall(over))
        const overCall = call(over, {
          providerRequests: 1,
          inputTokens: 80,
          outputTokens: 60,
          costMicrousd: 70,
          artifactBytes: 55,
        })
        const actual = expectOk(
          second.database.generation.reconcileExternalCall({
            reservationId: over.id,
            call: overCall,
            reconciledAt: LATER,
          }),
        )
        expect(actual.run.usage).toEqual({
          providerRequests: 1,
          inputTokens: 50,
          outputTokens: 50,
          costMicrousd: 50,
          artifactBytes: 50,
        })
        expect(
          generationBudgetSchema.safeParse({
            limits: {
              maxProviderRequests: 20,
              maxInputTokens: 50,
              maxOutputTokens: 50,
              maxCostMicrousd: 50,
              maxArtifactBytes: 50,
            },
            consumed: actual.run.usage,
          }).success,
        ).toBe(true)
        expect(expectOk(second.database.generation.externalCalls(second.run.id))).toEqual([
          expect.objectContaining({ id: overCall.id, usage: overCall.usage }),
        ])
      } finally {
        await second.cleanup()
      }
    } finally {
      await context.cleanup()
    }
  })

  it('idempotently releases a reservation proven not to have dispatched', async () => {
    const context = await draft('reserve-not-dispatched')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      const input = reservation(context.run.id)
      expectOk(context.database.generation.reserveExternalCall(input))
      const released = expectOk(
        context.database.generation.releaseExternalCallReservation(input.id, LATER),
      )
      expect(released.reservation).toMatchObject({
        id: input.id,
        status: 'not_dispatched',
        externalCallId: null,
        reconciledAt: LATER,
      })
      expect(released.run.usage).toEqual({
        providerRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicrousd: 0,
        artifactBytes: 0,
      })
      expect(
        expectOk(context.database.generation.releaseExternalCallReservation(input.id, LATER)),
      ).toEqual(released)
      expect(expectOk(context.database.generation.externalCalls(context.run.id))).toEqual([])
    } finally {
      await context.cleanup()
    }
  })

  it('requires reconciled successful evidence before provider-dependent transitions', async () => {
    const context = await draft('transition-evidence')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      expect(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      const concept = reservation(context.run.id)
      expectOk(context.database.generation.reserveExternalCall(concept))
      expect(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expectOk(
        context.database.generation.reconcileExternalCall({
          reservationId: concept.id,
          call: call(concept, {
            providerRequests: 1,
            inputTokens: 10,
            outputTokens: 5,
            costMicrousd: 8,
            artifactBytes: 0,
          }),
          reconciledAt: LATER,
        }),
      )
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 1,
          to: 'generating',
          at: LATER,
        }),
      )
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: context.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-code-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expect(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 2,
          to: 'executing',
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      const code = reservation(context.run.id, {
        attemptId: attempt.id,
        operation: 'code_generate',
        modelId: 'fake-code-v1',
        templateVersion: 'generation.v1',
        reservedUsage: {
          providerRequests: 1,
          inputTokens: 40,
          outputTokens: 30,
          costMicrousd: 20,
          artifactBytes: 25,
        },
      })
      expectOk(context.database.generation.reserveExternalCall(code))
      expectOk(
        context.database.generation.reconcileExternalCall({
          reservationId: code.id,
          call: {
            ...call(code, {
              providerRequests: 1,
              inputTokens: 1,
              outputTokens: 1,
              costMicrousd: 1,
              artifactBytes: 1,
            }),
            codexThreadId: 'thread-1',
          },
          reconciledAt: LATER,
        }),
      )
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 2,
          to: 'executing',
          at: LATER,
        }),
      )
    } finally {
      await context.cleanup()
    }
  })

  it('recovers every active state atomically after reopening and preserves pending charges', async () => {
    const context = await draft('recover-active-states')
    const states = [
      'queued',
      'compiling',
      'generating',
      'executing',
      'verifying',
      'repairing',
    ] as const
    const runs: Array<{
      runId: string
      versionId: string
      state: (typeof states)[number]
    }> = [{ runId: context.run.id, versionId: context.versionId, state: 'queued' }]
    try {
      for (const state of states.slice(1)) {
        const simulationId = id()
        const versionId = id()
        expectOk(
          context.database.createSimulation({
            id: simulationId,
            title: state,
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
        const run = expectOk(
          context.database.beginOrReplayGeneration({
            ...{
              versionId,
              expectedRevision: 0,
              idempotencyKey: `recovery-${state}`,
              updatedAt: NOW,
              run: { id: id(), maxAttempts: 3, codexSessionId: null, createdAt: NOW },
              budgets: context.run.budgets,
            },
          }),
        ).run
        runs.push({ runId: run.id, versionId, state })
      }
      const raw = new DatabaseSync(context.database.path)
      try {
        for (const entry of runs.filter(({ state }) => state !== 'queued')) {
          raw
            .prepare('UPDATE generation_pipeline_runs SET state=?,revision=1 WHERE id=?')
            .run(entry.state, entry.runId)
          raw
            .prepare(
              "INSERT INTO generation_pipeline_transitions(run_id,sequence,from_state,to_state,transitioned_at) VALUES (?,1,'queued',?,?)",
            )
            .run(entry.runId, entry.state, NOW)
        }
        raw
          .prepare("UPDATE simulation_versions SET active_artifact_bundle_json='{}' WHERE id=?")
          .run(context.versionId)
      } finally {
        raw.close()
      }
      const generating = runs.find(({ state }) => state === 'generating')!
      const interruptedAttempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: generating.runId,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-code-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      const held = reservation(generating.runId, {
        attemptId: interruptedAttempt.id,
        operation: 'code_generate',
        modelId: 'fake-code-v1',
        templateVersion: 'generation.v1',
        reservedUsage: {
          providerRequests: 1,
          inputTokens: 40,
          outputTokens: 30,
          costMicrousd: 20,
          artifactBytes: 25,
        },
      })
      expectOk(context.database.generation.reserveExternalCall(held))

      const reopened = createPersistence(context.database.path)
      try {
        expectOk(reopened.migrate())
        const recovered = expectOk(reopened.generation.recoverInterrupted({ at: LATER }))
        expect(new Set(recovered.runIds)).toEqual(new Set(runs.map(({ runId }) => runId)))
        expect(new Set(recovered.transitions.map(({ runId }) => runId))).toEqual(
          new Set(runs.map(({ runId }) => runId)),
        )
        expect(recovered.transitions).toEqual(
          expect.arrayContaining(
            runs.map(({ runId, versionId, state }) => ({
              runId,
              simulationVersionId: versionId,
              from: state,
              to: 'invariant_failed',
            })),
          ),
        )
        for (const { runId, versionId } of runs) {
          expect(expectOk(reopened.generation.get(runId))).toMatchObject({
            state: 'invariant_failed',
            terminalClassification: 'invariant_failure',
            stableErrorId: 'orchestration.interrupted',
          })
          expect(expectOk(reopened.getVersion(versionId))).toMatchObject({
            state: 'draft',
            activeConceptSpecId: null,
            activeGeneratedArtifactId: null,
            activeArtifactBundle: null,
            activeVerificationRunId: null,
          })
        }
        expect(expectOk(reopened.generation.get(generating.runId)).usage).toMatchObject(
          held.reservedUsage,
        )
        expect(expectOk(reopened.generation.attempts(generating.runId))).toEqual([
          expect.objectContaining({
            id: interruptedAttempt.id,
            outcome: 'invariant_failed',
            stableErrorId: 'orchestration.interrupted',
          }),
        ])
        expect(
          expectOk(reopened.generation.externalCallReservations(generating.runId))[0],
        ).toMatchObject({
          id: held.id,
          status: 'pending',
        })
        expect(expectOk(reopened.generation.recoverInterrupted({ at: LATER }))).toEqual({
          runIds: [],
          transitions: [],
        })
      } finally {
        reopened.close()
      }
    } finally {
      await context.cleanup()
    }
  })
})
