import { describe, expect, it } from 'vitest'

import { CorrelationContext } from './index.js'

const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const runId = '119f6bc1-0811-70c1-a139-938a3ad2dee0'
const attemptId = '219f6bc1-0811-70c1-a139-938a3ad2dee0'

describe('correlation context', () => {
  it('propagates validated context through asynchronous work without crossing requests', async () => {
    const context = new CorrelationContext()
    const first = context.run({ requestId }, async () => {
      await Promise.resolve()
      return context.current()
    })
    const second = context.run({ runId }, async () => {
      await Promise.resolve()
      return context.current()
    })
    await expect(Promise.all([first, second])).resolves.toEqual([{ requestId }, { runId }])
    expect(context.current()).toBeUndefined()
  })

  it('captures and explicitly rebinds immutable context for detached work', () => {
    const context = new CorrelationContext()
    const captured = context.run({ requestId, runId }, () => context.snapshot())
    expect(captured).toEqual({ requestId, runId })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(captured).toBeDefined()
    if (captured === undefined) return
    expect(context.rebind(captured, () => context.current())).toEqual({ requestId, runId })
  })

  it('binds a callback to an explicit snapshot', () => {
    const context = new CorrelationContext()
    const bound = context.bind({ runId }, (value: string) => ({
      value,
      current: context.current(),
    }))
    expect(bound('detached')).toEqual({ value: 'detached', current: { runId } })
  })

  it('enriches a run with an attempt and rejects correlation replacement', () => {
    const context = new CorrelationContext()
    context.run({ requestId, runId }, () => {
      expect(context.enrich({ attemptId })).toEqual({ requestId, runId, attemptId })
      expect(() => context.enrich({ runId: '319f6bc1-0811-70c1-a139-938a3ad2dee0' })).toThrow()
    })
  })

  it('rejects unknown fields and an attempt without its owning run', () => {
    const context = new CorrelationContext()
    expect(() => context.run({ requestId, cookie: 'sentinel' }, () => undefined)).toThrow()
    expect(() => context.run({ attemptId }, () => undefined)).toThrow()
  })
})
