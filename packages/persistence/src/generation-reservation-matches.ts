import type {
  GenerationExternalCall,
  GenerationProviderReservation,
  GenerationUsage,
  ReserveExternalCallInput,
} from './generation-types.js'

export function addUsage(left: GenerationUsage, right: GenerationUsage): GenerationUsage {
  return {
    providerRequests: left.providerRequests + right.providerRequests,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costMicrousd: left.costMicrousd + right.costMicrousd,
    artifactBytes: left.artifactBytes + right.artifactBytes,
  }
}

export function subtractUsage(left: GenerationUsage, right: GenerationUsage): GenerationUsage {
  return {
    providerRequests: left.providerRequests - right.providerRequests,
    inputTokens: left.inputTokens - right.inputTokens,
    outputTokens: left.outputTokens - right.outputTokens,
    costMicrousd: left.costMicrousd - right.costMicrousd,
    artifactBytes: left.artifactBytes - right.artifactBytes,
  }
}

export function withinBudget(usage: GenerationUsage, budget: GenerationUsage): boolean {
  return (
    usage.providerRequests <= budget.providerRequests &&
    usage.inputTokens <= budget.inputTokens &&
    usage.outputTokens <= budget.outputTokens &&
    usage.costMicrousd <= budget.costMicrousd &&
    usage.artifactBytes <= budget.artifactBytes
  )
}

export function clampUsage(usage: GenerationUsage, budget: GenerationUsage): GenerationUsage {
  return {
    providerRequests: Math.min(usage.providerRequests, budget.providerRequests),
    inputTokens: Math.min(usage.inputTokens, budget.inputTokens),
    outputTokens: Math.min(usage.outputTokens, budget.outputTokens),
    costMicrousd: Math.min(usage.costMicrousd, budget.costMicrousd),
    artifactBytes: Math.min(usage.artifactBytes, budget.artifactBytes),
  }
}

export function reservationMatches(
  existing: GenerationProviderReservation,
  input: ReserveExternalCallInput,
): boolean {
  return (
    existing.id === input.id &&
    existing.runId === input.runId &&
    existing.attemptId === input.attemptId &&
    existing.operation === input.operation &&
    existing.provider === input.provider &&
    existing.modelId === input.modelId &&
    existing.templateVersion === input.templateVersion &&
    existing.createdAt === input.createdAt &&
    usageMatches(existing.reservedUsage, input.reservedUsage)
  )
}

export function callBelongsTo(
  reservation: GenerationProviderReservation,
  call: GenerationExternalCall,
): boolean {
  return (
    reservation.runId === call.runId &&
    reservation.attemptId === call.attemptId &&
    reservation.operation === call.operation &&
    reservation.provider === call.provider &&
    reservation.modelId === call.modelId &&
    reservation.templateVersion === call.templateVersion
  )
}

export function externalCallMatches(
  existing: GenerationExternalCall,
  input: GenerationExternalCall,
): boolean {
  return (
    existing.id === input.id &&
    existing.runId === input.runId &&
    existing.attemptId === input.attemptId &&
    existing.operation === input.operation &&
    existing.provider === input.provider &&
    existing.modelId === input.modelId &&
    existing.templateVersion === input.templateVersion &&
    existing.providerRequestId === input.providerRequestId &&
    existing.codexThreadId === input.codexThreadId &&
    existing.stableErrorId === input.stableErrorId &&
    existing.recordedAt === input.recordedAt &&
    usageMatches(existing.usage, input.usage)
  )
}

function usageMatches(left: GenerationUsage, right: GenerationUsage): boolean {
  return (
    left.providerRequests === right.providerRequests &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.costMicrousd === right.costMicrousd &&
    left.artifactBytes === right.artifactBytes
  )
}
