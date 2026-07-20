import { describe, expect, it } from 'vitest'

import {
  createStructuredLogger,
  LocalLogStore,
  type OperationalEventId,
  type SignalSeverity,
} from './index.js'

const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'

const input = (event: OperationalEventId, severity: SignalSeverity = 'info') => ({
  severity,
  component: 'web-api' as const,
  event,
  correlation: { requestId },
})

describe('bounded structured logging', () => {
  it('retains only the newest configured entry count', () => {
    let now = Date.parse('2026-07-17T12:00:00.000Z')
    const clock = () => now
    const store = new LocalLogStore({ maxEntries: 2, maxAgeMs: 60_000 }, clock)
    const logger = createStructuredLogger({ sink: store, clock })

    logger.emit(input('generation.accepted'))
    now += 1
    logger.emit(input('generation.transition'))
    now += 1
    logger.emit(input('generation.transition.persisted'))

    expect(store.recent().map(({ event }) => event)).toEqual([
      'generation.transition',
      'generation.transition.persisted',
    ])
  })

  it('evicts records older than the local retention window', () => {
    let now = Date.parse('2026-07-17T12:00:00.000Z')
    const clock = () => now
    const store = new LocalLogStore({ maxEntries: 10, maxAgeMs: 1_000 }, clock)
    const logger = createStructuredLogger({ sink: store, clock })
    logger.emit(input('generation.accepted'))
    now += 1_001
    logger.emit(input('generation.transition'))
    expect(store.recent().map(({ event }) => event)).toEqual(['generation.transition'])
  })

  it('applies severity sampling without ever sampling out errors', () => {
    const store = new LocalLogStore({ maxEntries: 10, maxAgeMs: 60_000 })
    const logger = createStructuredLogger({
      sink: store,
      random: () => 0.9,
      sampling: { debug: 0, info: 0.5, warn: 1, error: 0 },
    })
    expect(logger.emit(input('generation.accepted', 'debug'))).toBe(false)
    expect(logger.emit(input('generation.transition', 'info'))).toBe(false)
    expect(logger.emit(input('generation.transition.persisted', 'warn'))).toBe(true)
    expect(logger.emit(input('persistence.migration.failed', 'error'))).toBe(true)
    expect(store.recent().map(({ event }) => event)).toEqual([
      'generation.transition.persisted',
      'persistence.migration.failed',
    ])
  })

  it.each([
    { name: 'zero rate at draw zero', rate: 0, draw: 0, retained: false },
    { name: 'draw below rate', rate: 0.5, draw: 0.499_999, retained: true },
    { name: 'draw at rate', rate: 0.5, draw: 0.5, retained: false },
    { name: 'draw one', rate: 1, draw: 1, retained: false },
    { name: 'NaN draw', rate: 1, draw: Number.NaN, retained: false },
    { name: 'negative draw', rate: 1, draw: -0.1, retained: false },
    { name: 'draw above one', rate: 1, draw: 1.1, retained: false },
  ])('uses exact non-error sampling semantics for $name', ({ rate, draw, retained }) => {
    const store = new LocalLogStore({ maxEntries: 10, maxAgeMs: 60_000 })
    const logger = createStructuredLogger({
      sink: store,
      random: () => draw,
      sampling: { debug: rate, info: rate, warn: rate, error: 0 },
    })
    expect(logger.emit(input('generation.accepted'))).toBe(retained)
    expect(store.recent()).toHaveLength(retained ? 1 : 0)
  })

  it('retains errors without consulting the random source or configured error rate', () => {
    const store = new LocalLogStore({ maxEntries: 10, maxAgeMs: 60_000 })
    const logger = createStructuredLogger({
      sink: store,
      random: () => {
        throw new Error('error sampling must not draw randomness')
      },
      sampling: { debug: 0, info: 0, warn: 0, error: 0 },
    })
    expect(logger.emit(input('persistence.migration.failed', 'error'))).toBe(true)
    expect(store.recent()).toHaveLength(1)
  })

  it('returns immutable snapshots and enforces a bounded query limit', () => {
    const store = new LocalLogStore({ maxEntries: 2, maxAgeMs: 60_000 })
    const logger = createStructuredLogger({ sink: store })
    logger.emit(input('http.request.completed'))
    const snapshot = store.recent({ limit: 1 })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(() => store.recent({ limit: 3 })).toThrow()
  })
})
