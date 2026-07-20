import { randomUUID } from 'node:crypto'

import {
  type CancellationAccepted,
  type GenerationAccepted,
  type GenerationStatus,
  type ReverifyVersionRequest,
  reverifyVersionRequestSchema,
} from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'

import type { HttpOperationResult } from '../http/types.js'
import { GenerationArtifactWriter } from './generation-artifact-writer.js'
import { PersistenceGenerationCheckpoints } from './persistence-generation-checkpoints.js'
import type { GenerationSignals } from './pipeline-types.js'
import { loadReverificationInput } from './reverification-input-loader.js'
import { ReverificationLifecycle } from './reverification-lifecycle.js'
import type { TrustedRunnerAdapter } from './trusted-runner-adapter.js'
import type { TrustedVerifierAdapter } from './trusted-verifier-adapter.js'

type ReverificationInput = Awaited<ReturnType<typeof loadReverificationInput>>

export interface ReverificationServiceOptions {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly runner: TrustedRunnerAdapter
  readonly verifier: TrustedVerifierAdapter
  readonly id?: () => string
  readonly now?: () => string
  readonly signals?: GenerationSignals
}

const failure = (
  code: 'conflict' | 'invalid-input' | 'operation-failed',
  message: string,
): HttpOperationResult<never> => ({ ok: false, error: { code, message } })

export class ReverificationService {
  readonly #database: PersistenceDatabase
  readonly #store: ArtifactStore
  readonly #runner: TrustedRunnerAdapter
  readonly #verifier: TrustedVerifierAdapter
  readonly #artifacts: GenerationArtifactWriter
  readonly #checkpoints: PersistenceGenerationCheckpoints
  readonly #lifecycle: ReverificationLifecycle
  readonly #id: () => string
  readonly #now: () => string
  readonly #signals: GenerationSignals | undefined
  readonly #active = new Map<
    string,
    { readonly controller: AbortController; readonly promise: Promise<void> }
  >()
  #closed = false

