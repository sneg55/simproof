import type { ConceptSpec, GenerationRequest, GenerationState } from '@simproof/contracts'
import type {
  GenerationExternalOperation,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  PersistenceDatabase,
} from '@simproof/persistence'

import type { GenerationArtifactWriter } from './generation-artifact-writer.js'
import {
  GenerationJournalError,
  terminalClassification,
  unwrapJournalResult as unwrap,
} from './persistence-journal-mapping.js'
import { settleSimulationVersion } from './persistence-lifecycle.js'
import { PersistenceProviderJournal } from './persistence-provider-journal.js'
import type {
  AttemptCompletion,
  GeneratedArtifactSet,
  GenerationJournal,
  PipelineRun,
  ProviderDescriptor,
  RecordedConcept,
} from './pipeline-types.js'

interface PersistenceGenerationJournalOptions {
  readonly database: PersistenceDatabase
  readonly artifacts: GenerationArtifactWriter
  readonly id: () => string
}

const normalizedCompletion = (
  details: AttemptCompletion | undefined,
  generatedArtifactId: string | null,
) => ({
  artifactHash: details?.artifactHash ?? null,
  generatedArtifactId: details?.generatedArtifactId ?? generatedArtifactId,
  verificationRunId: details?.verificationRunId ?? null,
  findingsReference: details?.findingsReference ?? details?.findingsHash ?? null,
  stableErrorId: details?.stableErrorId ?? null,
})

export class PersistenceGenerationJournal implements GenerationJournal {
  readonly #database: PersistenceDatabase
  readonly #artifacts: GenerationArtifactWriter
  readonly #id: () => string
  readonly #providers: PersistenceProviderJournal

