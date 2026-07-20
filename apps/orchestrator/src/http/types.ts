import type {
  ArchiveVersionRequest,
  BootstrapCapability,
  CancelGenerationRequest,
  CancellationAccepted,
  ConceptReviewDecision,
  CreateDraftRequest,
  DuplicateSimulationRequest,
  EducatorGenerationStartRequest,
  EducatorRuntimeConfig,
  EducatorSession,
  GenerationAccepted,
  GenerationStatus,
  LibraryPage,
  LibraryQuery,
  NormalizedPreview,
  PortableSimulationExport,
  PreviewRequest,
  PublishVersionRequest,
  ReverifyVersionRequest,
  SeedMetadata,
  SimulationDetail,
  SimulationExportCommand,
  StartBlankVersionRequest,
  VerificationReportDisplay,
  VersionComparison,
  VersionHistory,
} from '@simproof/contracts'
import type { Correlation, CorrelationContext, StructuredLogger } from '@simproof/observability'
import type { ServerConfig } from '../config/environment.js'
import type { ReadinessReport } from '../operations/readiness.js'
import type { FailureDiagnostic } from './failure-diagnostic.js'

export type RequestCorrelation = Correlation & { readonly requestId: string }

export interface HttpRequest {
  readonly requestId?: string
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body?: Uint8Array | AsyncIterable<Uint8Array>
  readonly peerAddress: string
}

export interface HttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  // Internal-only failure diagnostic for the operational log. Never serialized to the client:
  // the node server writes body/status/headers, so this stays server-side (see failure-diagnostic).
  readonly diagnostic?: FailureDiagnostic
}

export type HttpOperationFailureCode =
  | 'confirmation-failed'
  | 'conflict'
  | 'invalid-input'
  | 'not-found'
  | 'operation-failed'

type AuthSuccess<T> = { readonly ok: true; readonly value: T }
type AuthFailure = {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}
export type AuthOutcome<T> = AuthSuccess<T> | AuthFailure

export type HttpOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code: HttpOperationFailureCode
        readonly message: string
        // Stable, bounded identifier for the specific fail-closed cause (e.g.
        // 'educator.preview-evidence-mismatch'). Surfaced in the operational log, never to the
        // client. Optional: absent failures still get a failureClass derived from the code.
        readonly detail?: string
      }
    }

type MaybePromise<T> = T | Promise<T>

export interface EducatorHttpCallbacks {
  bootstrapCapability(): MaybePromise<HttpOperationResult<BootstrapCapability>>
  runtimeConfig(sessionId: string): MaybePromise<HttpOperationResult<EducatorRuntimeConfig>>
  listSeeds(sessionId: string): MaybePromise<HttpOperationResult<readonly SeedMetadata[]>>
  getSeed(seedId: string, sessionId: string): MaybePromise<HttpOperationResult<SimulationDetail>>
  getSeedReport(
    seedId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<VerificationReportDisplay>>
  previewSeed(
    seedId: string,
    input: PreviewRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<NormalizedPreview>>
  listSimulations(
    query: LibraryQuery,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<LibraryPage>>
  getSimulation(
    simulationId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  createSimulation(
    input: CreateDraftRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  versionHistory(
    simulationId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<VersionHistory>>
  compareVersions(
    simulationId: string,
    leftVersionId: string,
    rightVersionId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<VersionComparison>>
  startBlankVersion(
    simulationId: string,
    input: StartBlankVersionRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  duplicateSimulation(
    simulationId: string,
    input: DuplicateSimulationRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  startGeneration(
    input: EducatorGenerationStartRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<GenerationAccepted>>
  generationStatus(
    runId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<GenerationStatus>>
  decideConcept(
    runId: string,
    input: ConceptReviewDecision,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<GenerationStatus>>
  cancelGeneration(
    runId: string,
    input: CancelGenerationRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<CancellationAccepted>>
  getReport(
    versionId: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<VerificationReportDisplay>>
  publishVersion(
    versionId: string,
    input: PublishVersionRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  archiveVersion(
    versionId: string,
    input: ArchiveVersionRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<SimulationDetail>>
  reverifyVersion(
    versionId: string,
    input: ReverifyVersionRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<GenerationAccepted>>
  exportSimulation(
    input: SimulationExportCommand,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<PortableSimulationExport>>
  previewVersion(
    versionId: string,
    input: PreviewRequest,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<NormalizedPreview>>
}

export interface HttpAuthService {
  bootstrap(input: unknown): Promise<AuthOutcome<{ readonly credentialVersion: number }>>
  login(input: unknown, replaceSessionToken?: string): Promise<AuthOutcome<IssuedSession>>
  authenticate(
    sessionToken: string,
    csrfToken?: string,
  ): AuthOutcome<{ readonly sessionId: string; readonly expiresAt: string }>
  session(sessionToken: string): AuthOutcome<EducatorSession>
  rotate(sessionToken: string, csrfToken: string): AuthOutcome<IssuedSession>
  logout(sessionToken: string): AuthOutcome<true>
  changePassword(input: {
    readonly currentPassword: string
    readonly newPassword: string
  }): Promise<AuthOutcome<{ readonly credentialVersion: number }>>
}

export interface IssuedSession {
  readonly sessionToken: string
  readonly csrfToken: string
  readonly expiresAt: string
}

export interface HttpCallbacks {
  health(correlation: RequestCorrelation): unknown
  readiness(correlation: RequestCorrelation): MaybePromise<ReadinessReport>
  getPrivacy(sessionId: string): MaybePromise<HttpOperationResult<unknown>>
  updatePrivacy(value: unknown, sessionId: string): MaybePromise<HttpOperationResult<unknown>>
  exportData(password: string, sessionId: string): MaybePromise<HttpOperationResult<unknown>>
  deleteSimulation(
    simulationId: string,
    password: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<unknown>>
  startGeneration(value: unknown, sessionId: string): MaybePromise<HttpOperationResult<unknown>>
  cancelGeneration(
    idempotencyKey: string,
    sessionId: string,
  ): MaybePromise<HttpOperationResult<unknown>>
  readonly educator?: EducatorHttpCallbacks
}

export interface HttpApiOptions {
  readonly auth: HttpAuthService
  readonly config: ServerConfig
  readonly callbacks: HttpCallbacks
  readonly correlationContext?: Pick<CorrelationContext, 'run'>
  readonly createRequestId?: () => string
  readonly logger?: StructuredLogger
  readonly limiterOptions?: ConstructorParameters<
    typeof import('./rate-limiter.js').AuthAttemptLimiter
  >[0]
}
