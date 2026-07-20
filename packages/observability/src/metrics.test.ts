import { describe, expect, it } from 'vitest'

import { LocalMetrics, metricEventSchema, metricsSnapshotSchema } from './index.js'

describe('bounded local operational metrics', () => {
  it('tracks transitions, verdicts, failures, queue depth, attempts, and resource rejections', () => {
    const metrics = new LocalMetrics()
    metrics.record({ kind: 'transition', from: null, to: 'queued' })
    metrics.record({ kind: 'transition', from: 'queued', to: 'compiling' })
    metrics.record({ kind: 'transition', from: 'queued', to: 'compiling' })
    metrics.record({ kind: 'verdict', verdict: 'rejected' })
    metrics.record({ kind: 'provider-error', classification: 'quota' })
    metrics.record({ kind: 'runner-error', classification: 'resource-limit' })
    metrics.record({ kind: 'queue-depth', depth: 4 })
    metrics.record({ kind: 'attempt', attemptNumber: 1, attemptKind: 'generation' })
    metrics.record({ kind: 'attempt', attemptNumber: 2, attemptKind: 'repair' })
    metrics.record({ kind: 'resource-rejection', resource: 'memory' })

    expect(metricsSnapshotSchema.parse(metrics.snapshot())).toEqual({
      transitions: [
        { from: null, to: 'queued', count: 1 },
        { from: 'queued', to: 'compiling', count: 2 },
      ],
      verdicts: [{ verdict: 'rejected', count: 1 }],
      providerErrors: [{ classification: 'quota', count: 1 }],
      runnerErrors: [{ classification: 'resource-limit', count: 1 }],
      queueDepth: 4,
      attempts: [
        { attemptKind: 'generation', count: 1 },
        { attemptKind: 'repair', count: 1 },
      ],
      resourceRejections: [{ resource: 'memory', count: 1 }],
    })
  })

  it.each([
    { kind: 'queue-depth', depth: -1 },
    { kind: 'attempt', attemptNumber: 4, attemptKind: 'repair' },
    { kind: 'provider-error', classification: 'secret-provider-name' },
    { kind: 'runner-error', classification: 'raw-message' },
    { kind: 'resource-rejection', resource: 'host-path' },
    { kind: 'verdict', verdict: 'maybe' },
    { kind: 'verdict', verdict: 'verified', prompt: 'sensitive' },
  ])('rejects invalid or unbounded metric event %#', (event) => {
    expect(metricEventSchema.safeParse(event).success).toBe(false)
  })

  it('returns immutable detached snapshots', () => {
    const metrics = new LocalMetrics()
    metrics.record({ kind: 'queue-depth', depth: 1 })
    const first = metrics.snapshot()
    metrics.record({ kind: 'queue-depth', depth: 2 })
    expect(first.queueDepth).toBe(1)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.transitions)).toBe(true)
  })
})