  constructor(options: PersistenceGenerationJournalOptions) {
    this.#database = options.database
    this.#artifacts = options.artifacts
    this.#id = options.id
    this.#providers = new PersistenceProviderJournal({
      database: this.#database,
      id: this.#id,
      attemptId: (runId, operation) => this.#attemptId(runId, operation),
      toRun: (runId) => this.#run(unwrap(this.#database.generation.get(runId))),
    })
  }

  #attempts(runId: string): readonly GenerationPipelineAttempt[] {
    return unwrap(this.#database.generation.attempts(runId))
  }

  #run(value: GenerationPipelineRun): PipelineRun {
    return {
      id: value.id,
      state: value.state,
      revision: value.revision,
      maxAttempts: value.maxAttempts,
      attemptCount: this.#attempts(value.id).length,
      budget: {
        limits: {
          maxProviderRequests: value.budgets.providerRequests,
          maxInputTokens: value.budgets.inputTokens,
          maxOutputTokens: value.budgets.outputTokens,
          maxCostMicrousd: value.budgets.costMicrousd,
          maxArtifactBytes: value.budgets.artifactBytes,
        },
        consumed: value.usage,
      },
    }
  }

  begin(
    request: GenerationRequest,
    at: string,
    options?: { readonly expectedVersionRevision?: number },
  ): PipelineRun & { readonly created: boolean } {
    const version = unwrap(this.#database.getVersion(request.simulationVersionId))
    const result = unwrap(
      this.#database.beginOrReplayGeneration({
        versionId: request.simulationVersionId,
        expectedRevision: options?.expectedVersionRevision ?? version.revision,
        idempotencyKey: request.idempotencyKey,
        updatedAt: at,
        run: {
          id: this.#id(),
          maxAttempts: request.maxAttempts,
          codexSessionId: null,
          createdAt: at,
        },
        budgets: {
          providerRequests: request.budget.maxProviderRequests,
          inputTokens: request.budget.maxInputTokens,
          outputTokens: request.budget.maxOutputTokens,
          costMicrousd: request.budget.maxCostMicrousd,
          artifactBytes: request.budget.maxArtifactBytes,
        },
      }),
    )
    return { ...this.#run(result.run), created: result.created }
  }

  async transition(
    run: PipelineRun,
    to: GenerationState,
    at: string,
    details?: AttemptCompletion,
  ): Promise<PipelineRun> {
    const classification = terminalClassification(to)
    if (classification === undefined) {
      return this.#run(
        unwrap(
          this.#database.generation.transition({
            runId: run.id,
            expectedRevision: run.revision,
            to,
            at,
          }),
        ),
      )
    }
    const durable = unwrap(this.#database.generation.get(run.id))
    await settleSimulationVersion({
      database: this.#database,
      store: this.#artifacts.store,
      run: durable,
      state: to,
      at,
      ...(details === undefined ? {} : { details }),
    })
    if (to === 'cancelled') {
      const cancelled = unwrap(
        this.#database.generation.requestCancellation({
          runId: run.id,
          expectedRevision: run.revision,
          at,
        }),
      )
      return this.#run(cancelled)
    }
    const transitioned = unwrap(
      this.#database.generation.transition({
        runId: run.id,
        expectedRevision: run.revision,
        to,
        at,
        terminalClassification: classification,
        ...(details?.stableErrorId === undefined ? {} : { stableErrorId: details.stableErrorId }),
        ...(to !== 'rejected' ||
        (details?.findingsReference === undefined && details?.findingsHash === undefined)
          ? {}
          : { findingsReference: details.findingsReference ?? details.findingsHash }),
      }),
    )
    return this.#run(transitioned)
  }

  startAttempt(
    run: PipelineRun,
    attemptNumber: number,
    provider: ProviderDescriptor,
    at: string,
  ): { readonly run: PipelineRun; readonly attemptId: string } {
    const attemptId = this.#id()
    unwrap(
      this.#database.generation.startAttempt({
        id: attemptId,
        runId: run.id,
        attemptNumber,
        provider: provider.provider,
        modelId: provider.model,
        templateVersion: provider.templateVersion,
        createdAt: at,
      }),
    )
    return {
      run: this.#run(unwrap(this.#database.generation.get(run.id))),
      attemptId,
    }
  }

  #attemptId(runId: string, operation: GenerationExternalOperation): string | null {
    if (operation === 'concept_compile') return null
    const attempt = this.#attempts(runId).at(-1)
    if (attempt === undefined) throw new GenerationJournalError('attempt-not-found')
    return attempt.id
  }

  reserveProviderCall(
    input: Parameters<GenerationJournal['reserveProviderCall']>[0],
  ): ReturnType<GenerationJournal['reserveProviderCall']> {
    return this.#providers.reserve(input)
  }

  releaseProviderReservation(
    input: Parameters<GenerationJournal['releaseProviderReservation']>[0],
  ): PipelineRun {
    return this.#providers.release(input)
  }

  recordProviderCall(input: Parameters<GenerationJournal['recordProviderCall']>[0]): PipelineRun {
    return this.#providers.recordCall(input)
  }

  recordProviderFailure(
    input: Parameters<GenerationJournal['recordProviderFailure']>[0],
  ): PipelineRun {
    return this.#providers.recordFailure(input)
  }

  async recordConcept(
    run: PipelineRun,
    conceptSpec: ConceptSpec,
    at: string,
  ): Promise<RecordedConcept> {
    const durable = unwrap(this.#database.generation.get(run.id))
    return await this.#artifacts.recordConcept({
      runId: run.id,
      simulationVersionId: durable.simulationVersionId,
      conceptSpec,
      createdAt: at,
    })
  }

  async recordCandidate(
    run: PipelineRun,
    attemptNumber: number,
    artifacts: GeneratedArtifactSet,
    at: string,
  ): Promise<{ readonly generatedArtifactId: string }> {
    const attempt = this.#attempts(run.id).find(
      (candidate) => candidate.attemptNumber === attemptNumber,
    )
    if (attempt === undefined) throw new GenerationJournalError('attempt-not-found')
    return await this.#artifacts.recordCandidate({
      runId: run.id,
      simulationVersionId: unwrap(this.#database.generation.get(run.id)).simulationVersionId,
      attemptId: attempt.id,
      artifacts,
      createdAt: at,
    })
  }

  async recordVerification({
    run,
    result,
    at,
  }: Parameters<GenerationJournal['recordVerification']>[0]): Promise<{
    readonly verificationRunId: string
    readonly findingsReference: string
  }> {
    if (result.report === undefined || result.dependencies === undefined) {
      throw new GenerationJournalError('verification-evidence-not-recorded')
    }
    const durable = unwrap(this.#database.generation.get(run.id))
    return await this.#artifacts.recordVerification({
      runId: run.id,
      simulationVersionId: durable.simulationVersionId,
      report: result.report,
      dependencies: result.dependencies,
      createdAt: at,
    })
  }

  completeAttempt({
    run,
    attemptNumber,
    outcome,
    at,
    details,
  }: Parameters<GenerationJournal['completeAttempt']>[0]): void {
    const attempt = this.#attempts(run.id).find(
      (candidate) => candidate.attemptNumber === attemptNumber,
    )
    if (attempt === undefined) throw new GenerationJournalError('attempt-not-found')
    const calls = unwrap(this.#database.generation.externalCalls(run.id)).filter(
      (call) => call.attemptId === attempt.id,
    )
    const lastCall = calls.at(-1)
    const completion = normalizedCompletion(details, attempt.generatedArtifactId)
    unwrap(
      this.#database.generation.completeAttempt({
        id: attempt.id,
        outcome,
        providerRequestId: lastCall?.providerRequestId ?? null,
        codexThreadId: lastCall?.codexThreadId ?? null,
        ...completion,
        completedAt: at,
      }),
    )
  }
}
