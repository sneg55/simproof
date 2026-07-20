import {
  CorrelationContext,
  createStructuredLogger,
  LocalLogStore,
  LocalMetrics,
} from '@simproof/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GenerationObservability } from './generation-observability.js'
import {
  cleanupReverificationRoots,
  NOW,
  reverifyRequest,
  setupReverification,
  successfulResponse,
  terminal,
  unwrap,
} from './reverification.test-support.js'
import { ReverificationService } from './reverification-service.js'
import type { TrustedRunnerAdapter } from './trusted-runner-adapter.js'

afterEach(cleanupReverificationRoots)

describe('reverification observability', () => {
  it('mirrors the durable initial, verifying, and verified transitions', async () => {
    const context = await setupReverification()
    const observed = observability()
    const service = serviceFor(context, observed.signals)
    try {
      const accepted = unwrap(
        await service.start(
          context.versionId,
          reverifyRequest(context.stale.revision, 'reverify:observability:success'),
        ),
      )
      expect((await terminal(service, accepted.runId)).state).toBe('verified')
      expectObservedTransitions(context, accepted.runId, observed.metrics)
      expect(observed.metrics.snapshot()).toMatchObject({
        transitions: [
          { from: null, to: 'executing', count: 1 },
          { from: 'executing', to: 'verifying', count: 1 },
          { from: 'verifying', to: 'verified', count: 1 },
        ],
        attempts: [{ attemptKind: 'generation', count: 1 }],
        providerErrors: [],
      })
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it.each(['cancel', 'close'] as const)(
    'mirrors durable %s settlement from executing',
    async (mode) => {
      const context = await setupReverification()
      const observed = observability()
      const runner = blockingRunner()
      const service = serviceFor(context, observed.signals, runner)
      try {
        const accepted = unwrap(
          await service.start(
            context.versionId,
            reverifyRequest(context.stale.revision, `reverify:observability:${mode}`),
          ),
        )
        await runner.entered
        if (mode === 'close') await service.close()
        else {
          const current = unwrap(await service.status(accepted.runId))
          unwrap(await service.cancel(accepted.runId, current.revision))
        }
        expect((await terminal(service, accepted.runId)).state).toBe('cancelled')
        expectObservedTransitions(context, accepted.runId, observed.metrics)
        expect(observed.metrics.snapshot().transitions).toEqual([
          { from: null, to: 'executing', count: 1 },
          { from: 'executing', to: 'cancelled', count: 1 },
        ])
      } finally {
        await service.close()
        context.database.close()
      }
    },
  )

  it('mirrors durable invariant settlement for a corrupt bound artifact', async () => {
    const context = await setupReverification()
    const observed = observability()
    const coreHash = context.stale.activeArtifactBundle?.core.contentHash
    if (coreHash === undefined) throw new TypeError('Expected a bound core.')
    unwrap(await context.store.delete(coreHash))
    const service = serviceFor(context, observed.signals)
    try {
      const accepted = unwrap(
        await service.start(
          context.versionId,
          reverifyRequest(context.stale.revision, 'reverify:observability:corrupt'),
        ),
      )
      expect((await terminal(service, accepted.runId)).state).toBe('invariant_failed')
      expectObservedTransitions(context, accepted.runId, observed.metrics)
      expect(observed.metrics.snapshot().transitions).toEqual([
        { from: null, to: 'executing', count: 1 },
        { from: 'executing', to: 'invariant_failed', count: 1 },
      ])
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it.each(['rejected', 'runner_failed'] as const)(
    'mirrors the durable %s terminal transition',
    async (outcome) => {
      const context = await setupReverification()
      const observed = observability()
      if (outcome === 'rejected') {
        context.execute.mockImplementation((input) =>
          Promise.resolve(successfulResponse(input as Parameters<typeof successfulResponse>[0], 2)),
        )
      }
      const runner: TrustedRunnerAdapter =
        outcome === 'runner_failed'
          ? {
              execute: vi.fn().mockResolvedValue({
                ok: false,
                stableErrorId: 'runner.execution-failed',
                diagnostics: [],
              }),
            }
          : context.runner
      const service = serviceFor(context, observed.signals, runner)
      try {
        const accepted = unwrap(
          await service.start(
            context.versionId,
            reverifyRequest(context.stale.revision, `reverify:observability:${outcome}`),
          ),
        )
        expect((await terminal(service, accepted.runId)).state).toBe(outcome)
        expectObservedTransitions(context, accepted.runId, observed.metrics)
      } finally {
        await service.close()
        context.database.close()
      }
    },
  )
})

function observability() {
  const metrics = new LocalMetrics()
  const store = new LocalLogStore({ maxEntries: 50, maxAgeMs: 60_000 }, () => Date.parse(NOW))
  return {
    metrics,
    signals: new GenerationObservability({
      context: new CorrelationContext(),
      logger: createStructuredLogger({ sink: store, clock: () => Date.parse(NOW) }),
      metrics,
    }),
  }
}

type Context = Awaited<ReturnType<typeof setupReverification>>
type Signals = ReturnType<typeof observability>['signals']

function serviceFor(context: Context, signals: Signals, runner = context.runner) {
  return new ReverificationService({
    database: context.database,
    store: context.store,
    runner,
    verifier: context.verifier,
    signals,
  })
}

function blockingRunner(): TrustedRunnerAdapter & { readonly entered: Promise<void> } {
  let enter: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  return {
    entered,
    execute: vi.fn(
      async (_concept: unknown, _artifacts: unknown, signal?: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          enter?.()
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          )
        }),
    ),
  }
}

function expectObservedTransitions(context: Context, runId: string, metrics: LocalMetrics): void {
  const durable = unwrap(context.database.generation.history(runId)).map(({ from, to }) => ({
    from,
    to,
    count: 1,
  }))
  expect(metrics.snapshot().transitions).toEqual(durable)
}
