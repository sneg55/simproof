// LOC-EXEMPT: The complete pipeline state, budget, cancellation, and provider-failure matrix is audited together.
import type {
  ConceptSpec,
  GenerationRequest,
  GenerationState,
  ProviderProvenance,
  RunnerDiagnostic,
  VerificationFinding,
} from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import { chargeArtifactBytes, chargeProviderTurn } from './budget.js'
import {
  createGenerationPipeline,
  type GenerationJournal,
  type PipelineDependencies,
  type PipelineRun,
  type PipelineRunner,
  type PipelineVerifier,
  type ProviderDescriptor,
} from './pipeline.js'
import type { GenerationSignals } from './pipeline-types.js'

const HASH_A = `sha256:${'a'.repeat(64)}` as const
const HASH_B = `sha256:${'b'.repeat(64)}` as const
const NOW = '2026-07-16T12:00:00.000Z'
const reservation = Object.freeze({
  requestCount: 1 as const,
  inputTokens: 10,
  outputTokens: 20,
  costMicrousd: 100,
})

const request = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  schemaVersion: '1',
  simulationVersionId: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey: 'generation:test:one',
  prompt: 'Build a pendulum simulation.',
  maxAttempts: 3,
  budget: {
    maxProviderRequests: 6,
    maxInputTokens: 1_000,
    maxOutputTokens: 1_000,
    maxArtifactBytes: 100_000,
    maxCostMicrousd: 10_000,
  },
  ...overrides,
})

const concept: ConceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Simple pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
}

const usage = (requestId: string, provider: 'fake' | 'codex-sdk'): ProviderProvenance => ({
  provider,
  model: provider === 'fake' ? 'fake-v1' : 'codex-v1',
  templateVersion: '1.0.0',
  requestIds: [requestId],
  threadId: provider === 'codex-sdk' ? 'thread-1' : null,
  usage: {
    requestCount: 1,
    inputTokens: 10,
    outputTokens: 20,
    costMicrousd: 100,
  },
})

const cancelledProviderResult = (provider: 'fake' | 'codex-sdk') => ({
  ok: false as const,
  kind: 'cancellation' as const,
  error: {
    category: 'cancellation' as const,
    stableErrorId: 'generation.cancelled' as const,
    retryable: false,
  },
  metering: {
    provider,
    model: provider === 'fake' ? 'fake-v1' : 'codex-v1',
    templateVersion: '1.0.0',
    requestIds: [`${provider}-cancelled`],
    usage: {
      requestCount: 1,
      inputTokens: 1,
      outputTokens: 0,
      costMicrousd: 1,
    },
  },
})

const artifacts = {
  core: { path: 'core.mjs' as const, content: 'export default {}' },
  renderer: { path: 'renderer.json' as const, content: '{}' },
  manifest: { path: 'manifest.json' as const, content: '{}' },
  testAdapter: { path: 'test-adapter.json' as const, content: '{}' },
}

type MeteredUsage = ProviderProvenance['usage'] & { readonly artifactBytes: number }
const zeroUsage: MeteredUsage = {
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicrousd: 0,
  artifactBytes: 0,
}

function adjustedBudget(
  run: PipelineRun,
  reserved: MeteredUsage,
  actual: MeteredUsage,
): PipelineRun['budget'] {
  return {
    ...run.budget,
    consumed: {
      providerRequests: Math.min(
        run.budget.limits.maxProviderRequests,
        run.budget.consumed.providerRequests - reserved.requestCount + actual.requestCount,
      ),
      inputTokens: Math.min(
        run.budget.limits.maxInputTokens,
        run.budget.consumed.inputTokens - reserved.inputTokens + actual.inputTokens,
      ),
      outputTokens: Math.min(
        run.budget.limits.maxOutputTokens,
        run.budget.consumed.outputTokens - reserved.outputTokens + actual.outputTokens,
      ),
      costMicrousd: Math.min(
        run.budget.limits.maxCostMicrousd,
        run.budget.consumed.costMicrousd - reserved.costMicrousd + actual.costMicrousd,
      ),
      artifactBytes: Math.min(
        run.budget.limits.maxArtifactBytes,
        run.budget.consumed.artifactBytes - reserved.artifactBytes + actual.artifactBytes,
      ),
    },
  }
}

