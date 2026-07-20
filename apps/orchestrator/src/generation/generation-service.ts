import {
  type GenerationRequest,
  generationIdempotencyKeySchema,
  generationRequestSchema,
} from '@simproof/contracts'

import type { HttpOperationResult } from '../http/types.js'
import type { PipelineRun } from './pipeline-types.js'

export interface GenerationServicePipeline {
  readonly run: (input: GenerationRequest, signal: AbortSignal) => Promise<PipelineRun>
}

export interface GenerationCancellation {
  readonly idempotencyKey: string
  readonly cancellationRequested: true
}

interface ActiveGeneration {
  readonly controller: AbortController
  readonly promise: Promise<HttpOperationResult<PipelineRun>>
}

const invalidRequest = (): HttpOperationResult<never> => ({
  ok: false,
  error: { code: 'invalid-input', message: 'Generation request is invalid.' },
})

const invalidKey = (): HttpOperationResult<never> => ({
  ok: false,
  error: { code: 'invalid-input', message: 'Generation idempotency key is invalid.' },
})

const inactiveGeneration = (): HttpOperationResult<never> => ({
  ok: false,
  error: { code: 'conflict', message: 'Generation is not active.' },
})

const operationFailure = (): HttpOperationResult<never> => ({
  ok: false,
  error: { code: 'operation-failed', message: 'Generation could not be completed.' },
})

export class GenerationService {
  readonly #pipeline: GenerationServicePipeline
  readonly #active = new Map<string, ActiveGeneration>()
  #closePromise: Promise<void> | undefined

  constructor(pipeline: GenerationServicePipeline) {
    this.#pipeline = pipeline
  }

  start(input: unknown): Promise<HttpOperationResult<PipelineRun>> {
    if (this.#closePromise !== undefined) return Promise.resolve(operationFailure())
    const parsed = generationRequestSchema.safeParse(input)
    if (!parsed.success) return Promise.resolve(invalidRequest())
    const key = parsed.data.idempotencyKey
    const active = this.#active.get(key)
    if (active !== undefined) return active.promise
    return this.#dispatch(parsed.data)
  }

  cancel(input: unknown): HttpOperationResult<GenerationCancellation> {
    const parsed = generationIdempotencyKeySchema.safeParse(input)
    if (!parsed.success) return invalidKey()
    const active = this.#active.get(parsed.data)
    if (active === undefined) return inactiveGeneration()
    active.controller.abort()
    return {
      ok: true,
      value: { idempotencyKey: parsed.data, cancellationRequested: true },
    }
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    for (const active of this.#active.values()) active.controller.abort()
    this.#closePromise = Promise.allSettled(
      [...this.#active.values()].map(({ promise }) => promise),
    ).then(() => undefined)
    return this.#closePromise
  }

  #dispatch(request: GenerationRequest): Promise<HttpOperationResult<PipelineRun>> {
    const controller = new AbortController()
    let pipelineRun: Promise<PipelineRun>
    try {
      pipelineRun = this.#pipeline.run(request, controller.signal)
    } catch {
      return Promise.resolve(operationFailure())
    }
    const result = pipelineRun.then<
      HttpOperationResult<PipelineRun>,
      HttpOperationResult<PipelineRun>
    >(
      (run) => ({ ok: true, value: run }),
      () => operationFailure(),
    )
    const tracked = result.finally(() => {
      if (this.#active.get(request.idempotencyKey)?.promise === tracked) {
        this.#active.delete(request.idempotencyKey)
      }
    })
    this.#active.set(request.idempotencyKey, { controller, promise: tracked })
    return tracked
  }
}
