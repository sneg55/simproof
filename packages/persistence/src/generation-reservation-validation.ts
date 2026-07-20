import type { ReconcileExternalCallInput, ReserveExternalCallInput } from './generation-types.js'
import {
  exactKeys,
  validExternalCall,
  validId,
  validOpaque,
  validTimestamp,
  validUsage,
} from './generation-validation.js'

export function validReservation(input: unknown): input is ReserveExternalCallInput {
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
      'reservedUsage',
      'createdAt',
    ])
  ) {
    return false
  }
  const value = input as Record<string, unknown>
  const concept = value.operation === 'concept_compile'
  if (!validUsage(value.reservedUsage)) return false
  return (
    validReservationIdentity(value) &&
    validReservationProvenance(value) &&
    concept === (value.attemptId === null) &&
    value.reservedUsage.providerRequests === 1 &&
    (concept ? value.reservedUsage.artifactBytes === 0 : value.reservedUsage.artifactBytes > 0) &&
    validTimestamp(value.createdAt)
  )
}

function validReservationIdentity(value: Record<string, unknown>): boolean {
  return (
    validId(value.id) &&
    validId(value.runId) &&
    (value.attemptId === null || validId(value.attemptId)) &&
    typeof value.operation === 'string' &&
    ['concept_compile', 'code_generate', 'code_repair'].includes(value.operation)
  )
}

function validReservationProvenance(value: Record<string, unknown>): boolean {
  return (
    validOpaque(value.provider, 100) &&
    validOpaque(value.modelId) &&
    validOpaque(value.templateVersion, 100)
  )
}

export function validReconciliation(input: unknown): input is ReconcileExternalCallInput {
  if (typeof input !== 'object' || input === null) return false
  if (!exactKeys(input, ['reservationId', 'call', 'reconciledAt'])) return false
  const value = input as Record<string, unknown>
  return (
    validId(value.reservationId) &&
    validExternalCall(value.call) &&
    validTimestamp(value.reconciledAt)
  )
}
