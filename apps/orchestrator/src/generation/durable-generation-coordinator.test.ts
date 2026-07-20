import type {
  EducatorGenerationStartRequest,
  GenerationState,
  GenerationStatus,
} from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  DurableGenerationCoordinator,
  type GenerationCheckpointPort,
} from './durable-generation-coordinator.js'
import type { ConceptCheckpoint, SplitGenerationPipeline } from './pipeline.js'
import type { GenerationSignals, PipelineRun } from './pipeline-types.js'

const RUN_ID = '223e4567-e89b-42d3-a456-426614174000'
const VERSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NOW = '2026-07-16T12:00:00.000Z'

const request: EducatorGenerationStartRequest = {
  schemaVersion: '1',
  simulationVersionId: VERSION_ID,
  expectedVersionRevision: 0,
  idempotencyKey: 'generation:durable:test',
  teacher: {
    prompt: 'Build a pendulum.',
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
}

const run = (state: GenerationState = 'queued'): PipelineRun => ({
  id: RUN_ID,
  state,
  revision: state === 'queued' ? 0 : 2,
  maxAttempts: 3,
  attemptCount: 0,
  budget: {
    limits: request.budget,
    consumed: {
      providerRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicrousd: 0,
      artifactBytes: 0,
    },
  },
})

const status = (state: GenerationStatus['state'] = 'queued'): GenerationStatus => ({
  runId: RUN_ID,
  simulationVersionId: VERSION_ID,
  state,
  revision: state === 'queued' ? 0 : 2,
  maxAttempts: 3,
  budget: run().budget,
  conceptReview: { status: 'not-ready' },
  cancellationRequestedAt: null,
  error: null,
  attempts: [],
  transitions: [{ sequence: 0, from: null, to: state, occurredAt: NOW }],
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
})

const flushDeferred = async () =>
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

function signalRecorder() {
  const transition = vi.fn<GenerationSignals['transition']>()
  const withRun = vi.fn()
  const runWithContext: GenerationSignals['withRun'] = (runId, simulationId, operation) => {
    withRun(runId, simulationId, operation)
    return operation()
  }
  const signals: GenerationSignals = {
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
  return { signals, transition, withRun }
}

function fixture(created = true, signals?: GenerationSignals) {
  const events: string[] = []
  const checkpoint: ConceptCheckpoint = {
    run: run('compiling'),
    conceptSpec: {
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
      },
      requestedControls: ['length', 'amplitude'],
    },
    recorded: { id: '323e4567-e89b-42d3-a456-426614174000', hash: HASH },
  }
  const pipeline: SplitGenerationPipeline = {
    accept: vi.fn((input) => {
      events.push('accept')
      return Promise.resolve({ run: run(), created, request: input as never })
    }),
    compileAccepted: vi.fn(() => {
      events.push('compile')
      return Promise.resolve(checkpoint)
    }),
    continueConfirmed: vi.fn(() => {
      events.push('generate')
      return Promise.resolve(run('verified'))
    }),
  }
  const checkpoints: GenerationCheckpointPort = {
    create: vi.fn(() => {
      events.push('review')
      return { ok: true as const, value: {} }
    }),
    confirmed: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          run: run('generating'),
          conceptSpec: checkpoint.conceptSpec,
          simulationVersionId: VERSION_ID,
          transition: { from: 'compiling' as const, to: 'generating' as const },
        },
      }),
    ),
    cancel: vi.fn(() => ({
      ok: true as const,
      value: {
        cancellationRequestedAt: NOW,
        updatedAt: NOW,
        simulationVersionId: VERSION_ID,
        transition: { from: 'compiling' as const, to: 'cancelled' as const },
      },
    })),
    failInvariant: vi.fn(() => ({ ok: true as const, value: undefined })),
    status: vi.fn(() => Promise.resolve({ ok: true as const, value: status('compiling') })),
  }
  const coordinator = new DurableGenerationCoordinator({
    pipeline,
    checkpoints,
    recordPromptDecision: () => {
      events.push('retention')
    },
    ...(signals === undefined ? {} : { signals }),
  })
  return { checkpoints, coordinator, events, pipeline }
}

