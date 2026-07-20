import type { ProviderCallReservation } from './types.js'

export interface ProviderUsageCharge {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costMicrousd: number
}

export interface ProviderMeteringPolicyConfig {
  readonly estimateCostMicrousd: (usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }) => number
  readonly failedCallUsage: ProviderUsageCharge
}

const exhaustiveCharge: ProviderUsageCharge = {
  inputTokens: Number.MAX_SAFE_INTEGER,
  outputTokens: Number.MAX_SAFE_INTEGER,
  costMicrousd: Number.MAX_SAFE_INTEGER,
}

const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0
const validMaximum = (value: number) => Number.isSafeInteger(value) && value > 0

type UnvalidatedReservation = Omit<ProviderCallReservation, 'requestCount'> & {
  readonly requestCount: number
}

export const createProviderCallReservation = (
  value: UnvalidatedReservation,
): ProviderCallReservation => {
  if (
    !validMaximum(value.inputTokens) ||
    !validMaximum(value.outputTokens) ||
    value.requestCount !== 1 ||
    !validMaximum(value.costMicrousd)
  ) {
    throw new RangeError('Provider call reservations must contain positive safe-integer maxima')
  }
  return Object.freeze({ ...value, requestCount: 1 as const })
}

export const estimatedCostMicrousd = (
  policy: ProviderMeteringPolicyConfig,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
) => {
  try {
    const estimate = policy.estimateCostMicrousd(usage)
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0
    return validCount(estimate) && (!hasUsage || estimate > 0) ? estimate : Number.MAX_SAFE_INTEGER
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

export const failedCallUsage = (policy: ProviderMeteringPolicyConfig): ProviderUsageCharge => {
  const usage = policy.failedCallUsage
  const valid =
    validCount(usage.inputTokens) &&
    validCount(usage.outputTokens) &&
    validCount(usage.costMicrousd) &&
    usage.inputTokens + usage.outputTokens + usage.costMicrousd > 0
  return valid ? usage : exhaustiveCharge
}
