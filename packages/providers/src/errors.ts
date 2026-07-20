import type { GenerationError } from '@simproof/contracts'

import type { ProviderCallMetering, ProviderFailureKind, ProviderResult } from './types.js'

const errors = {
  authentication: {
    category: 'authentication',
    stableErrorId: 'provider.authentication-failed',
    retryable: false,
  },
  quota: {
    category: 'quota',
    stableErrorId: 'provider.quota-exceeded',
    retryable: false,
  },
  transient: {
    category: 'transient',
    stableErrorId: 'provider.transient-failure',
    retryable: true,
  },
  malformed: {
    category: 'malformed-response',
    stableErrorId: 'provider.malformed-response',
    retryable: false,
  },
  cancellation: {
    category: 'cancellation',
    stableErrorId: 'generation.cancelled',
    retryable: false,
  },
  invariant: {
    category: 'invariant',
    stableErrorId: 'orchestration.invariant-failed',
    retryable: false,
  },
} as const satisfies Record<string, GenerationError>

export const providerErrors = errors

export const providerFailure = (
  error: GenerationError,
  kind: ProviderFailureKind,
  metering: ProviderCallMetering,
): ProviderResult<never> => ({ ok: false, error, kind, metering })

const statusOf = (value: unknown): number | undefined => {
  if (typeof value !== 'object' || value === null || !('status' in value)) return undefined
  return typeof value.status === 'number' ? value.status : undefined
}

const nameOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('name' in value)) return undefined
  return typeof value.name === 'string' ? value.name : undefined
}

const codeOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined
  return typeof value.code === 'string' ? value.code : undefined
}

export const providerRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('requestID' in value)) return undefined
  return typeof value.requestID === 'string' && value.requestID.length > 0
    ? value.requestID
    : undefined
}

export const classifyProviderException = (
  value: unknown,
  metering: ProviderCallMetering,
  signal?: AbortSignal,
): ProviderResult<never> => {
  const status = statusOf(value)
  const name = nameOf(value)
  const code = codeOf(value)
  if (signal?.aborted === true || name === 'AbortError' || name === 'APIUserAbortError') {
    return providerFailure(errors.cancellation, 'cancellation', metering)
  }
  if (status === 401 || status === 403 || name === 'AuthenticationError') {
    return providerFailure(errors.authentication, 'authentication', metering)
  }
  if (status === 429 && code === 'insufficient_quota') {
    return providerFailure(errors.quota, 'quota', metering)
  }
  if (status === 429 || name === 'RateLimitError') {
    return providerFailure(errors.transient, 'transient', metering)
  }
  return providerFailure(errors.transient, 'transient', metering)
}
