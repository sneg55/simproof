import type { DatabaseSync } from 'node:sqlite'

import type { SimulationVersion, VerificationRun } from '@simproof/contracts'

import type { ArtifactStore } from './artifact-store.js'
import type { GenerationPipelineRun } from './generation-types.js'
import {
  type FinalizeReverificationInput,
  finalizeReverificationAggregate,
} from './reverification-finalization.js'
import { err, type InstalledEvidenceResolver, ok, type Result } from './types.js'
import { VerificationValidity } from './verification-validity.js'

export class ReverificationRepository {
  readonly #database: DatabaseSync
  readonly #getVersion: (id: string) => Result<SimulationVersion>
  readonly #getGenerationRun: (id: string) => Result<GenerationPipelineRun>
  readonly #canWrite: () => boolean
  readonly #serialize: <T>(operation: () => Promise<T>) => Promise<T>
  readonly #validity: VerificationValidity

  constructor(options: {
    readonly database: DatabaseSync
    readonly getVersion: (id: string) => Result<SimulationVersion>
    readonly getVerificationRun: (id: string) => Result<VerificationRun>
    readonly getGenerationRun: (id: string) => Result<GenerationPipelineRun>
    readonly canWrite: () => boolean
    readonly resolveInstalledEvidence: InstalledEvidenceResolver
    readonly serialize: <T>(operation: () => Promise<T>) => Promise<T>
  }) {
    this.#database = options.database
    this.#getVersion = options.getVersion
    this.#getGenerationRun = options.getGenerationRun
    this.#canWrite = options.canWrite
    this.#serialize = options.serialize
    this.#validity = new VerificationValidity({
      database: options.database,
      getVersion: options.getVersion,
      getRun: options.getVerificationRun,
      resolveInstalledEvidence: options.resolveInstalledEvidence,
      canWrite: options.canWrite,
    })
  }

  async finalize(
    input: FinalizeReverificationInput,
    store: ArtifactStore,
  ): Promise<Result<{ readonly version: SimulationVersion; readonly runId: string }>> {
    return await this.#serialize(async () => {
      if (!this.#canWrite()) return err('conflict', 'Persistence maintenance is active.')
      const validity = await this.#validity.forFinalization(input.verificationRunId, store)
      if (!validity.ok) return validity
      if (validity.value.status !== 'current') {
        return err('invalid-state', 'Reverification evidence is stale or corrupt.')
      }
      const finalized = finalizeReverificationAggregate({
        database: this.#database,
        getVersion: this.#getVersion,
        getRun: this.#getGenerationRun,
        input,
      })
      return finalized.ok
        ? ok({ version: finalized.value.version, runId: finalized.value.run.id })
        : finalized
    })
  }
}