  constructor(options: ReverificationServiceOptions) {
    this.#database = options.database
    this.#store = options.store
    this.#runner = options.runner
    this.#verifier = options.verifier
    this.#id = options.id ?? randomUUID
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#signals = options.signals
    this.#artifacts = new GenerationArtifactWriter({
      database: options.database,
      store: options.store,
      id: this.#id,
    })
    this.#checkpoints = new PersistenceGenerationCheckpoints({
      database: options.database,
      store: options.store,
      artifacts: this.#artifacts,
      id: this.#id,
      now: this.#now,
    })
    this.#lifecycle = new ReverificationLifecycle({
      database: options.database,
      now: this.#now,
      signals: options.signals,
    })
  }

  owns(runId: string): boolean {
    return this.#database.generation.isReverification(runId)
  }

  async start(
    versionId: string,
    input: ReverifyVersionRequest,
  ): Promise<HttpOperationResult<GenerationAccepted>> {
    if (this.#closed) return failure('operation-failed', 'Reverification service is unavailable.')
    const parsed = reverifyVersionRequestSchema.safeParse(input)
    if (!parsed.success) return failure('invalid-input', 'Reverification request is invalid.')
    const accepted = this.#database.generation.beginOrReplayReverification({
      versionId,
      expectedRevision: parsed.data.expectedRevision,
      idempotencyKey: parsed.data.idempotencyKey,
      runId: this.#id(),
      attemptId: this.#id(),
      at: this.#now(),
    })
    if (!accepted.ok) return this.#persistenceFailure(accepted.error.code)
    if (accepted.value.created) {
      this.#signals?.accepted(accepted.value.run.id, versionId, 'executing')
      this.#schedule(accepted.value.run.id, versionId)
    }
    if (!accepted.value.created) {
      const replay = await this.#checkpoints.status(accepted.value.run.id)
      if (!replay.ok) return this.#persistenceFailure(replay.error.code)
      return {
        ok: true,
        value: {
          runId: accepted.value.run.id,
          created: false,
          state: replay.value.state,
          revision: replay.value.revision,
        },
      }
    }
    return {
      ok: true,
      value: {
        runId: accepted.value.run.id,
        created: true,
        state: accepted.value.run.state,
        revision: accepted.value.run.revision,
      },
    }
  }

  async status(runId: string): Promise<HttpOperationResult<GenerationStatus>> {
    const status = await this.#checkpoints.status(runId)
    return status.ok ? status : this.#persistenceFailure(status.error.code)
  }

  cancel(
    runId: string,
    expectedRunRevision: number,
  ): Promise<HttpOperationResult<CancellationAccepted>> {
    if (!this.owns(runId))
      return Promise.resolve(failure('conflict', 'Reverification is not active.'))
    const current = this.#database.generation.get(runId)
    if (!current.ok || current.value.completedAt !== null) {
      return Promise.resolve(failure('conflict', 'Reverification is not active.'))
    }
    const at = this.#now()
    const cancelled = this.#database.generation.requestCancellation({
      runId,
      expectedRevision: expectedRunRevision,
      at,
    })
    if (!cancelled.ok) return Promise.resolve(this.#persistenceFailure(cancelled.error.code))
    this.#lifecycle.signal(runId, current.value.state, cancelled.value.state)
    this.#active.get(runId)?.controller.abort()
    return Promise.resolve({ ok: true, value: { runId, cancellationRequestedAt: at } })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const active = [...this.#active.values()]
    for (const operation of active) operation.controller.abort()
    await Promise.allSettled(active.map(({ promise }) => promise))
  }

  #schedule(runId: string, versionId: string): void {
    if (this.#active.has(runId)) return
    const controller = new AbortController()
    const operation = async () => await this.#execute(runId, versionId, controller.signal)
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        if (this.#signals === undefined) return await operation()
        await this.#signals.withRun(runId, versionId, operation)
      })
      .catch(() => this.#lifecycle.settleFailure(runId, controller.signal.aborted))
      .finally(() => {
        if (this.#active.get(runId)?.controller === controller) this.#active.delete(runId)
        this.#signals?.queueDepth(this.#active.size)
      })
    this.#active.set(runId, { controller, promise })
    this.#signals?.queueDepth(this.#active.size)
  }

  async #execute(runId: string, versionId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const loaded = await loadReverificationInput({
      database: this.#database,
      store: this.#store,
      artifactWriter: this.#artifacts,
      runId,
      versionId,
    })
    this.#signals?.attemptStarted(runId, loaded.attemptId, 1)
    const execute = async () => await this.#executeAttempt(runId, versionId, loaded, signal)
    if (this.#signals === undefined) return await execute()
    await this.#signals.withAttempt(runId, loaded.attemptId, execute)
  }

  async #executeAttempt(
    runId: string,
    versionId: string,
    loaded: ReverificationInput,
    signal: AbortSignal,
  ): Promise<void> {
    const execution = await this.#runner.execute(loaded.concept, loaded.artifacts, signal)
    this.#signals?.runnerCompleted(execution.ok ? undefined : execution.stableErrorId)
    if (!execution.ok) {
      if (execution.cancelled || signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      const run = this.#unwrap(this.#database.generation.get(runId))
      this.#unwrap(
        this.#database.generation.completeAttempt({
          id: loaded.attemptId,
          outcome: 'runner_failed',
          providerRequestId: null,
          codexThreadId: null,
          artifactHash: null,
          generatedArtifactId: loaded.generatedArtifactId,
          verificationRunId: null,
          findingsReference: null,
          stableErrorId: execution.stableErrorId ?? 'runner.execution-failed',
          completedAt: this.#now(),
        }),
      )
      this.#lifecycle.transition(runId, run.revision, 'runner_failed', {
        terminalClassification: 'runner_failure',
        stableErrorId: execution.stableErrorId ?? 'runner.execution-failed',
      })
      return
    }
    let run = this.#unwrap(this.#database.generation.get(runId))
    run = this.#lifecycle.transition(runId, run.revision, 'verifying')
    const verified = await this.#verifier.verify(loaded.concept, execution, signal)
    this.#signals?.verificationCompleted({ verdict: verified.verdict })
    const recorded = await this.#artifacts.recordVerification({
      runId,
      simulationVersionId: versionId,
      report: verified.report,
      dependencies: verified.dependencies,
      createdAt: this.#now(),
    })
    signal.throwIfAborted()
    const version = this.#unwrap(this.#database.getVersion(versionId))
    this.#unwrap(
      await this.#database.reverification.finalize(
        {
          versionId,
          expectedVersionRevision: version.revision,
          runId,
          attemptId: loaded.attemptId,
          expectedRunRevision: run.revision,
          verificationRunId: recorded.verificationRunId,
          artifactHash: execution.artifactHash,
          findingsReference: recorded.findingsReference,
          outcome: verified.verdict,
          at: this.#now(),
        },
        this.#store,
      ),
    )
    this.#lifecycle.signal(runId, 'verifying', verified.verdict)
  }

  #unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (result.ok) return result.value
    throw new TypeError('Reverification persistence operation failed.')
  }

  #persistenceFailure(code: string): HttpOperationResult<never> {
    return code === 'conflict' || code === 'invalid-state'
      ? failure('conflict', 'Reverification changed concurrently or is unavailable in this state.')
      : code === 'invalid-input'
        ? failure('invalid-input', 'Reverification input is invalid.')
        : failure('operation-failed', 'Reverification operation failed.')
  }
}
