// LOC-EXEMPT: Durable-composition scenarios (startup, cancellation, invariant) share one cohesive coordinator fixture.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ArtifactStore, createPersistence } from '@simproof/persistence'
import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDurableGenerationComposition, createGenerationComposition } from './composition.js'
import type { GenerationSignals } from './pipeline-types.js'

const roots: string[] = []
const NOW = '2026-07-16T12:00:00.000Z'

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  )
})

describe('generation composition startup', () => {
  it('fails closed before provider dispatch when orphaned state cannot be cleaned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-composition-'))
    roots.push(root)
    const database = createPersistence(join(root, 'metadata.sqlite'))
    const provider = createScriptedFakeProvider(fakeProviderScenarios.correct)
    const compile = vi.spyOn(provider, 'compile')
    const disposeOrphanedState = vi.fn(() => Promise.resolve(false))
    const service = createGenerationComposition({
      database,
      store: new ArtifactStore(join(root, 'artifacts')),
      conceptCompiler: provider,
      codeGenerator: {
        descriptor: provider.descriptor,
        generateReservation: provider.generateReservation,
        repairReservation: provider.repairReservation,
        disposeThread: (threadId) => provider.disposeThread(threadId),
        disposeOrphanedState,
        generate: (request, options) => provider.generate(request, options),
        repair: (request, options) => provider.repair(request, options),
      },
      runner: {
        execute: vi.fn(() => Promise.reject(new TypeError('Runner must not execute.'))),
      },
      verifier: {
        verify: vi.fn(() => Promise.reject(new TypeError('Verifier must not execute.'))),
      },
      id: randomUUID,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    try {
      const result = await service.start({
        schemaVersion: '1',
        simulationVersionId: randomUUID(),
        idempotencyKey: 'composition:cleanup-failure',
        prompt: 'Build a pendulum simulation.',
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })

      expect(result).toMatchObject({ ok: false, error: { code: 'operation-failed' } })
      expect(disposeOrphanedState).toHaveBeenCalledWith([])
      expect(compile).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })

  it('wires a durable concept cancellation to one correlated persisted transition signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-durable-composition-'))
    roots.push(root)
    const database = createPersistence(join(root, 'metadata.sqlite'))
    const migrated = database.migrate()
    expect(migrated).toMatchObject({ ok: true })
    const simulationVersionId = randomUUID()
    const simulationId = randomUUID()
    expect(
      database.createSimulation({
        id: simulationId,
        title: 'Durable observability owner',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toMatchObject({ ok: true })
    expect(
      database.createDraftVersion({
        id: simulationVersionId,
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
    ).toMatchObject({ ok: true })
    const provider = createScriptedFakeProvider(fakeProviderScenarios.correct)
    const transition = vi.fn<GenerationSignals['transition']>()
    const withRun = vi.fn()
    const runWithContext: GenerationSignals['withRun'] = (runId, versionId, operation) => {
      withRun(runId, versionId, operation)
      return operation()
    }
    const observability: GenerationSignals = {
      withRun: runWithContext,
      withAttempt: (_runId, _attemptId, operation) => operation(),
      accepted: vi.fn(),
      transition,
      runFailed: vi.fn(),
      attemptStarted: vi.fn(),
      providerCompleted: vi.fn(),
      runnerCompleted: vi.fn(),
      verificationCompleted: vi.fn(),
      queueDepth: vi.fn(),
    }
    const coordinator = createDurableGenerationComposition({
      database,
      store: new ArtifactStore(join(root, 'artifacts')),
      conceptCompiler: provider,
      codeGenerator: provider,
      runner: { execute: vi.fn(() => Promise.reject(new TypeError('Runner must not execute.'))) },
      verifier: {
        verify: vi.fn(() => Promise.reject(new TypeError('Verifier must not execute.'))),
      },
      id: randomUUID,
      now: () => NOW,
      recordPromptDecision: vi.fn(),
      observability,
    })

    try {
      const started = await coordinator.start({
        schemaVersion: '1',
        simulationVersionId,
        expectedVersionRevision: 0,
        idempotencyKey: 'composition:durable:signal',
        teacher: {
          prompt: 'Build a pendulum simulation.',
          externalProviderDisclosureAccepted: true,
          promptRetention: 'discard',
        },
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })
      expect(started).toMatchObject({ ok: true })
      if (!started.ok) throw new TypeError('Expected generation acceptance.')
      let current = await coordinator.status(started.value.runId)
      for (
        let turn = 0;
        turn < 100 && current.ok && current.value.state !== 'awaiting_confirmation';
        turn += 1
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        current = await coordinator.status(started.value.runId)
      }
      expect(current).toMatchObject({
        ok: true,
        value: { state: 'awaiting_confirmation', conceptReview: { status: 'pending' } },
      })
      if (!current.ok || current.value.conceptReview.status !== 'pending') {
        throw new TypeError('Expected pending concept review.')
      }

      await coordinator.decide(started.value.runId, {
        decision: 'decline',
        conceptSpecHash: current.value.conceptReview.conceptSpecHash,
        expectedRunRevision: current.value.revision,
        expectedReviewRevision: current.value.conceptReview.reviewRevision,
      })

      expect(
        transition.mock.calls.filter(
          ([runId, from, to]) =>
            runId === started.value.runId && from === 'compiling' && to === 'cancelled',
        ),
      ).toHaveLength(1)
      expect(withRun).toHaveBeenCalledWith(
        started.value.runId,
        simulationVersionId,
        expect.any(Function),
      )
    } finally {
      await coordinator.close()
      database.close()
    }
  })

  it('settles a durable code-gen provider invariant without an uncaught persistence failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-durable-invariant-'))
    roots.push(root)
    const database = createPersistence(join(root, 'metadata.sqlite'))
    expect(database.migrate()).toMatchObject({ ok: true })
    const simulationVersionId = randomUUID()
    const simulationId = randomUUID()
    expect(
      database.createSimulation({
        id: simulationId,
        title: 'Durable invariant owner',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toMatchObject({ ok: true })
    expect(
      database.createDraftVersion({
        id: simulationVersionId,
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
    ).toMatchObject({ ok: true })
    const provider = createScriptedFakeProvider(fakeProviderScenarios.generateInvariant)
    const runFailed = vi.fn<GenerationSignals['runFailed']>()
    const observability: GenerationSignals = {
      withRun: (_runId, _versionId, operation) => operation(),
      withAttempt: (_runId, _attemptId, operation) => operation(),
      accepted: vi.fn(),
      transition: vi.fn(),
      runFailed,
      attemptStarted: vi.fn(),
      providerCompleted: vi.fn(),
      runnerCompleted: vi.fn(),
      verificationCompleted: vi.fn(),
      queueDepth: vi.fn(),
    }
    const coordinator = createDurableGenerationComposition({
      database,
      store: new ArtifactStore(join(root, 'artifacts')),
      conceptCompiler: provider,
      codeGenerator: provider,
      runner: { execute: vi.fn(() => Promise.reject(new TypeError('Runner must not execute.'))) },
      verifier: {
        verify: vi.fn(() => Promise.reject(new TypeError('Verifier must not execute.'))),
      },
      id: randomUUID,
      now: () => NOW,
      recordPromptDecision: vi.fn(),
      observability,
    })
    try {
      const started = await coordinator.start({
        schemaVersion: '1',
        simulationVersionId,
        expectedVersionRevision: 0,
        idempotencyKey: 'composition:durable:invariant',
        teacher: {
          prompt: 'Build a pendulum simulation.',
          externalProviderDisclosureAccepted: true,
          promptRetention: 'discard',
        },
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })
      expect(started).toMatchObject({ ok: true })
      if (!started.ok) throw new TypeError('Expected generation acceptance.')
      let current = await coordinator.status(started.value.runId)
      for (
        let turn = 0;
        turn < 100 && current.ok && current.value.state !== 'awaiting_confirmation';
        turn += 1
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        current = await coordinator.status(started.value.runId)
      }
      if (!current.ok || current.value.conceptReview.status !== 'pending') {
        throw new TypeError('Expected pending concept review.')
      }
      await coordinator.decide(started.value.runId, {
        decision: 'accept',
        conceptSpecHash: current.value.conceptReview.conceptSpecHash,
        expectedRunRevision: current.value.revision,
        expectedReviewRevision: current.value.conceptReview.reviewRevision,
      })
      let terminal = await coordinator.status(started.value.runId)
      for (
        let turn = 0;
        turn < 200 &&
        terminal.ok &&
        !['invariant_failed', 'provider_failed', 'rejected', 'verified'].includes(
          terminal.value.state,
        );
        turn += 1
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        terminal = await coordinator.status(started.value.runId)
      }
      expect(terminal).toMatchObject({ ok: true, value: { state: 'invariant_failed' } })
      // The provider invariant must settle as a clean invariant_failed, recorded
      // through the pipeline, not via an uncaught persistence error routed through
      // the fail-closed catch-all (which would signal runFailed).
      expect(runFailed).not.toHaveBeenCalled()
    } finally {
      await coordinator.close()
      database.close()
    }
  })
})
