import type { ConceptSpec, RunnerDiagnostic, VerificationFinding } from '@simproof/contracts'

import {
  type Execution,
  type FailedStep,
  invariantFailure,
  type Step,
  type TerminalState,
} from './pipeline-attempt-support.js'
import { runProviderStep } from './pipeline-provider-step.js'
import type {
  AttemptCompletion,
  CodeResult,
  GeneratedArtifactSet,
  PipelineAttemptOutcome,
  PipelineDependencies,
  PipelineRun,
} from './pipeline-types.js'

type StoredCandidate = {
  readonly generatedArtifactId: string
  readonly artifacts: GeneratedArtifactSet
}

class AttemptCoordinator {
  readonly #dependencies: PipelineDependencies
  readonly #conceptSpec: ConceptSpec
  readonly #signal: AbortSignal | undefined
  readonly #activeThreadIds = new Set<string>()
  #run: PipelineRun
  #candidate: CodeResult | undefined
  #findings: readonly VerificationFinding[] = []
  #diagnostics: readonly RunnerDiagnostic[] = []

  constructor(options: {
    conceptSpec: ConceptSpec
    dependencies: PipelineDependencies
    initialRun: PipelineRun
    signal?: AbortSignal
  }) {
    this.#conceptSpec = options.conceptSpec
    this.#dependencies = options.dependencies
    this.#run = options.initialRun
    this.#signal = options.signal
  }

  async execute(): Promise<PipelineRun> {
    try {
      return await this.#executeAttempts()
    } catch (error) {
      await this.#disposeThreads()
      throw error
    }
  }

