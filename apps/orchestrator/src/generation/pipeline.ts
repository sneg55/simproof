import type { ConceptSpec, GenerationRequest, GenerationState } from '@simproof/contracts'
import { generationRequestSchema } from '@simproof/contracts'

import { runGenerationAttempts } from './pipeline-attempt-loop.js'
import { compileConcept } from './pipeline-concept-step.js'
import type {
  AttemptCompletion,
  PipelineDependencies,
  PipelineRun,
  RecordedConcept,
} from './pipeline-types.js'

export interface ConceptCheckpoint {
  readonly run: PipelineRun
  readonly conceptSpec: ConceptSpec
  readonly recorded: RecordedConcept
}

export interface SplitGenerationPipeline {
  readonly accept: (
    input: unknown,
    options?: { readonly expectedVersionRevision?: number },
  ) => Promise<{
    readonly run: PipelineRun
    readonly created: boolean
    readonly request: GenerationRequest
  }>
  readonly compileAccepted: (
    request: GenerationRequest,
    initialRun: PipelineRun,
    signal?: AbortSignal,
  ) => Promise<ConceptCheckpoint | PipelineRun>
  readonly continueConfirmed: (
    initialRun: PipelineRun,
    conceptSpec: ConceptSpec,
    signal?: AbortSignal,
  ) => Promise<PipelineRun>
}

export type {
  GenerationJournal,
  PipelineDependencies,
  PipelineRun,
  PipelineRunner,
  PipelineRunnerResult,
  PipelineVerifier,
  ProviderCallMetering,
  ProviderDescriptor,
} from './pipeline-types.js'

export const createGenerationPipeline = (dependencies: PipelineDependencies) => ({
  async accept(
    input: unknown,
    options?: { readonly expectedVersionRevision?: number },
  ): Promise<{
    readonly run: PipelineRun
    readonly created: boolean
    readonly request: GenerationRequest
  }> {
    const request = generationRequestSchema.parse(input)
    const begun = await dependencies.journal.begin(request, dependencies.now(), options)
    const { created, ...run } = begun
    if (created) dependencies.signals?.accepted(run.id, request.simulationVersionId)
    return { run, created, request }
  },

  async compileAccepted(
    request: GenerationRequest,
    initialRun: PipelineRun,
    signal?: AbortSignal,
  ): Promise<ConceptCheckpoint | PipelineRun> {
    let run = initialRun
    const transition = async (to: GenerationState, details?: AttemptCompletion) => {
      const from = run.state
      run = await dependencies.journal.transition(run, to, dependencies.now(), details)
      dependencies.signals?.transition(run.id, from, to)
    }
    if (signal?.aborted === true) {
      await transition('cancelled')
      return run
    }
    await transition('compiling')
    const compilation = await compileConcept({
      run,
      prompt: request.prompt,
      dependencies,
      ...(signal === undefined ? {} : { signal }),
    })
    run = compilation.run
    if (!compilation.ok) {
      await transition(compilation.state, compilation.details)
      return run
    }
    const recorded = await dependencies.journal.recordConcept(
      run,
      compilation.conceptSpec,
      dependencies.now(),
    )
    return { run, conceptSpec: compilation.conceptSpec, recorded }
  },

  async continueConfirmed(
    initialRun: PipelineRun,
    conceptSpec: ConceptSpec,
    signal?: AbortSignal,
  ): Promise<PipelineRun> {
    let run = initialRun
    if (signal?.aborted === true) {
      const from = run.state
      run = await dependencies.journal.transition(run, 'cancelled', dependencies.now())
      dependencies.signals?.transition(run.id, from, 'cancelled')
      return run
    }
    if (run.state === 'compiling') {
      const from = run.state
      run = await dependencies.journal.transition(run, 'generating', dependencies.now())
      dependencies.signals?.transition(run.id, from, 'generating')
    } else if (run.state !== 'generating') {
      throw new TypeError('Generation confirmation state is invalid.')
    }
    return await runGenerationAttempts({
      conceptSpec,
      dependencies,
      initialRun: run,
      ...(signal === undefined ? {} : { signal }),
    })
  },

  async run(input: unknown, signal?: AbortSignal): Promise<PipelineRun> {
    const request = generationRequestSchema.parse(input)
    const begun = await dependencies.journal.begin(request, dependencies.now())
    const { created, ...run } = begun
    if (!created || run.state !== 'queued') return run
    dependencies.signals?.accepted(run.id, request.simulationVersionId)
    const execute = async () => {
      const split = createGenerationPipeline(dependencies)
      const compiled = await split.compileAccepted(request, run, signal)
      if (!('conceptSpec' in compiled)) return compiled
      return await split.continueConfirmed(compiled.run, compiled.conceptSpec, signal)
    }
    return dependencies.signals === undefined
      ? await execute()
      : await dependencies.signals.withRun(run.id, request.simulationVersionId, execute)
  },
})
