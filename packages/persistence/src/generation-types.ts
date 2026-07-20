import type { GenerationState } from '@simproof/contracts'

export type GenerationPipelineState = GenerationState

export type GenerationTerminalClassification =
  | 'verified'
  | 'scientific_rejection'
  | 'provider_failure'
  | 'runner_failure'
  | 'cancelled'
  | 'budget_exhaustion'
  | 'invariant_failure'

export interface GenerationBudgets {
  readonly providerRequests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costMicrousd: number
  readonly artifactBytes: number
}

export type GenerationUsage = GenerationBudgets

export interface GenerationPipelineRun {
  readonly id: string
  readonly simulationVersionId: string
  readonly idempotencyKeyHash: string
  readonly state: GenerationPipelineState
  readonly revision: number
  readonly maxAttempts: number
  readonly budgets: GenerationBudgets
  readonly usage: GenerationUsage
  readonly cancellationRequestedAt: string | null
  readonly terminalClassification: GenerationTerminalClassification | null
  readonly stableErrorId: string | null
  readonly findingsReference: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt: string | null
}

export interface GenerationPipelineTransition {
  readonly runId: string
  readonly sequence: number
  readonly from: GenerationPipelineState | null
  readonly to: GenerationPipelineState
  readonly transitionedAt: string
}

export type GenerationPipelineAttemptOutcome =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'provider_failed'
  | 'runner_failed'
  | 'malformed_response'
  | 'cancelled'
  | 'budget_exhausted'
  | 'invariant_failed'

export interface GenerationPipelineAttempt {
  readonly id: string
  readonly runId: string
  readonly attemptNumber: number
  readonly outcome: GenerationPipelineAttemptOutcome
  readonly provider: string
  readonly modelId: string
  readonly templateVersion: string
  readonly providerRequestId: string | null
  readonly codexThreadId: string | null
  readonly artifactHash: string | null
  readonly generatedArtifactId: string | null
  readonly verificationRunId: string | null
  readonly findingsReference: string | null
  readonly stableErrorId: string | null
  readonly createdAt: string
  readonly completedAt: string | null
}

export interface BeginGenerationInput {
  readonly versionId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly updatedAt: string
  readonly run: {
    readonly id: string
    readonly maxAttempts: number
    readonly codexSessionId: string | null
    readonly createdAt: string
  }
  readonly budgets: GenerationBudgets
}

export interface BeginReverificationInput {
  readonly versionId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly runId: string
  readonly attemptId: string
  readonly at: string
}

export interface StartGenerationAttemptInput {
  readonly id: string
  readonly runId: string
  readonly attemptNumber: number
  readonly provider: string
  readonly modelId: string
  readonly templateVersion: string
  readonly createdAt: string
}

export interface CompleteGenerationAttemptInput {
  readonly id: string
  readonly outcome: Exclude<GenerationPipelineAttemptOutcome, 'pending'>
  readonly providerRequestId: string | null
  readonly codexThreadId: string | null
  readonly artifactHash: string | null
  readonly generatedArtifactId: string | null
  readonly verificationRunId: string | null
  readonly findingsReference: string | null
  readonly stableErrorId?: string | null
  readonly completedAt: string
}

export type SettleGenerationConceptInput =
  | {
      readonly decision: 'accept'
      readonly runId: string
      readonly expectedRunRevision: number
      readonly expectedReviewRevision: number
      readonly expectedConceptHash: string
      readonly at: string
    }
  | {
      readonly decision: 'cancel' | 'invariant-failure'
      readonly runId: string
      readonly expectedRunRevision: number
      readonly expectedReviewRevision?: number
      readonly at: string
    }

export type GenerationExternalOperation = 'concept_compile' | 'code_generate' | 'code_repair'

export interface GenerationExternalCall {
  readonly id: string
  readonly runId: string
  readonly attemptId: string | null
  readonly operation: GenerationExternalOperation
  readonly provider: string
  readonly modelId: string
  readonly templateVersion: string
  readonly providerRequestId: string | null
  readonly codexThreadId: string | null
  readonly stableErrorId: string | null
  readonly usage: GenerationUsage
  readonly recordedAt: string
}

export type RecordExternalCallInput = Omit<GenerationExternalCall, 'usage'> & {
  readonly usage: GenerationUsage
}

export type GenerationProviderReservationStatus = 'pending' | 'reconciled' | 'not_dispatched'

export interface GenerationProviderReservation {
  readonly id: string
  readonly runId: string
  readonly attemptId: string | null
  readonly operation: GenerationExternalOperation
  readonly provider: string
  readonly modelId: string
  readonly templateVersion: string
  readonly reservedUsage: GenerationUsage
  readonly status: GenerationProviderReservationStatus
  readonly externalCallId: string | null
  readonly createdAt: string
  readonly reconciledAt: string | null
}

export type ReserveExternalCallInput = Pick<
  GenerationProviderReservation,
  | 'id'
  | 'runId'
  | 'attemptId'
  | 'operation'
  | 'provider'
  | 'modelId'
  | 'templateVersion'
  | 'reservedUsage'
  | 'createdAt'
>

export interface ReconcileExternalCallInput {
  readonly reservationId: string
  readonly call: RecordExternalCallInput
  readonly reconciledAt: string
}
