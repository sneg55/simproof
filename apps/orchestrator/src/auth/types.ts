export type AuthErrorCode =
  | 'authentication-failed'
  | 'bootstrap-denied'
  | 'csrf-invalid'
  | 'internal-error'
  | 'invalid-input'
  | 'session-invalid'

export interface AuthError {
  readonly code: AuthErrorCode
  readonly message: string
}

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AuthError }

export const authOk = <T>(value: T): AuthResult<T> => ({ ok: true, value })
export const authError = (code: AuthErrorCode, message: string): AuthResult<never> => ({
  ok: false,
  error: { code, message },
})
