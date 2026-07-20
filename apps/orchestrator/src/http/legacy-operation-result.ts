import { operationDiagnostic } from './failure-diagnostic.js'
import { failure, success } from './response.js'
import type { HttpOperationResult, HttpResponse } from './types.js'

const INVALID_INPUT = 'http.invalid-input'

// A server-internal fault (schema drift, an operation that cannot complete) with a stable detail
// id for the operational log. The client still sees only the generic 500 body.
export function internalError(origin: string | undefined, detail: string): HttpResponse {
  return failure(500, 'http.internal-error', origin, { detail, failureClass: 'internal-error' })
}

// Map a privacy operation result to an HTTP response, attaching the fail-closed diagnostic so the
// operational log records which cause collapsed into the status-tier error id.
export function privacyResult(
  result: HttpOperationResult<unknown>,
  origin: string | undefined,
): HttpResponse {
  if (result.ok) return success(200, result.value, origin)
  const diagnostic = operationDiagnostic(result.error.code, result.error.detail)
  if (result.error.code === 'confirmation-failed') {
    return failure(403, 'http.password-denied', origin, diagnostic)
  }
  if (result.error.code === 'conflict') {
    return failure(409, 'http.privacy-conflict', origin, diagnostic)
  }
  return result.error.code === 'invalid-input'
    ? failure(400, INVALID_INPUT, origin, diagnostic)
    : failure(500, 'http.internal-error', origin, diagnostic)
}

// Map a generation operation result to an HTTP response, attaching the fail-closed diagnostic.
export function generationOperationResult(
  result: HttpOperationResult<unknown>,
  origin: string | undefined,
): HttpResponse {
  if (result.ok) return success(200, result.value, origin)
  const diagnostic = operationDiagnostic(result.error.code, result.error.detail)
  if (result.error.code === 'conflict') {
    return failure(409, 'http.generation-conflict', origin, diagnostic)
  }
  return result.error.code === 'invalid-input'
    ? failure(400, INVALID_INPUT, origin, diagnostic)
    : failure(503, 'http.generation-unavailable', origin, diagnostic)
}
