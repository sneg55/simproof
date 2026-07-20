import { createHash } from 'node:crypto'

import type {
  BeginGenerationInput,
  CompleteGenerationAttemptInput,
  GenerationBudgets,
  RecordExternalCallInput,
  StartGenerationAttemptInput,
} from './generation-types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^sha256:[0-9a-f]{64}$/u

export function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function validOpaque(value: unknown, max = 200): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= max &&
    !/[\r\n\0]/u.test(value)
  )
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export function validBudgets(value: unknown): value is GenerationBudgets {
  if (typeof value !== 'object' || value === null) return false
  if (
    !exactKeys(value, [
      'providerRequests',
      'inputTokens',
      'outputTokens',
      'costMicrousd',
      'artifactBytes',
    ])
  )
    return false
  const budget = value as Record<string, unknown>
  return (
    positiveInteger(budget.providerRequests) &&
    positiveInteger(budget.inputTokens) &&
    positiveInteger(budget.outputTokens) &&
    positiveInteger(budget.costMicrousd) &&
    positiveInteger(budget.artifactBytes)
  )
}

export function validUsage(value: unknown): value is GenerationBudgets {
  if (typeof value !== 'object' || value === null) return false
  if (
    !exactKeys(value, [
      'providerRequests',
      'inputTokens',
      'outputTokens',
      'costMicrousd',
      'artifactBytes',
    ])
  )
    return false
  const usage = value as Record<string, unknown>
  return (
    positiveInteger(usage.providerRequests) &&
    nonnegativeInteger(usage.inputTokens) &&
    nonnegativeInteger(usage.outputTokens) &&
    nonnegativeInteger(usage.costMicrousd) &&
    nonnegativeInteger(usage.artifactBytes)
  )
}

// eslint-disable-next-line complexity -- This strict process-boundary parser validates every nested field and rejects unknown keys before persistence.
export function parseBeginInput(input: unknown): BeginGenerationInput | null {
  if (typeof input !== 'object' || input === null) return null
  if (
    !exactKeys(input, [
      'versionId',
      'expectedRevision',
      'idempotencyKey',
      'updatedAt',
      'run',
      'budgets',
    ])
  )
    return null
  const value = input as Record<string, unknown>
  if (typeof value.run !== 'object' || value.run === null) return null
  if (!exactKeys(value.run, ['id', 'maxAttempts', 'codexSessionId', 'createdAt'])) return null
  const run = value.run as Record<string, unknown>
  if (
    !validId(value.versionId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0 ||
    typeof value.idempotencyKey !== 'string' ||
    value.idempotencyKey.length < 8 ||
    value.idempotencyKey.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value.idempotencyKey) ||
    !validTimestamp(value.updatedAt) ||
    !validId(run.id) ||
    !Number.isSafeInteger(run.maxAttempts) ||
    Number(run.maxAttempts) < 1 ||
    Number(run.maxAttempts) > 3 ||
    (run.codexSessionId !== null && !validOpaque(run.codexSessionId)) ||
    !validTimestamp(run.createdAt) ||
    !validBudgets(value.budgets)
  )
    return null
  return input as BeginGenerationInput
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function validStartAttempt(input: unknown): input is StartGenerationAttemptInput {
  if (typeof input !== 'object' || input === null) return false
  if (
    !exactKeys(input, [
      'id',
      'runId',
      'attemptNumber',
      'provider',
      'modelId',
      'templateVersion',
      'createdAt',
    ])
  )
    return false
  const value = input as Record<string, unknown>
  return (
    validId(value.id) &&
    validId(value.runId) &&
    Number.isSafeInteger(value.attemptNumber) &&
    Number(value.attemptNumber) >= 1 &&
    Number(value.attemptNumber) <= 3 &&
    validOpaque(value.provider, 100) &&
    validOpaque(value.modelId) &&
    validOpaque(value.templateVersion, 100) &&
    validTimestamp(value.createdAt)
  )
}

// eslint-disable-next-line complexity -- Attempt completion is a strict union boundary with nullable provenance fields validated independently.
export function validCompleteAttempt(input: unknown): input is CompleteGenerationAttemptInput {
  if (typeof input !== 'object' || input === null) return false
  const permitted = [
    'id',
    'outcome',
    'providerRequestId',
    'codexThreadId',
    'artifactHash',
    'generatedArtifactId',
    'verificationRunId',
    'findingsReference',
    'stableErrorId',
    'completedAt',
  ]
  if (
    Object.keys(input).some((key) => !permitted.includes(key)) ||
    !permitted.filter((key) => key !== 'stableErrorId').every((key) => key in input)
  )
    return false
  const value = input as Record<string, unknown>
  const outcomes = [
    'verified',
    'rejected',
    'provider_failed',
    'runner_failed',
    'malformed_response',
    'cancelled',
    'budget_exhausted',
    'invariant_failed',
  ]
  return (
    validId(value.id) &&
    typeof value.outcome === 'string' &&
    outcomes.includes(value.outcome) &&
    (value.providerRequestId === null || validOpaque(value.providerRequestId)) &&
    (value.codexThreadId === null || validOpaque(value.codexThreadId)) &&
    (value.artifactHash === null ||
      (typeof value.artifactHash === 'string' && SHA256.test(value.artifactHash))) &&
    (value.generatedArtifactId === null || validId(value.generatedArtifactId)) &&
    (value.verificationRunId === null || validId(value.verificationRunId)) &&
    (value.findingsReference === null || validOpaque(value.findingsReference)) &&
    (value.stableErrorId === undefined ||
      value.stableErrorId === null ||
      validOpaque(value.stableErrorId)) &&
    validTimestamp(value.completedAt)
  )
}

// eslint-disable-next-line complexity -- External-call provenance has operation-dependent lineage requirements that must be checked at one boundary.
export function validExternalCall(input: unknown): input is RecordExternalCallInput {
  if (typeof input !== 'object' || input === null) return false
  if (
    !exactKeys(input, [
      'id',
      'runId',
      'attemptId',
      'operation',
      'provider',
      'modelId',
      'templateVersion',
      'providerRequestId',
      'codexThreadId',
      'stableErrorId',
      'usage',
      'recordedAt',
    ])
  )
    return false
  const value = input as Record<string, unknown>
  const conceptCall = value.operation === 'concept_compile'
  const failed = value.stableErrorId !== null
  return (
    validId(value.id) &&
    validId(value.runId) &&
    (value.attemptId === null || validId(value.attemptId)) &&
    typeof value.operation === 'string' &&
    ['concept_compile', 'code_generate', 'code_repair'].includes(value.operation) &&
    validOpaque(value.provider, 100) &&
    validOpaque(value.modelId) &&
    validOpaque(value.templateVersion, 100) &&
    (value.providerRequestId === null || validOpaque(value.providerRequestId)) &&
    (value.codexThreadId === null || validOpaque(value.codexThreadId)) &&
    (value.stableErrorId === null || validOpaque(value.stableErrorId)) &&
    conceptCall === (value.attemptId === null) &&
    (conceptCall
      ? value.codexThreadId === null
      : failed || value.provider !== 'codex-sdk' || value.codexThreadId !== null) &&
    (failed || value.provider === 'codex-sdk' || value.providerRequestId !== null) &&
    validUsage(value.usage) &&
    validTimestamp(value.recordedAt)
  )
}