class MemoryJournal implements GenerationJournal {
  readonly transitions: GenerationState[] = []
  readonly attempts: { number: number; outcome?: string }[] = []
  readonly calls: string[] = []
  readonly reservations = new Map<
    string,
    {
      inputTokens: number
      outputTokens: number
      requestCount: number
      costMicrousd: number
      artifactBytes: number
    }
  >()
  #run: PipelineRun | undefined

  begin(input: GenerationRequest): PipelineRun & { readonly created: boolean } {
    if (this.#run !== undefined) return { ...this.#run, created: false }
    this.#run = {
      id: '223e4567-e89b-42d3-a456-426614174000',
      state: 'queued',
      revision: 0,
      maxAttempts: input.maxAttempts,
      attemptCount: 0,
      budget: {
        limits: input.budget,
        consumed: {
          providerRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          artifactBytes: 0,
          costMicrousd: 0,
        },
      },
    }
    this.transitions.push('queued')
    return { ...this.#run, created: true }
  }

  transition(run: PipelineRun, to: GenerationState): PipelineRun {
    this.#run = { ...run, state: to, revision: run.revision + 1 }
    this.transitions.push(to)
    return this.#run
  }

  startAttempt(
    run: PipelineRun,
    attemptNumber: number,
    _provider: ProviderDescriptor,
  ): { readonly run: PipelineRun; readonly attemptId: string } {
    this.attempts.push({ number: attemptNumber })
    this.#run = { ...run, attemptCount: attemptNumber }
    return {
      run: this.#run,
      attemptId: `323e4567-e89b-42d3-a456-${attemptNumber.toString().padStart(12, '0')}`,
    }
  }

  reserveProviderCall({
    run,
    reservation,
    artifactBytes,
  }: Parameters<GenerationJournal['reserveProviderCall']>[0]) {
    const provider = chargeProviderTurn(run.budget, reservation)
    if (!provider.ok) return { ok: false as const, run }
    const artifact = chargeArtifactBytes(provider.value, artifactBytes)
    if (!artifact.ok) return { ok: false as const, run }
    const reservationId = `reservation-${this.reservations.size + 1}`
    this.reservations.set(reservationId, { ...reservation, artifactBytes })
    this.#run = { ...run, budget: artifact.value }
    return { ok: true as const, run: this.#run, reservationId }
  }

  releaseProviderReservation({
    run,
    reservationId,
  }: Parameters<GenerationJournal['releaseProviderReservation']>[0]): PipelineRun {
    const reserved = this.reservations.get(reservationId)
    if (reserved === undefined) return run
    this.reservations.delete(reservationId)
    this.#run = { ...run, budget: adjustedBudget(run, reserved, zeroUsage) }
    return this.#run
  }

  recordProviderCall({
    run,
    operation,
    provenance,
    artifactBytes,
    reservationId,
  }: Parameters<GenerationJournal['recordProviderCall']>[0]): PipelineRun {
    this.calls.push(operation)
    const reserved = this.reservations.get(reservationId)
    if (reserved === undefined) throw new TypeError('Reservation is absent.')
    this.reservations.delete(reservationId)
    this.#run = {
      ...run,
      budget: adjustedBudget(run, reserved, { ...provenance.usage, artifactBytes }),
    }
    return this.#run
  }

  recordProviderFailure({
    run,
    operation,
    metering,
    reservationId,
  }: Parameters<GenerationJournal['recordProviderFailure']>[0]): PipelineRun {
    this.calls.push(operation)
    const reserved = this.reservations.get(reservationId)
    if (reserved === undefined) throw new TypeError('Reservation is absent.')
    this.reservations.delete(reservationId)
    this.#run = {
      ...run,
      budget: adjustedBudget(run, reserved, { ...metering.usage, artifactBytes: 0 }),
    }
    return this.#run
  }

  recordConcept(): { readonly id: string; readonly hash: `sha256:${string}` } {
    return { id: 'concept-1', hash: HASH_A }
  }

  recordCandidate(): { readonly generatedArtifactId: string } {
    return { generatedArtifactId: '323e4567-e89b-42d3-a456-426614174000' }
  }

  recordVerification({ result }: Parameters<GenerationJournal['recordVerification']>[0]): {
    readonly verificationRunId: string
    readonly findingsReference: string
  } {
    return {
      verificationRunId: '423e4567-e89b-42d3-a456-426614174000',
      findingsReference: result.findingsHash,
    }
  }

