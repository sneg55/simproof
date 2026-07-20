import type { Result } from '@simproof/persistence'

import type { HttpOperationFailureCode, HttpOperationResult } from '../http/types.js'

export const succeeded = <T>(value: T): HttpOperationResult<T> => ({ ok: true, value })

export const failed = (
  code: HttpOperationFailureCode,
  message: string,
  detail?: string,
): HttpOperationResult<never> => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
})

export function fromPersistence<T>(result: Result<T>): HttpOperationResult<T> {
  if (result.ok) return succeeded(result.value)
  return persistenceFailure(result)
}

export function persistenceFailure(
  result: Extract<Result<unknown>, { readonly ok: false }>,
): HttpOperationResult<never> {
  const code = result.error.code
  if (code === 'invalid-input') {
    return failed('invalid-input', result.error.message, 'persistence.invalid-input')
  }
  if (code === 'not-found')
    return failed('not-found', result.error.message, 'persistence.not-found')
  if (code === 'conflict') return failed('conflict', result.error.message, 'persistence.conflict')
  if (code === 'invalid-state' || code === 'invalid-transition' || code === 'immutable-record') {
    return failed('conflict', result.error.message, `persistence.${code}`)
  }
  return failed(
    'operation-failed',
    'Educator operation failed closed.',
    'persistence.failed-closed',
  )
}

export const unavailable = (message: string, detail?: string): HttpOperationResult<never> =>
  failed('operation-failed', message, detail)
