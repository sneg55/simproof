import type {
  ConceptCompilationResult,
  ConceptSpec,
  GenerationBudget,
  GenerationError,
  GenerationRequest,
  GenerationState,
  ProviderProvenance,
  RunnerBinding,
  RunnerDiagnostic,
  VerificationDependencyBinding,
  VerificationFinding,
  VerificationReport,
} from '@simproof/contracts'
import type { ProviderCallReservation } from '@simproof/providers'

export interface GeneratedArtifactSet {
  readonly core: { readonly path: 'core.mjs'; readonly content: string }
  readonly renderer: { readonly path: 'renderer.json'; readonly content: string }
  readonly manifest: { readonly path: 'manifest.json'; readonly content: string }
  readonly testAdapter: { readonly path: 'test-adapter.json'; readonly content: string }
}

type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: GenerationError
      readonly kind: string
      readonly metering: ProviderCallMetering
    }

export interface ProviderDescriptor {
  readonly provider: 'codex-sdk' | 'fake' | 'openai-responses'
  readonly model: string
  readonly templateVersion: string
}

export interface ProviderCallMetering extends ProviderDescriptor {
  readonly requestIds: readonly string[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly requestCount: number
    readonly costMicrousd: number
  }
}

interface ConceptCompilerPort {
  readonly descriptor: ProviderDescriptor
  readonly compileReservation: ProviderCallReservation
  readonly compile: (
    request: { readonly prompt: string },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ProviderResult<ConceptCompilationResult>>
}

export interface CodeResult {
  readonly artifacts: GeneratedArtifactSet
  readonly threadId: string | null
  readonly provenance: ProviderProvenance
}

interface CodeGeneratorPort {
  readonly descriptor: ProviderDescriptor
  readonly generateReservation: ProviderCallReservation
  readonly repairReservation: ProviderCallReservation
  readonly disposeThread: (threadId: string) => Promise<boolean>
  readonly disposeOrphanedState: (retainedThreadIds?: readonly string[]) => Promise<boolean>
  readonly generate: (
    request: { readonly conceptSpec: ConceptSpec },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ProviderResult<CodeResult>>
  readonly repair: (
    request: {
      readonly conceptSpec: ConceptSpec
      readonly previousArtifacts: GeneratedArtifactSet
      readonly threadId: string | null
      readonly findings: readonly VerificationFinding[]
      readonly diagnostics: readonly RunnerDiagnostic[]
    },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ProviderResult<CodeResult>>
}

export interface PipelineRun {
  readonly id: string
  readonly state: GenerationState
  readonly revision: number
  readonly maxAttempts: number
  readonly attemptCount: number
  readonly budget: GenerationBudget
}

export type VerificationCompletionSignal =
  | { readonly verdict: 'verified' | 'rejected' | 'inapplicable' }
  | { readonly errorId: 'orchestration.invariant-failed' }

export interface GenerationSignals {
  readonly withRun: <Result>(
    runId: string,
    simulationId: string | undefined,
    operation: () => Result,
  ) => Result
  readonly withAttempt: <Result>(
    runId: string,
    attemptId: string,
    operation: () => Result,
  ) => Result
  readonly accepted: (
    runId: string,
    simulationId: string,
    initialState?: PipelineRun['state'],
  ) => void
  readonly transition: (runId: string, from: GenerationState, to: GenerationState) => void
  readonly runFailed: (runId: string, detail: string) => void
  readonly attemptStarted: (runId: string, attemptId: string, attemptNumber: number) => void
  readonly providerCompleted: (
    operation: 'concept-compile' | 'code-generate' | 'code-repair',
    errorId?: string,
  ) => void
  readonly runnerCompleted: (errorId?: string) => void
  readonly verificationCompleted: (result: VerificationCompletionSignal) => void
  readonly queueDepth: (depth: number) => void
}

export interface AttemptCompletion {
  readonly artifactHash?: `sha256:${string}`
  readonly reportHash?: `sha256:${string}`
  readonly findingsHash?: `sha256:${string}`
  readonly stableErrorId?: string
  readonly generatedArtifactId?: string
  readonly verificationRunId?: string
  readonly findingsReference?: string
}

export interface RecordedConcept {
  readonly id: string
  readonly hash: `sha256:${string}`
}

interface ProviderCallRecord {
  readonly run: PipelineRun
  readonly reservationId: string
  readonly operation: 'code_generate' | 'code_repair' | 'concept_compile'
  readonly provenance: ProviderProvenance
  readonly artifactBytes: number
  readonly at: string
}

interface ProviderFailureRecord {
  readonly run: PipelineRun
  readonly reservationId: string
  readonly operation: ProviderCallRecord['operation']
  readonly metering: ProviderCallMetering
  readonly stableErrorId: string
  readonly at: string
}

interface ProviderReservationRecord {
  readonly run: PipelineRun
  readonly operation: ProviderCallRecord['operation']
  readonly provider: ProviderDescriptor
  readonly reservation: ProviderCallReservation
  readonly artifactBytes: number
  readonly at: string
}

interface AttemptCompletionRecord {
  readonly run: PipelineRun
  readonly attemptNumber: number
  readonly outcome: PipelineAttemptOutcome
  readonly at: string
  readonly details?: AttemptCompletion
}

interface VerificationRecord {
  readonly run: PipelineRun
  readonly attemptNumber: number
  readonly result: PipelineVerificationResult
  readonly at: string
}

export type PipelineAttemptOutcome =
  | 'verified'
  | 'rejected'
  | 'provider_failed'
  | 'runner_failed'
  | 'malformed_response'
  | 'cancelled'
  | 'budget_exhausted'
  | 'invariant_failed'

type JournalValue<T> = Promise<T> | T

export interface GenerationJournal {
  readonly begin: (
    request: GenerationRequest,
    at: string,
    options?: { readonly expectedVersionRevision?: number },
  ) => JournalValue<PipelineRun & { readonly created: boolean }>
  readonly transition: (
    run: PipelineRun,
    to: GenerationState,
    at: string,
    details?: AttemptCompletion,
  ) => JournalValue<PipelineRun>
  readonly startAttempt: (
    run: PipelineRun,
    attemptNumber: number,
    provider: ProviderDescriptor,
    at: string,
  ) => JournalValue<{ readonly run: PipelineRun; readonly attemptId: string }>
  readonly reserveProviderCall: (
    input: ProviderReservationRecord,
  ) => JournalValue<
    | { readonly ok: true; readonly run: PipelineRun; readonly reservationId: string }
    | { readonly ok: false; readonly run: PipelineRun }
  >
  readonly releaseProviderReservation: (input: {
    readonly run: PipelineRun
    readonly reservationId: string
    readonly at: string
  }) => JournalValue<PipelineRun>
  readonly recordProviderCall: (input: ProviderCallRecord) => JournalValue<PipelineRun>
  readonly recordProviderFailure: (input: ProviderFailureRecord) => JournalValue<PipelineRun>
  readonly recordConcept: (
    run: PipelineRun,
    conceptSpec: ConceptSpec,
    at: string,
  ) => JournalValue<RecordedConcept>
  readonly recordCandidate: (
    run: PipelineRun,
    attemptNumber: number,
    artifacts: GeneratedArtifactSet,
    at: string,
  ) => JournalValue<{ readonly generatedArtifactId: string }>
  readonly recordVerification: (
    input: VerificationRecord,
  ) => JournalValue<{ readonly verificationRunId: string; readonly findingsReference: string }>
  readonly completeAttempt: (input: AttemptCompletionRecord) => JournalValue<void>
}

export type PipelineRunnerResult =
  | {
      readonly ok: true
      readonly artifactHash: `sha256:${string}`
      readonly observations: readonly unknown[]
      readonly diagnostics: readonly RunnerDiagnostic[]
      readonly verificationInput?: {
        readonly artifactSource: string
        readonly runner: RunnerBinding
      }
    }
  | {
      readonly ok: false
      readonly cancelled?: boolean
      readonly stableErrorId?: string
      readonly diagnostics: readonly RunnerDiagnostic[]
    }

export interface PipelineRunner {
  readonly execute: (
    conceptSpec: ConceptSpec,
    artifacts: GeneratedArtifactSet,
    signal?: AbortSignal,
  ) => Promise<PipelineRunnerResult>
}

export interface PipelineVerificationResult {
  readonly verdict: 'rejected' | 'verified'
  readonly reportHash: `sha256:${string}`
  readonly findingsHash: `sha256:${string}`
  readonly findings: readonly VerificationFinding[]
  readonly report?: VerificationReport
  readonly dependencies?: VerificationDependencyBinding
}

export interface PipelineVerifier {
  readonly verify: (
    conceptSpec: ConceptSpec,
    execution: Extract<PipelineRunnerResult, { readonly ok: true }>,
    signal?: AbortSignal,
  ) => Promise<PipelineVerificationResult>
}

export interface PipelineDependencies {
  readonly conceptCompiler: ConceptCompilerPort
  readonly codeGenerator: CodeGeneratorPort
  readonly journal: GenerationJournal
  readonly runner: PipelineRunner
  readonly verifier: PipelineVerifier
  readonly now: () => string
  readonly signals?: GenerationSignals
}
