import {
  CorrelationContext,
  createStructuredLogger,
  LocalLogStore,
  LocalMetrics,
} from '@simproof/observability'
import { describe, expect, it } from 'vitest'

import { GenerationObservability } from './generation-observability.js'

const NOW = Date.parse('2026-07-17T12:00:00.000Z')
const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const runId = '119f6bc1-0811-70c1-a139-938a3ad2dee0'
const attemptId = '219f6bc1-0811-70c1-a139-938a3ad2dee0'
const simulationId = '319f6bc1-0811-70c1-a139-938a3ad2dee0'

describe('generation observability', () => {
  it('emits allowlisted correlated signals and low-cardinality local metrics', () => {
    const context = new CorrelationContext()
    const store = new LocalLogStore({ maxEntries: 20, maxAgeMs: 60_000 }, () => NOW)
    const metrics = new LocalMetrics()
    const signals = new GenerationObservability({
      context,
      logger: createStructuredLogger({ sink: store, clock: () => NOW }),
      metrics,
    })

    context.run({ requestId }, () => {
      signals.withRun(runId, simulationId, () => {
        signals.accepted(runId, simulationId)
        signals.transition(runId, 'queued', 'generating')
        signals.withAttempt(runId, attemptId, () => {
          signals.attemptStarted(runId, attemptId, 1)
          signals.providerCompleted('code-generate', 'provider.quota-exceeded')
          signals.runnerCompleted('runner.limit.memory')
          signals.verificationCompleted({ verdict: 'rejected' })
        })
      })
    })

    expect(store.recent()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'runner-client',
          errorId: 'runner.limit.memory',
          correlation: { requestId, runId, attemptId, simulationId },
        }),
        expect.objectContaining({
          component: 'verifier',
          severity: 'warn',
          errorId: 'verifier.scientific-rejection',
          correlation: { requestId, runId, attemptId, simulationId },
          attributes: { verdict: 'rejected', failureClass: 'scientific-rejection' },
        }),
      ]),
    )
    expect(metrics.snapshot()).toMatchObject({
      transitions: [
        { from: null, to: 'queued', count: 1 },
        { from: 'queued', to: 'generating', count: 1 },
      ],
      providerErrors: [{ classification: 'quota', count: 1 }],
      runnerErrors: [{ classification: 'resource-limit', count: 1 }],
      resourceRejections: [{ resource: 'memory', count: 1 }],
      verdicts: [{ verdict: 'rejected', count: 1 }],
    })
    expect(JSON.stringify(metrics.snapshot())).not.toContain(requestId)
  })

  it.each(['verified', 'inapplicable'] as const)(
    'emits a correlated %s completion without an error classification',
    (verdict) => {
      const context = new CorrelationContext()
      const store = new LocalLogStore({ maxEntries: 5, maxAgeMs: 60_000 }, () => NOW)
      const signals = new GenerationObservability({
        context,
        logger: createStructuredLogger({ sink: store, clock: () => NOW }),
        metrics: new LocalMetrics(),
      })

      context.run({ requestId, runId, attemptId, simulationId }, () => {
        signals.verificationCompleted({ verdict })
      })

      expect(store.recent()).toEqual([
        expect.objectContaining({
          severity: 'info',
          component: 'verifier',
          event: 'verification.completed',
          correlation: { requestId, runId, attemptId, simulationId },
          attributes: { verdict },
        }),
      ])
      expect(store.recent()[0]).not.toHaveProperty('errorId')
    },
  )

  it('emits a safe correlated verifier failure without retaining a cause', () => {
    const context = new CorrelationContext()
    const store = new LocalLogStore({ maxEntries: 5, maxAgeMs: 60_000 }, () => NOW)
    const signals = new GenerationObservability({
      context,
      logger: createStructuredLogger({ sink: store, clock: () => NOW }),
      metrics: new LocalMetrics(),
    })

    context.run({ requestId, runId, attemptId, simulationId }, () => {
      signals.verificationCompleted({ errorId: 'orchestration.invariant-failed' })
    })

    expect(store.recent()).toEqual([
      expect.objectContaining({
        severity: 'error',
        component: 'verifier',
        event: 'verification.completed',
        errorId: 'orchestration.invariant-failed',
        correlation: { requestId, runId, attemptId, simulationId },
      }),
    ])
    expect(JSON.stringify(store.recent())).not.toContain('cause')
  })

  it('classifies provider cancellation without a transient metric or sensitive content', () => {
    const context = new CorrelationContext()
    const store = new LocalLogStore({ maxEntries: 5, maxAgeMs: 60_000 }, () => NOW)
    const metrics = new LocalMetrics()
    const signals = new GenerationObservability({
      context,
      logger: createStructuredLogger({ sink: store, clock: () => NOW }),
      metrics,
    })

    context.run({ requestId, runId, attemptId, simulationId }, () => {
      signals.providerCompleted('code-repair', 'generation.cancelled')
    })

    expect(store.recent()).toEqual([
      expect.objectContaining({
        component: 'provider',
        event: 'provider.call.completed',
        errorId: 'generation.cancelled',
        correlation: { requestId, runId, attemptId, simulationId },
        attributes: { operation: 'code-repair' },
      }),
    ])
    expect(metrics.snapshot().providerErrors).toEqual([
      { classification: 'cancellation', count: 1 },
    ])
    expect(JSON.stringify({ logs: store.recent(), metrics: metrics.snapshot() })).not.toContain(
      'private prompt or cause',
    )
  })

  it('classifies runner cancellation as a cancelled completion', () => {
    const context = new CorrelationContext()
    const store = new LocalLogStore({ maxEntries: 5, maxAgeMs: 60_000 }, () => NOW)
    const metrics = new LocalMetrics()
    const signals = new GenerationObservability({
      context,
      logger: createStructuredLogger({ sink: store, clock: () => NOW }),
      metrics,
    })

    context.run({ requestId, runId, attemptId, simulationId }, () => {
      signals.runnerCompleted('runner.cancelled')
    })

    expect(store.recent()).toEqual([
      expect.objectContaining({
        component: 'runner-client',
        event: 'runner.execution.completed',
        errorId: 'runner.cancelled',
        correlation: { requestId, runId, attemptId, simulationId },
      }),
    ])
    expect(metrics.snapshot().runnerErrors).toEqual([{ classification: 'cancelled', count: 1 }])
  })
})
