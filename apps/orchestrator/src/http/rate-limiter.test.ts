import { describe, expect, it } from 'vitest'

import { AuthAttemptLimiter, trustedClientSource } from './rate-limiter.js'

describe('bounded authentication abuse controls', () => {
  it('ignores spoofed forwarding unless the direct peer exactly matches the configured proxy', () => {
    expect(trustedClientSource('203.0.113.8', '198.51.100.9', '10.0.0.2')).toBe('203.0.113.8')
    expect(trustedClientSource('10.0.0.2', '198.51.100.9', '10.0.0.2')).toBe('198.51.100.9')
    expect(trustedClientSource('10.0.0.2', '198.51.100.9, 192.0.2.1', '10.0.0.2')).toBe('10.0.0.2')
  })

  it('bounds global/source attempts, hashing concurrency, and source-memory cardinality', () => {
    let now = 1_000
    const limiter = new AuthAttemptLimiter({
      windowMs: 60_000,
      globalAttempts: 4,
      sourceAttempts: 2,
      globalConcurrent: 2,
      sourceConcurrent: 1,
      maxTrackedSources: 2,
      now: () => now,
    })
    const first = limiter.acquire('one')
    expect(first.ok).toBe(true)
    expect(limiter.acquire('one')).toMatchObject({ ok: false, reason: 'concurrency' })
    if (first.ok) first.release()
    const second = limiter.acquire('one')
    expect(second.ok).toBe(true)
    if (second.ok) second.release()
    expect(limiter.acquire('one')).toMatchObject({ ok: false, reason: 'rate' })
    for (const source of ['two', 'three', 'four']) {
      const acquired = limiter.acquire(source)
      if (acquired.ok) acquired.release()
    }
    expect(limiter.trackedSources()).toBeLessThanOrEqual(2)
    now += 60_001
    const reset = limiter.acquire('one')
    expect(reset.ok).toBe(true)
    if (reset.ok) reset.release()
  })

  it('does not reset an unexpired source limit through source-cardinality churn', () => {
    const limiter = new AuthAttemptLimiter({
      sourceAttempts: 1,
      globalAttempts: 20,
      maxTrackedSources: 2,
    })
    const first = limiter.acquire('source-a')
    expect(first.ok).toBe(true)
    if (first.ok) first.release()
    const second = limiter.acquire('source-b')
    expect(second.ok).toBe(true)
    if (second.ok) second.release()
    expect(limiter.acquire('source-c')).toEqual({ ok: false, reason: 'rate' })
    expect(limiter.acquire('source-a')).toEqual({ ok: false, reason: 'rate' })
  })

  it('bounds password work independently by transport source and authenticated session', () => {
    const limiter = new AuthAttemptLimiter({
      sourceAttempts: 4,
      sessionAttempts: 1,
      globalAttempts: 20,
    })
    const first = limiter.acquire('source-a', 'session-a')
    expect(first.ok).toBe(true)
    if (first.ok) first.release()
    expect(limiter.acquire('source-a', 'session-a')).toEqual({ ok: false, reason: 'rate' })
    const otherSession = limiter.acquire('source-a', 'session-b')
    expect(otherSession.ok).toBe(true)
    if (otherSession.ok) otherSession.release()
    expect(limiter.acquire('source-b', 'session-a')).toEqual({ ok: false, reason: 'rate' })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-bounding numeric configuration %s',
    (sourceAttempts) => {
      expect(() => new AuthAttemptLimiter({ sourceAttempts })).toThrow(TypeError)
    },
  )
})