  completeAttempt({
    attemptNumber,
    outcome,
  }: Parameters<GenerationJournal['completeAttempt']>[0]): void {
    const attempt = this.attempts.find(({ number }) => number === attemptNumber)
    if (attempt !== undefined) attempt.outcome = outcome
  }
}

const runner = (): PipelineRunner => ({
  execute: vi.fn((_concept, _candidate, signal) =>
    Promise.resolve(
      signal?.aborted === true
        ? { ok: false as const, cancelled: true as const, diagnostics: [] }
        : {
            ok: true as const,
            artifactHash: HASH_A,
            observations: [{ input: { lengthM: 1, amplitudeDeg: 10 }, periodS: 2 }],
            diagnostics: [] as RunnerDiagnostic[],
          },
    ),
  ),
})

const verifier = (verdicts: ('rejected' | 'verified')[]): PipelineVerifier => ({
  verify: vi.fn(() => {
    const verdict = verdicts.shift() ?? 'rejected'
    return Promise.resolve({
      verdict,
      reportHash: HASH_B,
      findingsHash: HASH_B,
      findings:
        verdict === 'rejected'
          ? ([
              {
                id: 'pendulum.period.relative-error',
                category: 'mismatch',
                severity: 'error',
                checkId: 'pendulum.period',
                quantity: 'periodS',
                inputs: {},
                expected: { value: 2, unit: 's' },
                actual: { value: 1, unit: 's' },
                tolerance: {
                  mode: 'relative',
                  expected: { value: 2, unit: 's' },
                  allowedError: { value: 0.01, unit: 'ratio' },
                },
                error: { mode: 'relative', value: 0.5 },
                explanation: 'Mismatch.',
              },
            ] as unknown as VerificationFinding[])
          : [],
    })
  }),
})

const providers = () => ({
  conceptCompiler: {
    descriptor: { provider: 'fake' as const, model: 'fake-v1', templateVersion: '1.0.0' },
    compileReservation: reservation,
    compile: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { conceptSpec: concept, provenance: usage('compile-1', 'fake') },
      }),
    ),
  },
  codeGenerator: {
    descriptor: {
      provider: 'codex-sdk' as const,
      model: 'codex-v1',
      templateVersion: '1.0.0',
    },
    generateReservation: reservation,
    repairReservation: reservation,
    disposeThread: vi.fn(() => Promise.resolve(true)),
    disposeOrphanedState: vi.fn(() => Promise.resolve(true)),
    generate: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { artifacts, threadId: 'thread-1', provenance: usage('generate-1', 'codex-sdk') },
      }),
    ),
    repair: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { artifacts, threadId: 'thread-1', provenance: usage('repair-1', 'codex-sdk') },
      }),
    ),
  },
})

const pipeline = (
  journal: MemoryJournal,
  verdicts: ('rejected' | 'verified')[],
  overrides: {
    providerSet?: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'>
    runnerPort?: PipelineRunner
    verifierPort?: PipelineVerifier
    signals?: GenerationSignals
  } = {},
) => {
  const providerSet = overrides.providerSet ?? providers()
  return createGenerationPipeline({
    ...providerSet,
    journal,
    runner: overrides.runnerPort ?? runner(),
    verifier: overrides.verifierPort ?? verifier(verdicts),
    ...(overrides.signals === undefined ? {} : { signals: overrides.signals }),
    now: () => NOW,
  })
}

function signalRecorder(events: string[] = []) {
  const verificationCompleted = vi.fn<GenerationSignals['verificationCompleted']>((result) => {
    events.push(
      'verdict' in result ? `verification:${result.verdict}` : `verification:${result.errorId}`,
    )
  })
  const signals: GenerationSignals = {
    withRun: (_runId, _simulationId, operation) => operation(),
    withAttempt: (_runId, _attemptId, operation) => operation(),
    accepted: vi.fn(),
    transition: vi.fn((_runId, _from, to) => events.push(`transition:${to}`)),
    runFailed: vi.fn(),
    attemptStarted: vi.fn(),
    providerCompleted: vi.fn(),
    runnerCompleted: vi.fn(),
    verificationCompleted,
    queueDepth: vi.fn(),
  }
  return { signals, verificationCompleted }
}

