import { describe, expect, it, vi } from 'vitest'

import type { DurableGenerationCoordinator } from './durable-generation-coordinator.js'
import { createEducatorGenerationAdapter } from './educator-generation-adapter.js'

describe('educator generation adapter', () => {
  it('maps session-agnostic start/status/decide/cancel calls exactly', async () => {
    const startGeneration = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'invalid-input', message: 'x' } })
    const statusGeneration = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'invalid-input', message: 'x' } })
    const decideConcept = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'invalid-input', message: 'x' } })
    const cancelGeneration = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'invalid-input', message: 'x' } })
    const close = vi.fn().mockResolvedValue(undefined)
    const coordinator = {
      start: startGeneration,
      status: statusGeneration,
      decide: decideConcept,
      cancel: cancelGeneration,
      close,
    } as unknown as DurableGenerationCoordinator
    const adapter = createEducatorGenerationAdapter(coordinator)
    const start = { request: 'start' } as never
    const decision = { decision: 'accept' } as never
    await adapter.start(start, 'session-a')
    await adapter.status('run-a', 'session-b')
    await adapter.decide('run-a', decision, 'session-c')
    await adapter.cancel('run-a', { expectedRunRevision: 4 }, 'session-d')
    await adapter.close()
    expect(startGeneration).toHaveBeenCalledWith(start)
    expect(statusGeneration).toHaveBeenCalledWith('run-a')
    expect(decideConcept).toHaveBeenCalledWith('run-a', decision)
    expect(cancelGeneration).toHaveBeenCalledWith('run-a', 4)
    expect(close).toHaveBeenCalledOnce()
  })

  it('fails closed when no reverification service is configured', async () => {
    const coordinator = { close: vi.fn() } as unknown as DurableGenerationCoordinator
    await expect(
      createEducatorGenerationAdapter(coordinator).reverify(
        'version-a',
        { expectedRevision: 1, idempotencyKey: 'reverify:test:1' },
        'session-a',
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'operation-failed',
        message: 'Generation service is unavailable.',
      },
    })
  })
})
