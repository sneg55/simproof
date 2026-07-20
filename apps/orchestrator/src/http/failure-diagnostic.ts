import { operationalAttributesSchema } from '@simproof/observability'
import type { z } from 'zod'

import type { HttpOperationFailureCode } from './types.js'

export type OperationalFailureClass = NonNullable<
  z.infer<typeof operationalAttributesSchema>['failureClass']
>

// Internal-only diagnostic attached to a failed HttpResponse. The boundary emits it into the
// http.request.completed operational signal; it is never written to the client body.
export interface FailureDiagnostic {
  readonly detail?: string
  readonly failureClass?: OperationalFailureClass
}

// Build the operational diagnostic for a failed operation result. A fail-closed 'operation-failed'
// (mapped to 503/500) is a server fault and is classified as internal-error so dashboards can
// separate swallowed server failures from ordinary client rejections; the 4xx codes are expected
// client outcomes and carry only their specific detail id. Returns undefined when there is nothing
// to add, so success responses and unclassified client errors stay lean.
export function operationDiagnostic(
  code: HttpOperationFailureCode,
  detail: string | undefined,
): FailureDiagnostic | undefined {
  const failureClass: OperationalFailureClass | undefined =
    code === 'operation-failed' ? 'internal-error' : undefined
  if (detail === undefined && failureClass === undefined) return undefined
  return {
    ...(detail === undefined ? {} : { detail }),
    ...(failureClass === undefined ? {} : { failureClass }),
  }
}

// Defensively project a response diagnostic into signal attributes. A detail that does not conform
// to the bounded-identifier contract is dropped rather than crashing the logger, mirroring how the
// boundary guards the registered error id.
export function diagnosticAttributes(diagnostic: FailureDiagnostic | undefined): {
  readonly detail?: string
  readonly failureClass?: OperationalFailureClass
} {
  if (diagnostic === undefined) return {}
  const parsed = operationalAttributesSchema.pick({ detail: true, failureClass: true }).safeParse({
    ...(diagnostic.detail === undefined ? {} : { detail: diagnostic.detail }),
    ...(diagnostic.failureClass === undefined ? {} : { failureClass: diagnostic.failureClass }),
  })
  if (!parsed.success) return {}
  return {
    ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }),
    ...(parsed.data.failureClass === undefined ? {} : { failureClass: parsed.data.failureClass }),
  }
}
