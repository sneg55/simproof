import type {
  ConceptCompilationResult,
  ConceptSpec,
  FindingExplanation,
  GenerationError,
  ProviderProvenance,
  RunnerDiagnostic,
  VerificationFinding,
} from '@simproof/contracts'

export const GENERATED_ARTIFACT_PATHS = [
  'core.mjs',
  'renderer.json',
  'manifest.json',
  'test-adapter.json',
] as const

export type GeneratedArtifactPath = (typeof GENERATED_ARTIFACT_PATHS)[number]

export interface GeneratedArtifact<Path extends GeneratedArtifactPath = GeneratedArtifactPath> {
  readonly path: Path
  readonly content: string
}

export interface GeneratedArtifactSet {
  readonly core: GeneratedArtifact<'core.mjs'>
  readonly renderer: GeneratedArtifact<'renderer.json'>
  readonly manifest: GeneratedArtifact<'manifest.json'>
  readonly testAdapter: GeneratedArtifact<'test-adapter.json'>
}

export type ProviderFailureKind =
  | 'authentication'
  | 'quota'
  | 'transient'
  | 'refusal'
  | 'schema-validation'
  | 'cancellation'
  | 'artifact-scope'
  | 'provider-response'

export interface ProviderCallMetering {
  readonly provider: 'openai-responses' | 'codex-sdk' | 'fake'
  readonly model: string
  readonly templateVersion: string
  readonly requestIds: readonly string[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly requestCount: number
    readonly costMicrousd: number
  }
}

export interface ProviderDescriptor {
  readonly provider: ProviderCallMetering['provider']
  readonly model: string
  readonly templateVersion: string
}

export interface ProviderCallReservation {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requestCount: 1
  readonly costMicrousd: number
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: GenerationError
      readonly kind: ProviderFailureKind
      readonly metering: ProviderCallMetering
    }

export interface ProviderCallOptions {
  readonly signal?: AbortSignal
}

export interface ConceptCompilationRequest {
  readonly prompt: string
}

export interface ConceptCompiler {
  readonly descriptor: ProviderDescriptor
  readonly compileReservation: ProviderCallReservation
  compile(
    request: ConceptCompilationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<ConceptCompilationResult>>
}

export interface FindingExplanationRequest {
  readonly conceptSpec: ConceptSpec
  readonly verdict: 'rejected' | 'inapplicable'
  readonly findings: readonly VerificationFinding[]
}

export interface FindingExplainer {
  readonly descriptor: ProviderDescriptor
  readonly explainReservation: ProviderCallReservation
  explain(
    request: FindingExplanationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<FindingExplanation>>
}

export interface CodeGenerationRequest {
  readonly conceptSpec: ConceptSpec
}

export interface CodeRepairRequest extends CodeGenerationRequest {
  readonly threadId: string | null
  readonly previousArtifacts: GeneratedArtifactSet
  readonly findings: readonly VerificationFinding[]
  readonly diagnostics: readonly RunnerDiagnostic[]
}

export interface CodeGenerationResult {
  readonly artifacts: GeneratedArtifactSet
  readonly threadId: string | null
  readonly provenance: ProviderProvenance
}

export interface CodeGenerator {
  readonly descriptor: ProviderDescriptor
  readonly generateReservation: ProviderCallReservation
  readonly repairReservation: ProviderCallReservation
  disposeThread(threadId: string): Promise<boolean>
  disposeOrphanedState(retainedThreadIds?: readonly string[]): Promise<boolean>
  generate(
    request: CodeGenerationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<CodeGenerationResult>>
  repair(
    request: CodeRepairRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<CodeGenerationResult>>
}