describe('DurableGenerationCoordinator', () => {
  it('returns the durable handle before deferred compilation and stops at concept review', async () => {
    const context = fixture()

    await expect(context.coordinator.start(request)).resolves.toEqual({
      ok: true,
      value: { runId: RUN_ID, created: true, state: 'queued', revision: 0 },
    })
    expect(context.events).toEqual(['accept', 'retention'])

    await flushDeferred()
    expect(context.events).toEqual(['accept', 'retention', 'compile', 'review'])
    expect(context.pipeline.continueConfirmed).not.toHaveBeenCalled()
  })

  it('does not redispatch an idempotent replay', async () => {
    const context = fixture(false)
    vi.mocked(context.checkpoints.status).mockResolvedValue({
      ok: true,
      value: status('awaiting_confirmation'),
    })

    await expect(context.coordinator.start(request)).resolves.toEqual({
      ok: true,
      value: { runId: RUN_ID, created: false, state: 'awaiting_confirmation', revision: 2 },
    })
    await flushDeferred()
    expect(context.events).toEqual(['accept'])
  })

  it('resumes only after exact confirmation and supports decline and cancellation CAS', async () => {
    const context = fixture()
    await context.coordinator.start(request)
    await flushDeferred()

    await context.coordinator.decide(RUN_ID, {
      decision: 'accept',
      conceptSpecHash: HASH,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })
    expect(context.checkpoints.confirmed).toHaveBeenCalledWith({
      runId: RUN_ID,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
      expectedConceptHash: HASH,
    })
    await flushDeferred()
    expect(context.events).toContain('generate')

    await context.coordinator.decide(RUN_ID, {
      decision: 'decline',
      conceptSpecHash: HASH,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })
    expect(context.checkpoints.cancel).toHaveBeenCalledWith({
      runId: RUN_ID,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })
    await context.coordinator.cancel(RUN_ID, 3)
    expect(context.checkpoints.cancel).toHaveBeenLastCalledWith({
      runId: RUN_ID,
      expectedRunRevision: 3,
    })
  })

  it('emits each confirmed and declined durable transition once after checkpoint success', async () => {
    const observed = signalRecorder()
    const context = fixture(true, observed.signals)

    await context.coordinator.decide(RUN_ID, {
      decision: 'accept',
      conceptSpecHash: HASH,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })
    await flushDeferred()

    expect(observed.transition).toHaveBeenCalledTimes(1)
    expect(observed.transition).toHaveBeenCalledWith(RUN_ID, 'compiling', 'generating')
    expect(observed.withRun).toHaveBeenCalledWith(RUN_ID, VERSION_ID, expect.any(Function))
    expect(context.pipeline.continueConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'generating' }),
      expect.any(Object),
      expect.any(AbortSignal),
    )

    vi.mocked(context.checkpoints.cancel).mockReturnValueOnce({
      ok: true,
      value: {
        cancellationRequestedAt: NOW,
        updatedAt: NOW,
        simulationVersionId: VERSION_ID,
        transition: { from: 'compiling', to: 'cancelled' },
      },
    })
    await context.coordinator.decide(RUN_ID, {
      decision: 'decline',
      conceptSpecHash: HASH,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })

    expect(observed.transition).toHaveBeenCalledTimes(2)
    expect(observed.transition).toHaveBeenLastCalledWith(RUN_ID, 'compiling', 'cancelled')
  })

  it('emits no transition when durable confirmation or cancellation fails', async () => {
    const observed = signalRecorder()
    const context = fixture(true, observed.signals)
    vi.mocked(context.checkpoints.confirmed).mockResolvedValueOnce({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })

    await context.coordinator.decide(RUN_ID, {
      decision: 'accept',
      conceptSpecHash: HASH,
      expectedRunRevision: 2,
      expectedReviewRevision: 0,
    })
    vi.mocked(context.checkpoints.cancel).mockReturnValueOnce({
      ok: false,
      error: { code: 'conflict', message: 'Injected conflict.' },
    })
    await context.coordinator.cancel(RUN_ID, 2)

    expect(observed.transition).not.toHaveBeenCalled()
    expect(context.pipeline.continueConfirmed).not.toHaveBeenCalled()
  })

  it('fails closed without dispatch when prompt-retention recording fails', async () => {
    const context = fixture()
    const coordinator = new DurableGenerationCoordinator({
      pipeline: context.pipeline,
      checkpoints: context.checkpoints,
      recordPromptDecision: () => {
        throw new Error('private prompt')
      },
    })

    await expect(coordinator.start(request)).resolves.toEqual({
      ok: false,
      error: { code: 'operation-failed', message: 'Generation could not be accepted.' },
    })
    expect(context.checkpoints.failInvariant).toHaveBeenCalledWith(RUN_ID)
    expect(context.pipeline.compileAccepted).not.toHaveBeenCalled()
  })

  it('emits one durable invariant transition while failures and terminal no-ops emit none', async () => {
    const observed = signalRecorder()
    const context = fixture(true, observed.signals)
    vi.mocked(context.checkpoints.failInvariant).mockReturnValueOnce({
      ok: true,
      value: {
        simulationVersionId: VERSION_ID,
        transition: { from: 'queued', to: 'invariant_failed' },
      },
    })
    const coordinator = new DurableGenerationCoordinator({
      pipeline: context.pipeline,
      checkpoints: context.checkpoints,
      signals: observed.signals,
      recordPromptDecision: () => {
        throw new Error('private prompt')
      },
    })

    await coordinator.start(request)
    expect(observed.transition).toHaveBeenCalledOnce()
    expect(observed.transition).toHaveBeenCalledWith(RUN_ID, 'queued', 'invariant_failed')
    expect(observed.withRun).toHaveBeenCalledWith(RUN_ID, VERSION_ID, expect.any(Function))

    vi.mocked(context.checkpoints.failInvariant)
      .mockReturnValueOnce({ ok: true, value: undefined })
      .mockReturnValueOnce({
        ok: false,
        error: { code: 'conflict', message: 'Injected conflict.' },
      })
    await coordinator.start(request)
    await coordinator.start(request)
    expect(observed.transition).toHaveBeenCalledOnce()
  })
})
