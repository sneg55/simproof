import type { ConceptReview } from './concept-review-types.js'
import { exactKeys, validId, validTimestamp } from './generation-validation.js'

const SHA256 = /^sha256:[0-9a-f]{64}$/u

// eslint-disable-next-line complexity -- This strict durable-checkpoint boundary validates every field and status-dependent nullability.
export function parseConceptReview(input: unknown): ConceptReview | null {
  if (typeof input !== 'object' || input === null) return null
  if (
    !exactKeys(input, [
      'id',
      'runId',
      'simulationVersionId',
      'conceptSpecId',
      'conceptHash',
      'status',
      'revision',
      'createdAt',
      'updatedAt',
      'resolvedAt',
    ])
  )
    return null
  const value = input as Record<string, unknown>
  if (
    !validId(value.id) ||
    !validId(value.runId) ||
    !validId(value.simulationVersionId) ||
    !validId(value.conceptSpecId) ||
    typeof value.conceptHash !== 'string' ||
    !SHA256.test(value.conceptHash) ||
    !['pending', 'confirmed', 'cancelled'].includes(String(value.status)) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.updatedAt) ||
    (value.resolvedAt !== null && !validTimestamp(value.resolvedAt))
  )
    return null
  const pending = value.status === 'pending'
  if (pending !== (value.resolvedAt === null)) return null
  return input as ConceptReview
}

export function validConceptHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}
