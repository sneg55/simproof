import type {
  GenerationExternalCall,
  GenerationPipelineAttempt,
  GenerationPipelineRun,
  GenerationPipelineTransition,
  GenerationProviderReservation,
} from './generation-types.js'

export function decodeGenerationRun(row: Record<string, unknown>): GenerationPipelineRun {
  return {
    id: String(row.id),
    simulationVersionId: String(row.simulation_version_id),
    idempotencyKeyHash: String(row.idempotency_key_hash),
    state: row.state as GenerationPipelineRun['state'],
    revision: Number(row.revision),
    maxAttempts: Number(row.max_attempts),
    budgets: {
      providerRequests: Number(row.max_provider_requests),
      inputTokens: Number(row.max_input_tokens),
      outputTokens: Number(row.max_output_tokens),
      costMicrousd: Number(row.max_cost_microusd),
      artifactBytes: Number(row.max_artifact_bytes),
    },
    usage: {
      providerRequests: Number(row.used_provider_requests),
      inputTokens: Number(row.used_input_tokens),
      outputTokens: Number(row.used_output_tokens),
      costMicrousd: Number(row.used_cost_microusd),
      artifactBytes: Number(row.used_artifact_bytes),
    },
    cancellationRequestedAt: row.cancellation_requested_at as string | null,
    terminalClassification:
      row.terminal_classification as GenerationPipelineRun['terminalClassification'],
    stableErrorId: row.stable_error_id as string | null,
    findingsReference: row.findings_reference as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at as string | null,
  }
}

export function decodeGenerationTransition(
  row: Record<string, unknown>,
): GenerationPipelineTransition {
  return {
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    from: row.from_state as GenerationPipelineTransition['from'],
    to: row.to_state as GenerationPipelineTransition['to'],
    transitionedAt: String(row.transitioned_at),
  }
}

export function decodeGenerationAttempt(row: Record<string, unknown>): GenerationPipelineAttempt {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    attemptNumber: Number(row.attempt_number),
    outcome: row.outcome as GenerationPipelineAttempt['outcome'],
    provider: String(row.provider),
    modelId: String(row.model_id),
    templateVersion: String(row.template_version),
    providerRequestId: row.provider_request_id as string | null,
    codexThreadId: row.codex_thread_id as string | null,
    artifactHash: row.artifact_hash as string | null,
    generatedArtifactId: row.generated_artifact_id as string | null,
    verificationRunId: row.verification_run_id as string | null,
    findingsReference: row.findings_reference as string | null,
    stableErrorId: row.stable_error_id as string | null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at as string | null,
  }
}

export function decodeExternalCall(row: Record<string, unknown>): GenerationExternalCall {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    attemptId: row.attempt_id as string | null,
    operation: row.operation as GenerationExternalCall['operation'],
    provider: String(row.provider),
    modelId: String(row.model_id),
    templateVersion: String(row.template_version),
    providerRequestId: row.provider_request_id as string | null,
    codexThreadId: row.codex_thread_id as string | null,
    stableErrorId: row.stable_error_id as string | null,
    usage: {
      providerRequests: Number(row.provider_requests),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      costMicrousd: Number(row.cost_microusd),
      artifactBytes: Number(row.artifact_bytes),
    },
    recordedAt: String(row.recorded_at),
  }
}

export function decodeProviderReservation(
  row: Record<string, unknown>,
): GenerationProviderReservation {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    attemptId: row.attempt_id as string | null,
    operation: row.operation as GenerationProviderReservation['operation'],
    provider: String(row.provider),
    modelId: String(row.model_id),
    templateVersion: String(row.template_version),
    reservedUsage: {
      providerRequests: Number(row.reserved_provider_requests),
      inputTokens: Number(row.reserved_input_tokens),
      outputTokens: Number(row.reserved_output_tokens),
      costMicrousd: Number(row.reserved_cost_microusd),
      artifactBytes: Number(row.reserved_artifact_bytes),
    },
    status: row.status as GenerationProviderReservation['status'],
    externalCallId: row.external_call_id as string | null,
    createdAt: String(row.created_at),
    reconciledAt: row.reconciled_at as string | null,
  }
}
