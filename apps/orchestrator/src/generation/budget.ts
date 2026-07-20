import { type GenerationBudget, generationBudgetSchema } from '@simproof/contracts'

export type BudgetDimension =
  | 'artifactBytes'
  | 'costMicrousd'
  | 'inputTokens'
  | 'outputTokens'
  | 'providerRequests'

export type BudgetCharge =
  | { readonly ok: true; readonly value: GenerationBudget }
  | { readonly ok: false; readonly dimension: BudgetDimension }

interface ProviderTurnUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requestCount: number
  readonly costMicrousd: number
}

export const canStartProviderTurn = ({ consumed, limits }: GenerationBudget): boolean =>
  consumed.providerRequests < limits.maxProviderRequests

const parseCharge = (budget: GenerationBudget, dimension: BudgetDimension): BudgetCharge => {
  const parsed = generationBudgetSchema.safeParse(budget)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, dimension }
}

export const chargeProviderTurn = (
  budget: GenerationBudget,
  usage: ProviderTurnUsage,
): BudgetCharge => {
  if (
    !Number.isSafeInteger(usage.requestCount) ||
    usage.requestCount < 0 ||
    budget.consumed.providerRequests + usage.requestCount > budget.limits.maxProviderRequests
  ) {
    return { ok: false, dimension: 'providerRequests' }
  }
  if (budget.consumed.inputTokens + usage.inputTokens > budget.limits.maxInputTokens) {
    return { ok: false, dimension: 'inputTokens' }
  }
  if (budget.consumed.outputTokens + usage.outputTokens > budget.limits.maxOutputTokens) {
    return { ok: false, dimension: 'outputTokens' }
  }
  if (budget.consumed.costMicrousd + usage.costMicrousd > budget.limits.maxCostMicrousd) {
    return { ok: false, dimension: 'costMicrousd' }
  }
  return parseCharge(
    {
      ...budget,
      consumed: {
        ...budget.consumed,
        providerRequests: budget.consumed.providerRequests + usage.requestCount,
        inputTokens: budget.consumed.inputTokens + usage.inputTokens,
        outputTokens: budget.consumed.outputTokens + usage.outputTokens,
        costMicrousd: budget.consumed.costMicrousd + usage.costMicrousd,
      },
    },
    'providerRequests',
  )
}

export const chargeArtifactBytes = (
  budget: GenerationBudget,
  artifactBytes: number,
): BudgetCharge => {
  if (
    !Number.isSafeInteger(artifactBytes) ||
    artifactBytes < 0 ||
    budget.consumed.artifactBytes + artifactBytes > budget.limits.maxArtifactBytes
  ) {
    return { ok: false, dimension: 'artifactBytes' }
  }
  return parseCharge(
    {
      ...budget,
      consumed: {
        ...budget.consumed,
        artifactBytes: budget.consumed.artifactBytes + artifactBytes,
      },
    },
    'artifactBytes',
  )
}
