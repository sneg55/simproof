import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'
import {
  DurableGenerationCoordinator,
  type DurableGenerationCoordinatorOptions,
} from './durable-generation-coordinator.js'
import { GenerationArtifactWriter } from './generation-artifact-writer.js'
import { GenerationService } from './generation-service.js'
import { PersistenceGenerationCheckpoints } from './persistence-generation-checkpoints.js'
import { PersistenceGenerationJournal } from './persistence-journal.js'
import { createGenerationPipeline } from './pipeline.js'
import type {
  GenerationSignals,
  PipelineDependencies,
  PipelineRunner,
  PipelineVerifier,
} from './pipeline-types.js'

export interface GenerationCompositionOptions {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly conceptCompiler: PipelineDependencies['conceptCompiler']
  readonly codeGenerator: PipelineDependencies['codeGenerator']
  readonly runner: PipelineRunner
  readonly verifier: PipelineVerifier
  readonly id: () => string
  readonly now: () => string
  readonly observability?: GenerationSignals
}

export function createGenerationComposition(
  options: GenerationCompositionOptions,
): GenerationService {
  const artifacts = new GenerationArtifactWriter({
    database: options.database,
    store: options.store,
    id: options.id,
  })
  const journal = new PersistenceGenerationJournal({
    database: options.database,
    artifacts,
    id: options.id,
  })
  const pipeline = createGenerationPipeline({
    conceptCompiler: options.conceptCompiler,
    codeGenerator: options.codeGenerator,
    journal,
    runner: options.runner,
    verifier: options.verifier,
    now: options.now,
    ...(options.observability === undefined ? {} : { signals: options.observability }),
  })
  const stateCleanup = Promise.resolve().then(
    async () => await options.codeGenerator.disposeOrphanedState([]),
  )
  return new GenerationService({
    run: async (request, signal) => {
      if (!(await stateCleanup)) throw new TypeError('Codex state cleanup failed.')
      return await pipeline.run(request, signal)
    },
  })
}

export function createDurableGenerationComposition(
  options: GenerationCompositionOptions & {
    readonly recordPromptDecision: DurableGenerationCoordinatorOptions['recordPromptDecision']
  },
): DurableGenerationCoordinator {
  const artifacts = new GenerationArtifactWriter({
    database: options.database,
    store: options.store,
    id: options.id,
  })
  const journal = new PersistenceGenerationJournal({
    database: options.database,
    artifacts,
    id: options.id,
  })
  const pipeline = createGenerationPipeline({
    conceptCompiler: options.conceptCompiler,
    codeGenerator: options.codeGenerator,
    journal,
    runner: options.runner,
    verifier: options.verifier,
    now: options.now,
    ...(options.observability === undefined ? {} : { signals: options.observability }),
  })
  const stateCleanup = Promise.resolve().then(
    async () => await options.codeGenerator.disposeOrphanedState([]),
  )
  const checkedPipeline = {
    accept: (...input: Parameters<typeof pipeline.accept>) => pipeline.accept(...input),
    compileAccepted: async (...input: Parameters<typeof pipeline.compileAccepted>) => {
      if (!(await stateCleanup)) throw new TypeError('Codex state cleanup failed.')
      return await pipeline.compileAccepted(...input)
    },
    continueConfirmed: async (...input: Parameters<typeof pipeline.continueConfirmed>) => {
      if (!(await stateCleanup)) throw new TypeError('Codex state cleanup failed.')
      return await pipeline.continueConfirmed(...input)
    },
  }
  const checkpoints = new PersistenceGenerationCheckpoints({
    database: options.database,
    store: options.store,
    artifacts,
    id: options.id,
    now: options.now,
  })
  return new DurableGenerationCoordinator({
    pipeline: checkedPipeline,
    checkpoints,
    recordPromptDecision: options.recordPromptDecision,
    ...(options.observability === undefined ? {} : { signals: options.observability }),
  })
}
