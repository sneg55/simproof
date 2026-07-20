import type { GenerationRequest, GenerationState } from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import { GenerationService, type GenerationServicePipeline } from './generation-service.js'
import type { PipelineRun } from './pipeline-types.js'

const request = (idempotencyKey = 'generation:service:test'): GenerationRequest => ({
  schemaVersion: '1',
  simulationVersionId: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey,
  prompt: 'Build a pendulum.',
  maxAttempts: 3,
  budget: {
    maxProviderRequests: 4,
    maxInputTokens: 1_000,
    maxOutputTokens: 1_000,
    maxCostMicrousd: 10_000,
    maxArtifactBytes: 100_000,
  },
})

const run = (state: GenerationState = 'verified'): PipelineRun => ({
  id: 'run-service-1',
  state,
  revision: 4,
  maxAttempts: 3,
  attemptCount: 1,
  budget: {
    limits: request().budget,
    consumed: {
      providerRequests: 2,
      inputTokens: 10,
      outputTokens: 20,
      costMicrousd: 30,
      artifactBytes: 40,
    },
  },
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

describe('GenerationService', () => {
  it('validates input before dispatch with a stable redacted failure', async () => {
    const pipeline = { run: vi.fn() } satisfies GenerationServicePipeline
    const service = new GenerationService(pipeline)

    const result = await service.start({ ...request(), prompt: '', unexpected: 'secret' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid-input', message: 'Generation request is invalid.' },
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(pipeline.run).not.toHaveBeenCalled()
  })

  it('coalesces concurrent keys to one promise, controller, and pipeline dispatch', async () => {
    const pending = deferred<PipelineRun>()
    const pipeline = { run: vi.fn(() => pending.promise) } satisfies GenerationServicePipeline
    const service = new GenerationService(pipeline)
    const input = request()

    const first = service.start(input)
    const second = service.start({ ...input })

    expect(second).toBe(first)
    expect(pipeline.run).toHaveBeenCalledTimes(1)
    expect(pipeline.run).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    pending.resolve(run())
    await expect(first).resolves.toEqual({ ok: true, value: run() })
  })

  it('propagates cancellation by idempotency key and clears terminal entries', async () => {
    const pending = deferred<PipelineRun>()
    let dispatchedSignal: AbortSignal | undefined
    const pipeline: GenerationServicePipeline = {
      run: vi.fn((_input, signal) => {
        dispatchedSignal = signal
        return pending.promise
      }),
    }
    const service = new GenerationService(pipeline)
    const first = service.start(request())

    expect(service.cancel(request().idempotencyKey)).toEqual({
      ok: true,
      value: { idempotencyKey: request().idempotencyKey, cancellationRequested: true },
    })
    expect(dispatchedSignal?.aborted).toBe(true)
    pending.resolve(run('cancelled'))
    await first
    expect(service.cancel(request().idempotencyKey)).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Generation is not active.' },
    })

    const next = service.start(request())
    expect(next).not.toBe(first)
    expect(pipeline.run).toHaveBeenCalledTimes(2)
  })

  it('redacts thrown errors and permits a fresh dispatch after rejection cleanup', async () => {
    const secret = 'provider-secret-error-text'
    const pipeline = {
      run: vi
        .fn<GenerationServicePipeline['run']>()
        .mockRejectedValueOnce(new Error(secret))
        .mockResolvedValueOnce(run()),
    }
    const service = new GenerationService(pipeline)

    const failed = await service.start(request())
    expect(failed).toEqual({
      ok: false,
      error: { code: 'operation-failed', message: 'Generation could not be completed.' },
    })
    expect(JSON.stringify(failed)).not.toContain(secret)

    await expect(service.start(request())).resolves.toEqual({ ok: true, value: run() })
    expect(pipeline.run).toHaveBeenCalledTimes(2)
  })

  it('isolates different idempotency keys and rejects invalid cancellation keys', async () => {
    const pending = [deferred<PipelineRun>(), deferred<PipelineRun>()] as const
    const pipeline = {
      run: vi
        .fn<GenerationServicePipeline['run']>()
        .mockReturnValueOnce(pending[0].promise)
        .mockReturnValueOnce(pending[1].promise),
    }
    const service = new GenerationService(pipeline)

    const first = service.start(request('generation:service:first'))
    const second = service.start(request('generation:service:second'))
    expect(first).not.toBe(second)
    expect(pipeline.run).toHaveBeenCalledTimes(2)
    expect(service.cancel('bad')).toEqual({
      ok: false,
      error: { code: 'invalid-input', message: 'Generation idempotency key is invalid.' },
    })

    pending[0].resolve(run())
    pending[1].resolve({ ...run(), id: 'run-service-2' })
    await Promise.all([first, second])
  })

  it('aborts and drains active work before closing and rejects later starts', async () => {
    let signal: AbortSignal | undefined
    const runPipeline = vi.fn<GenerationServicePipeline['run']>((_request, dispatchedSignal) => {
      signal = dispatchedSignal
      return new Promise<PipelineRun>((resolve) => {
        dispatchedSignal.addEventListener('abort', () => resolve(run('cancelled')), {
          once: true,
        })
      })
    })
    const pipeline: GenerationServicePipeline = { run: runPipeline }
    const service = new GenerationService(pipeline)
    const active = service.start(request())

    const closing = service.close()

    expect(signal?.aborted).toBe(true)
    await expect(active).resolves.toMatchObject({ ok: true, value: { state: 'cancelled' } })
    await expect(closing).resolves.toBeUndefined()
    expect(service.close()).toBe(closing)
    await expect(service.start(request('generation:service:after-close'))).resolves.toEqual({
      ok: false,
      error: { code: 'operation-failed', message: 'Generation could not be completed.' },
    })
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })
})