  async #executeAttempts(): Promise<PipelineRun> {
    for (let number = 1; number <= this.#run.maxAttempts; number += 1) {
      const started = await this.#dependencies.journal.startAttempt(
        this.#run,
        number,
        this.#dependencies.codeGenerator.descriptor,
        this.#dependencies.now(),
      )
      this.#run = started.run
      this.#dependencies.signals?.attemptStarted(this.#run.id, started.attemptId, number)
      const execute = async () => await this.#executeAttempt(number)
      const terminal =
        this.#dependencies.signals === undefined
          ? await execute()
          : await this.#dependencies.signals.withAttempt(this.#run.id, started.attemptId, execute)
      if (terminal !== undefined) return terminal
    }
    return await this.#finish('invariant_failed', invariantFailure)
  }

  async #executeAttempt(number: number): Promise<PipelineRun | undefined> {
    if (this.#aborted()) return await this.#cancelAttempt(number)
    const candidate = await this.#generateCandidate(number)
    if (!candidate.ok) return candidate.run
    await this.#transition('executing')
    const execution = await this.#executeCandidate(number, candidate.value.artifacts)
    if (!execution.ok) return execution.run
    return await this.#verifyCandidate(number, candidate.value, execution.value)
  }

  async #generateCandidate(number: number): Promise<Step<StoredCandidate>> {
    const result = await runProviderStep({
      run: this.#run,
      number,
      conceptSpec: this.#conceptSpec,
      ...(this.#candidate === undefined ? {} : { previous: this.#candidate }),
      findings: this.#findings,
      diagnostics: this.#diagnostics,
      dependencies: this.#dependencies,
      onThreadAdopted: (threadId) => this.#activeThreadIds.add(threadId),
      ...(this.#signal === undefined ? {} : { signal: this.#signal }),
    })
    this.#run = result.run
    if (!result.ok) return await this.#stopAttempt(number, result.state, result.details)
    if (result.code.threadId !== null) this.#activeThreadIds.add(result.code.threadId)
    if (this.#activeThreadIds.size > 1) {
      return await this.#stopAttempt(number, 'invariant_failed', invariantFailure)
    }
    this.#candidate = result.code
    return {
      ok: true,
      value: { generatedArtifactId: result.generatedArtifactId, artifacts: result.code.artifacts },
    }
  }

  async #executeCandidate(
    number: number,
    artifacts: GeneratedArtifactSet,
  ): Promise<Step<Execution>> {
    try {
      const result = await this.#dependencies.runner.execute(
        this.#conceptSpec,
        artifacts,
        this.#signal,
      )
      this.#diagnostics = result.diagnostics
      if (result.ok) {
        this.#dependencies.signals?.runnerCompleted()
        return this.#aborted()
          ? { ok: false, run: await this.#cancelAttempt(number) }
          : { ok: true, value: result }
      }
      const state = result.cancelled === true ? 'cancelled' : 'runner_failed'
      const details =
        state === 'runner_failed'
          ? { stableErrorId: result.stableErrorId ?? 'runner.execution-failed' }
          : undefined
      this.#dependencies.signals?.runnerCompleted(
        state === 'cancelled' ? 'runner.cancelled' : details?.stableErrorId,
      )
      return await this.#stopAttempt(number, state, details)
    } catch {
      if (this.#aborted()) {
        this.#dependencies.signals?.runnerCompleted('runner.cancelled')
        return { ok: false, run: await this.#cancelAttempt(number) }
      }
      this.#dependencies.signals?.runnerCompleted('runner.execution-failed')
      return await this.#stopAttempt(number, 'runner_failed', {
        stableErrorId: 'runner.execution-failed',
      })
    }
  }

  async #verifyCandidate(
    number: number,
    candidate: { generatedArtifactId: string },
    execution: Execution,
  ): Promise<PipelineRun | undefined> {
    await this.#transition('verifying')
    let verification
    try {
      verification = await this.#dependencies.verifier.verify(
        this.#conceptSpec,
        execution,
        this.#signal,
      )
    } catch {
      if (this.#aborted()) return await this.#cancelAttempt(number)
      this.#dependencies.signals?.verificationCompleted({
        errorId: 'orchestration.invariant-failed',
      })
      return (await this.#stopAttempt(number, 'invariant_failed', invariantFailure)).run
    }
    this.#dependencies.signals?.verificationCompleted({ verdict: verification.verdict })
    if (this.#aborted()) return await this.#cancelAttempt(number)
    this.#findings = verification.findings
    const durableVerification = await this.#dependencies.journal.recordVerification({
      run: this.#run,
      attemptNumber: number,
      result: verification,
      at: this.#dependencies.now(),
    })
    const details = {
      artifactHash: execution.artifactHash,
      reportHash: verification.reportHash,
      findingsHash: verification.findingsHash,
      generatedArtifactId: candidate.generatedArtifactId,
      verificationRunId: durableVerification.verificationRunId,
      findingsReference: durableVerification.findingsReference,
    }
    await this.#completeAttempt(number, verification.verdict, details)
    if (verification.verdict === 'verified') return await this.#finish('verified', details)
    if (number === this.#run.maxAttempts) return await this.#finish('rejected', details)
    await this.#transition('repairing', details)
    return undefined
  }

  async #stopAttempt(
    number: number,
    state: TerminalState,
    details?: AttemptCompletion,
  ): Promise<FailedStep> {
    const outcome =
      state === 'provider_failed' && details?.stableErrorId === 'provider.malformed-response'
        ? 'malformed_response'
        : state
    await this.#completeAttempt(number, outcome, details)
    return { ok: false, run: await this.#finish(state, details) }
  }

  async #cancelAttempt(number: number) {
    await this.#completeAttempt(number, 'cancelled')
    return await this.#finish('cancelled')
  }

  async #completeAttempt(
    attemptNumber: number,
    outcome: PipelineAttemptOutcome,
    details?: AttemptCompletion,
  ) {
    await this.#dependencies.journal.completeAttempt({
      run: this.#run,
      attemptNumber,
      outcome,
      at: this.#dependencies.now(),
      ...(details === undefined ? {} : { details }),
    })
  }

  async #finish(to: TerminalState, details?: AttemptCompletion) {
    const cleanupFailed = !(await this.#disposeThreads())
    return await this.#transition(
      cleanupFailed ? 'invariant_failed' : to,
      cleanupFailed ? invariantFailure : details,
    )
  }

  async #disposeThreads() {
    const disposed = await Promise.all(
      [...this.#activeThreadIds].map(async (threadId) => {
        try {
          return await this.#dependencies.codeGenerator.disposeThread(threadId)
        } catch {
          return false
        }
      }),
    )
    this.#activeThreadIds.clear()
    return disposed.every(Boolean)
  }

  async #transition(to: PipelineRun['state'], details?: AttemptCompletion) {
    const from = this.#run.state
    this.#run = await this.#dependencies.journal.transition(
      this.#run,
      to,
      this.#dependencies.now(),
      details,
    )
    this.#dependencies.signals?.transition(this.#run.id, from, to)
    return this.#run
  }

  #aborted() {
    return this.#signal?.aborted === true
  }
}

export const runGenerationAttempts = async (options: {
  readonly conceptSpec: ConceptSpec
  readonly dependencies: PipelineDependencies
  readonly initialRun: PipelineRun
  readonly signal?: AbortSignal
}) => await new AttemptCoordinator(options).execute()