describe('generation pipeline', () => {
  it('verifies a correct first candidate through every trusted stage', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const result = await pipeline(journal, ['verified'], { providerSet }).run(request())

    expect(result).toMatchObject({ state: 'verified', attemptCount: 1 })
    expect(journal.transitions).toEqual([
      'queued',
      'compiling',
      'generating',
      'executing',
      'verifying',
      'verified',
    ])
    expect(journal.attempts).toEqual([{ number: 1, outcome: 'verified' }])
    expect(journal.calls).toEqual(['concept_compile', 'code_generate'])
    expect(providerSet.codeGenerator.disposeThread).toHaveBeenCalledWith('thread-1')
    expect(providerSet.codeGenerator.disposeThread).toHaveBeenCalledTimes(1)
  })

  it('fails closed when terminal Codex thread cleanup cannot be confirmed', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    providerSet.codeGenerator.disposeThread.mockResolvedValue(false)

    const result = await pipeline(journal, ['verified'], { providerSet }).run(request())
    expect(result).toMatchObject({ state: 'invariant_failed', attemptCount: 1 })
    expect(providerSet.codeGenerator.disposeThread).toHaveBeenCalledWith('thread-1')
  })

  it('disposes adopted Codex state when durable provider journaling throws', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const recordProviderCall = journal.recordProviderCall.bind(journal)
    vi.spyOn(journal, 'recordProviderCall').mockImplementation((input) => {
      if (input.operation === 'code_generate') {
        throw new TypeError('Injected persistence failure.')
      }
      return recordProviderCall(input)
    })

    await expect(pipeline(journal, ['verified'], { providerSet }).run(request())).rejects.toThrow(
      'Injected persistence failure.',
    )
    expect(providerSet.codeGenerator.disposeThread).toHaveBeenCalledTimes(1)
    expect(providerSet.codeGenerator.disposeThread).toHaveBeenCalledWith('thread-1')
  })

  it('repairs a rejected candidate on the same thread and then verifies', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const result = await pipeline(journal, ['rejected', 'verified'], { providerSet }).run(request())

    expect(result).toMatchObject({ state: 'verified', attemptCount: 2 })
    expect(journal.transitions).toEqual([
      'queued',
      'compiling',
      'generating',
      'executing',
      'verifying',
      'repairing',
      'executing',
      'verifying',
      'verified',
    ])
    expect(providerSet.codeGenerator.repair).toHaveBeenCalledWith(
      expect.objectContaining({
        previousArtifacts: artifacts,
        threadId: 'thread-1',
        findings: expect.any(Array),
      }),
      undefined,
    )
  })

  it('stops rejected after exactly the configured attempt cap', async () => {
    const journal = new MemoryJournal()
    const result = await pipeline(journal, ['rejected', 'rejected', 'rejected']).run(request())

    expect(result).toMatchObject({ state: 'rejected', attemptCount: 3 })
    expect(journal.attempts).toEqual([
      { number: 1, outcome: 'rejected' },
      { number: 2, outcome: 'rejected' },
      { number: 3, outcome: 'rejected' },
    ])
  })

  it('returns an idempotent replay without invoking providers again', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const coordinator = pipeline(journal, ['verified'], { providerSet })
    const first = await coordinator.run(request())
    const replay = await coordinator.run(request())

    expect(replay).toEqual(first)
    expect(providerSet.conceptCompiler.compile).toHaveBeenCalledTimes(1)
  })

  it('records the initial queued signal only for a newly accepted durable run', async () => {
    const journal = new MemoryJournal()
    const observed = signalRecorder()
    const coordinator = pipeline(journal, [], { signals: observed.signals })

    await coordinator.accept(request())
    await coordinator.accept(request())

    expect(observed.signals.accepted).toHaveBeenCalledOnce()
    expect(observed.signals.accepted).toHaveBeenCalledWith(
      '223e4567-e89b-42d3-a456-426614174000',
      request().simulationVersionId,
    )
  })

  it('cancels before the first provider call', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const controller = new AbortController()
    controller.abort()
    const result = await pipeline(journal, ['verified'], { providerSet }).run(
      request(),
      controller.signal,
    )

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 0 })
    expect(providerSet.conceptCompiler.compile).not.toHaveBeenCalled()
  })

  it('emits a confirmed-run cancellation only after its durable transition succeeds', async () => {
    const journal = new MemoryJournal()
    const observed = signalRecorder()
    const coordinator = pipeline(journal, [], { signals: observed.signals })
    const { created: _created, ...queued } = journal.begin(request())
    const compiling = journal.transition(queued, 'compiling')
    const generating = journal.transition(compiling, 'generating')
    const controller = new AbortController()
    controller.abort()

    await expect(
      coordinator.continueConfirmed(generating, concept, controller.signal),
    ).resolves.toMatchObject({ state: 'cancelled' })
    expect(observed.signals.transition).toHaveBeenCalledOnce()
    expect(observed.signals.transition).toHaveBeenCalledWith(
      generating.id,
      'generating',
      'cancelled',
    )

    const failingJournal = new MemoryJournal()
    const failingObserved = signalRecorder()
    const failingCoordinator = pipeline(failingJournal, [], { signals: failingObserved.signals })
    const { created: _failingCreated, ...failingQueued } = failingJournal.begin(request())
    const failingCompiling = failingJournal.transition(failingQueued, 'compiling')
    const failingGenerating = failingJournal.transition(failingCompiling, 'generating')
    vi.spyOn(failingJournal, 'transition').mockImplementationOnce(() => {
      throw new TypeError('Injected persistence failure.')
    })

    await expect(
      failingCoordinator.continueConfirmed(failingGenerating, concept, controller.signal),
    ).rejects.toThrow('Injected persistence failure.')
    expect(failingObserved.signals.transition).not.toHaveBeenCalled()
  })

  it('exhausts request budget before starting the code provider', async () => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const result = await pipeline(journal, ['verified'], { providerSet }).run(
      request({ budget: { ...request().budget, maxProviderRequests: 1 } }),
    )

    expect(result).toMatchObject({ state: 'budget_exhausted', attemptCount: 1 })
    expect(providerSet.codeGenerator.generate).not.toHaveBeenCalled()
  })

  it.each([
    ['maxInputTokens', 5],
    ['maxOutputTokens', 10],
    ['maxCostMicrousd', 50],
  ] as const)('reserves %s before dispatching concept compilation', async (dimension, limit) => {
    const journal = new MemoryJournal()
    const providerSet = providers()
    const result = await pipeline(journal, ['verified'], { providerSet }).run(
      request({ budget: { ...request().budget, [dimension]: limit } }),
    )

    expect(result).toMatchObject({ state: 'budget_exhausted', attemptCount: 0 })
    expect(providerSet.conceptCompiler.compile).not.toHaveBeenCalled()
    expect(journal.calls).toEqual([])
  })

  it('retains actual metering and stops when a provider exceeds its reservation', async () => {
    const journal = new MemoryJournal()
    const base = providers()
    const providerSet = {
      ...base,
      conceptCompiler: {
        ...base.conceptCompiler,
        compileReservation: { ...reservation, inputTokens: 5 },
      },
    }
    const result = await pipeline(journal, ['verified'], { providerSet }).run(request())

    expect(result).toMatchObject({
      state: 'budget_exhausted',
      attemptCount: 0,
      budget: { consumed: { providerRequests: 1, inputTokens: 10 } },
    })
    expect(journal.calls).toEqual(['concept_compile'])
  })

  it('meters a completed provider call while rejecting its oversized artifacts', async () => {
    const journal = new MemoryJournal()
    const runnerPort = runner()
    const result = await pipeline(journal, ['verified'], { runnerPort }).run(
      request({ budget: { ...request().budget, maxArtifactBytes: 1 } }),
    )

    expect(result).toMatchObject({
      state: 'budget_exhausted',
      attemptCount: 1,
      budget: {
        consumed: { providerRequests: 2, artifactBytes: 1 },
      },
    })
    expect(journal.calls).toEqual(['concept_compile', 'code_generate'])
    expect(runnerPort.execute).not.toHaveBeenCalled()
  })

  it('keeps provider failure distinct from scientific rejection', async () => {
    const journal = new MemoryJournal()
    const providerSet = {
      ...providers(),
      conceptCompiler: {
        descriptor: { provider: 'fake' as const, model: 'fake-v1', templateVersion: '1.0.0' },
        compileReservation: reservation,
        compile: vi.fn(() =>
          Promise.resolve({
            ok: false as const,
            kind: 'authentication',
            error: {
              category: 'authentication' as const,
              stableErrorId: 'provider.authentication-failed' as const,
              retryable: false,
            },
            metering: {
              provider: 'fake' as const,
              model: 'fake-v1',
              templateVersion: '1.0.0',
              requestIds: ['failure-1'],
              usage: {
                requestCount: 1,
                inputTokens: 0,
                outputTokens: 0,
                costMicrousd: 0,
              },
            },
          }),
        ),
      },
    }

    const result = await pipeline(journal, [], { providerSet }).run(request())
    expect(result).toMatchObject({ state: 'provider_failed', attemptCount: 0 })
    expect(journal.transitions).toEqual(['queued', 'compiling', 'provider_failed'])
  })

  it('records structured concept cancellation without a transient provider signal', async () => {
    const journal = new MemoryJournal()
    const providerSet: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'> = providers()
    vi.spyOn(providerSet.conceptCompiler, 'compile').mockResolvedValue(
      cancelledProviderResult('fake'),
    )
    const observed = signalRecorder()

    const result = await pipeline(journal, [], {
      providerSet,
      signals: observed.signals,
    }).run(request())

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 0 })
    expect(journal.calls).toEqual(['concept_compile'])
    expect(observed.signals.providerCompleted).toHaveBeenCalledWith(
      'concept-compile',
      'generation.cancelled',
    )
    expect(observed.signals.providerCompleted).not.toHaveBeenCalledWith(
      expect.anything(),
      'provider.transient-failure',
    )
  })

  it('records structured generate cancellation without a transient provider signal', async () => {
    const journal = new MemoryJournal()
    const providerSet: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'> = providers()
    vi.spyOn(providerSet.codeGenerator, 'generate').mockResolvedValue(
      cancelledProviderResult('codex-sdk'),
    )
    const observed = signalRecorder()

    const result = await pipeline(journal, [], {
      providerSet,
      signals: observed.signals,
    }).run(request())

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 1 })
    expect(journal.calls).toEqual(['concept_compile', 'code_generate'])
    expect(observed.signals.providerCompleted).toHaveBeenCalledWith(
      'code-generate',
      'generation.cancelled',
    )
    expect(observed.signals.providerCompleted).not.toHaveBeenCalledWith(
      expect.anything(),
      'provider.transient-failure',
    )
  })

  it('records structured repair cancellation without a transient provider signal', async () => {
    const journal = new MemoryJournal()
    const providerSet: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'> = providers()
    vi.spyOn(providerSet.codeGenerator, 'repair').mockResolvedValue(
      cancelledProviderResult('codex-sdk'),
    )
    const observed = signalRecorder()

    const result = await pipeline(journal, ['rejected'], {
      providerSet,
      signals: observed.signals,
    }).run(request())

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 2 })
    expect(journal.calls).toEqual(['concept_compile', 'code_generate', 'code_repair'])
    expect(observed.signals.providerCompleted).toHaveBeenCalledWith(
      'code-repair',
      'generation.cancelled',
    )
    expect(observed.signals.providerCompleted).not.toHaveBeenCalledWith(
      expect.anything(),
      'provider.transient-failure',
    )
  })

  it.each(['concept-compile', 'code-generate', 'code-repair'] as const)(
    'classifies an abort-induced %s rejection as cancellation without leaking its cause',
    async (operation) => {
      const journal = new MemoryJournal()
      const providerSet: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'> =
        providers()
      const controller = new AbortController()
      const privateDetail = `private ${operation} cause with ${request().prompt}`
      if (operation === 'concept-compile') {
        vi.spyOn(providerSet.conceptCompiler, 'compile').mockImplementation(() => {
          controller.abort()
          return Promise.reject(new TypeError(privateDetail))
        })
      } else if (operation === 'code-generate') {
        vi.spyOn(providerSet.codeGenerator, 'generate').mockImplementation(() => {
          controller.abort()
          return Promise.reject(new TypeError(privateDetail))
        })
      } else {
        vi.spyOn(providerSet.codeGenerator, 'repair').mockImplementation(() => {
          controller.abort()
          return Promise.reject(new TypeError(privateDetail))
        })
      }
      const observed = signalRecorder()
      const verdicts = operation === 'code-repair' ? (['rejected'] as const) : []

      const result = await pipeline(journal, [...verdicts], {
        providerSet,
        signals: observed.signals,
      }).run(request(), controller.signal)

      expect(result).toMatchObject({ state: 'cancelled' })
      expect(observed.signals.providerCompleted).toHaveBeenCalledWith(
        operation,
        'generation.cancelled',
      )
      expect(observed.signals.providerCompleted).not.toHaveBeenCalledWith(
        expect.anything(),
        'provider.transient-failure',
      )
      const providerCompleted = vi.mocked(observed.signals.providerCompleted)
      expect(JSON.stringify(providerCompleted.mock.calls)).not.toContain(privateDetail)
      expect(JSON.stringify(providerCompleted.mock.calls)).not.toContain(request().prompt)
    },
  )

  it('records malformed provider output as a distinct bounded attempt outcome', async () => {
    const journal = new MemoryJournal()
    const providerSet: Pick<PipelineDependencies, 'codeGenerator' | 'conceptCompiler'> = providers()
    vi.spyOn(providerSet.codeGenerator, 'generate').mockResolvedValue({
      ok: false,
      kind: 'malformed-response',
      error: {
        category: 'malformed-response',
        stableErrorId: 'provider.malformed-response',
        retryable: false,
      },
      metering: {
        provider: 'codex-sdk',
        model: 'codex-v1',
        templateVersion: '1.0.0',
        requestIds: ['malformed-1'],
        usage: {
          requestCount: 1,
          inputTokens: 1,
          outputTokens: 1,
          costMicrousd: 1,
        },
      },
    })

    const result = await pipeline(journal, [], { providerSet }).run(request())

    expect(result).toMatchObject({ state: 'provider_failed', attemptCount: 1 })
    expect(journal.attempts).toEqual([{ number: 1, outcome: 'malformed_response' }])
  })

  it('does not persist or charge a provider call that failed before dispatch', async () => {
    const journal = new MemoryJournal()
    const providerSet = {
      ...providers(),
      conceptCompiler: {
        descriptor: { provider: 'fake' as const, model: 'fake-v1', templateVersion: '1.0.0' },
        compileReservation: reservation,
        compile: vi.fn(() =>
          Promise.resolve({
            ok: false as const,
            kind: 'authentication',
            error: {
              category: 'authentication' as const,
              stableErrorId: 'provider.authentication-failed' as const,
              retryable: false,
            },
            metering: {
              provider: 'fake' as const,
              model: 'fake-v1',
              templateVersion: '1.0.0',
              requestIds: [],
              usage: {
                requestCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                costMicrousd: 0,
              },
            },
          }),
        ),
      },
    }

    const result = await pipeline(journal, [], { providerSet }).run(request())
    expect(result).toMatchObject({ state: 'provider_failed', attemptCount: 0 })
    expect(journal.calls).toEqual([])
    expect(result.budget.consumed.providerRequests).toBe(0)
  })

  it('keeps runner failure distinct from verifier rejection', async () => {
    const journal = new MemoryJournal()
    const failedRunner: PipelineRunner = {
      execute: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          stableErrorId: 'runner.runtime.crash',
          diagnostics: [],
        }),
      ),
    }

    const result = await pipeline(journal, [], { runnerPort: failedRunner }).run(request())
    expect(result).toMatchObject({ state: 'runner_failed', attemptCount: 1 })
    expect(journal.attempts).toEqual([{ number: 1, outcome: 'runner_failed' }])
  })

  it('maps an unexpected runner exception to the runner failure boundary', async () => {
    const journal = new MemoryJournal()
    const throwingRunner: PipelineRunner = {
      execute: vi.fn(() => Promise.reject(new Error('runner process exited'))),
    }

    const result = await pipeline(journal, [], { runnerPort: throwingRunner }).run(request())
    expect(result).toMatchObject({ state: 'runner_failed', attemptCount: 1 })
    expect(journal.attempts).toEqual([{ number: 1, outcome: 'runner_failed' }])
  })

  it('classifies a structured runner cancellation as cancelled telemetry', async () => {
    const journal = new MemoryJournal()
    const observed = signalRecorder()
    const cancelledRunner: PipelineRunner = {
      execute: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          cancelled: true as const,
          stableErrorId: 'runner.cancelled',
          diagnostics: [],
        }),
      ),
    }

    const result = await pipeline(journal, [], {
      runnerPort: cancelledRunner,
      signals: observed.signals,
    }).run(request())

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 1 })
    expect(observed.signals.runnerCompleted).toHaveBeenCalledOnce()
    expect(observed.signals.runnerCompleted).toHaveBeenCalledWith('runner.cancelled')
  })

  it('classifies an abort-induced runner rejection as cancelled telemetry', async () => {
    const journal = new MemoryJournal()
    const observed = signalRecorder()
    const controller = new AbortController()
    const abortingRunner: PipelineRunner = {
      execute: vi.fn(() => {
        controller.abort()
        return Promise.reject(new TypeError('private runner cancellation detail'))
      }),
    }

    const result = await pipeline(journal, [], {
      runnerPort: abortingRunner,
      signals: observed.signals,
    }).run(request(), controller.signal)

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 1 })
    expect(observed.signals.runnerCompleted).toHaveBeenCalledOnce()
    expect(observed.signals.runnerCompleted).toHaveBeenCalledWith('runner.cancelled')
    expect(JSON.stringify(vi.mocked(observed.signals.runnerCompleted).mock.calls)).not.toContain(
      'private runner cancellation detail',
    )
  })

  it('honors cancellation raised while trusted verification is running', async () => {
    const journal = new MemoryJournal()
    const controller = new AbortController()
    const cancellingVerifier: PipelineVerifier = {
      verify: vi.fn(() => {
        controller.abort()
        return Promise.resolve({
          verdict: 'verified' as const,
          reportHash: HASH_B,
          findingsHash: HASH_B,
          findings: [],
        })
      }),
    }

    const observed = signalRecorder()
    const result = await pipeline(journal, [], {
      verifierPort: cancellingVerifier,
      signals: observed.signals,
    }).run(request(), controller.signal)
    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 1 })
    expect(journal.attempts).toEqual([{ number: 1, outcome: 'cancelled' }])
    expect(cancellingVerifier.verify).toHaveBeenCalledOnce()
    expect(observed.verificationCompleted).toHaveBeenCalledWith({ verdict: 'verified' })
  })

  it('does not misclassify an aborting verifier rejection as an invariant failure', async () => {
    const journal = new MemoryJournal()
    const controller = new AbortController()
    const observed = signalRecorder()
    const cancellingVerifier: PipelineVerifier = {
      verify: vi.fn(() => {
        controller.abort()
        return Promise.reject(new TypeError('private cancellation detail'))
      }),
    }

    const result = await pipeline(journal, [], {
      verifierPort: cancellingVerifier,
      signals: observed.signals,
    }).run(request(), controller.signal)

    expect(result).toMatchObject({ state: 'cancelled', attemptCount: 1 })
    expect(cancellingVerifier.verify).toHaveBeenCalledOnce()
    expect(observed.verificationCompleted).not.toHaveBeenCalled()
  })

  it('fails closed when the verifier violates its port contract', async () => {
    const journal = new MemoryJournal()
    const events: string[] = []
    const observed = signalRecorder(events)
    const brokenVerifier: PipelineVerifier = {
      verify: vi.fn(() => Promise.reject(new TypeError('private verifier detail'))),
    }

    const result = await pipeline(journal, [], {
      verifierPort: brokenVerifier,
      signals: observed.signals,
    }).run(request())
    expect(result).toMatchObject({ state: 'invariant_failed', attemptCount: 1 })
    expect(observed.verificationCompleted).toHaveBeenCalledWith({
      errorId: 'orchestration.invariant-failed',
    })
    expect(events.indexOf('verification:orchestration.invariant-failed')).toBeLessThan(
      events.indexOf('transition:invariant_failed'),
    )
    expect(JSON.stringify(observed.verificationCompleted.mock.calls)).not.toContain(
      'private verifier detail',
    )
  })

  it.each(['verified', 'rejected'] as const)(
    'emits one verifier completion for the %s result',
    async (verdict) => {
      const journal = new MemoryJournal()
      const observed = signalRecorder()

      await pipeline(journal, [verdict], { signals: observed.signals }).run(
        request({ maxAttempts: 1 }),
      )

      expect(observed.verificationCompleted).toHaveBeenCalledOnce()
      expect(observed.verificationCompleted).toHaveBeenCalledWith({ verdict })
    },
  )

  it('does not emit a verifier signal when cancellation prevents verifier invocation', async () => {
    const journal = new MemoryJournal()
    const controller = new AbortController()
    const observed = signalRecorder()
    const runnerPort: PipelineRunner = {
      execute: vi.fn(() => {
        controller.abort()
        return Promise.resolve({
          ok: true as const,
          artifactHash: HASH_A,
          observations: [],
          diagnostics: [],
        })
      }),
    }
    const verifierPort = verifier(['verified'])

    const result = await pipeline(journal, [], {
      runnerPort,
      verifierPort,
      signals: observed.signals,
    }).run(request(), controller.signal)

    expect(result).toMatchObject({ state: 'cancelled' })
    expect(verifierPort.verify).not.toHaveBeenCalled()
    expect(observed.verificationCompleted).not.toHaveBeenCalled()
  })
})
