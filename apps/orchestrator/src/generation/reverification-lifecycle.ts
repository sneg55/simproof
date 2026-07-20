import type {
  GenerationPipelineRun,
  GenerationPipelineState,
  GenerationTerminalClassification,
  PersistenceDatabase,
} from '@simproof/persistence'

import type { GenerationSignals } from './pipeline-types.js'

interface ReverificationLifecycleOptions {
  readonly database: PersistenceDatabase
  readonly now: () => string
  readonly signals: GenerationSignals | undefined
}

interface TransitionMetadata {
  readonly terminalClassification?: GenerationTerminalClassification
  readonly stableErrorId?: string
  readonly findingsReference?: string
}

export class ReverificationLifecycle {
  constructor(readonly options: ReverificationLifecycleOptions) {}

  transition(
    runId: string,
    revision: number,
    to: GenerationPipelineState,
    metadata: TransitionMetadata = {},
  ): GenerationPipelineRun {
    const from = this.#unwrap(this.options.database.generation.get(runId)).state
    const transitioned = this.#unwrap(
      this.options.database.generation.transition({
        runId,
        expectedRevision: revision,
        to,
        at: this.options.now(),
        ...metadata,
      }),
    )
    this.signal(runId, from, transitioned.state)
    return transitioned
  }

  signal(runId: string, from: GenerationPipelineState, to: GenerationPipelineState): void {
    this.options.signals?.transition(runId, from, to)
  }

  settleFailure(runId: string, cancelled: boolean): void {
    const run = this.options.database.generation.get(runId)
    if (!run.ok || run.value.completedAt !== null) return
    const settled = cancelled
      ? this.options.database.generation.requestCancellation({
          runId,
          expectedRevision: run.value.revision,
          at: this.options.now(),
        })
      : this.options.database.generation.settleConcept({
          decision: 'invariant-failure',
          runId,
          expectedRunRevision: run.value.revision,
          at: this.options.now(),
        })
    if (settled.ok) this.signal(runId, run.value.state, settled.value.state)
  }

  #unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (result.ok) return result.value
    throw new TypeError('Reverification persistence operation failed.')
  }
}
