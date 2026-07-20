import type {
  CancelGenerationRequest,
  CancellationAccepted,
  ConceptReviewDecision,
  EducatorGenerationStartRequest,
  GenerationAccepted,
  GenerationStatus,
  NormalizedPreview,
  PreviewRequest,
  ReverifyVersionRequest,
} from '@simproof/contracts'
import type {
  ArtifactStore,
  InstalledEvidenceResolver,
  PersistenceDatabase,
} from '@simproof/persistence'
import type { FindingExplainer } from '@simproof/providers'

import type { ServerConfig } from '../config/environment.js'
import type { HttpOperationResult } from '../http/types.js'

export interface EducatorGenerationPort {
  start(
    input: EducatorGenerationStartRequest,
    sessionId: string,
  ): Promise<HttpOperationResult<GenerationAccepted>>
  status(runId: string, sessionId: string): Promise<HttpOperationResult<GenerationStatus>>
  decide(
    runId: string,
    input: ConceptReviewDecision,
    sessionId: string,
  ): Promise<HttpOperationResult<GenerationStatus>>
  cancel(
    runId: string,
    input: CancelGenerationRequest,
    sessionId: string,
  ): Promise<HttpOperationResult<CancellationAccepted>>
  reverify(
    versionId: string,
    input: ReverifyVersionRequest,
    sessionId: string,
  ): Promise<HttpOperationResult<GenerationAccepted>>
}

export interface EducatorPreviewPort {
  preview(
    versionId: string,
    input: PreviewRequest,
    sessionId: string,
  ): Promise<HttpOperationResult<NormalizedPreview>>
}

export interface EducatorServiceOptions {
  readonly database: PersistenceDatabase
  readonly artifacts: ArtifactStore
  readonly config: ServerConfig
  readonly bootstrapAvailable: () => boolean
  readonly authorizeSession: (sessionId: string) => boolean
  readonly confirmPassword: (password: string, sessionId: string) => Promise<boolean>
  readonly createId: () => string
  readonly now: () => string
  readonly resolveInstalledEvidence?: InstalledEvidenceResolver
  readonly generation?: EducatorGenerationPort
  readonly preview?: EducatorPreviewPort
  readonly generationDisabled?: boolean
  readonly findingExplainer?: FindingExplainer
}
