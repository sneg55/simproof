import { randomUUID } from 'node:crypto'

import {
  adminBootstrapRequestSchema,
  csrfTokenSchema,
  loginRequestSchema,
  sessionTokenSchema,
} from '@simproof/contracts'
import type { AdministratorRecord, AuthRepository } from '@simproof/persistence'

import { hashPassword, verifyPassword } from './password.js'
import {
  constantTimeHashEqual,
  constantTimeTextEqual,
  csrfTokenForSession,
  keyedHash,
  newOpaqueSecret,
} from './secrets.js'
import { type AuthResult, authError, authOk } from './types.js'

const AUTHENTICATION_FAILED = () => authError('authentication-failed', 'Authentication failed.')
const BOOTSTRAP_DENIED = () => authError('bootstrap-denied', 'Administrator bootstrap was denied.')
const SESSION_INVALID = () => authError('session-invalid', 'Session is invalid.')
const CSRF_INVALID = () => authError('csrf-invalid', 'Request verification failed.')
const DUMMY_CREDENTIAL = {
  passwordHash: '0'.repeat(64),
  passwordSalt: 'AAAAAAAAAAAAAAAAAAAAAA',
  passwordHashVersion: 1,
  scryptCost: 16_384,
  scryptBlockSize: 8,
  scryptParallelization: 1,
  scryptKeyLength: 32,
} as const

export interface IssuedSession {
  readonly sessionToken: string
  readonly csrfToken: string
  readonly expiresAt: string
}

export class AuthService {
  readonly #repository: AuthRepository
  readonly #bootstrapSecret: string
  readonly #sessionSecret: string
  readonly #sessionTtlSeconds: number
  readonly #sessionIdleSeconds: number
  readonly #maxActiveSessions: number
  readonly #now: () => number

  constructor(
    repository: AuthRepository,
    options: {
      readonly bootstrapSecret: string
      readonly sessionSecret: string
      readonly sessionTtlSeconds: number
      readonly sessionIdleSeconds: number
      readonly maxActiveSessions: number
      readonly now?: () => number
    },
  ) {
    if (
      options.bootstrapSecret.length < 32 ||
      options.sessionSecret.length < 32 ||
      !Number.isSafeInteger(options.sessionTtlSeconds) ||
      options.sessionTtlSeconds < 900 ||
      options.sessionTtlSeconds > 604_800 ||
      !Number.isSafeInteger(options.sessionIdleSeconds) ||
      options.sessionIdleSeconds < 300 ||
      options.sessionIdleSeconds > options.sessionTtlSeconds ||
      !Number.isSafeInteger(options.maxActiveSessions) ||
      options.maxActiveSessions < 1 ||
      options.maxActiveSessions > 128
    ) {
      throw new TypeError('Authentication configuration is invalid.')
    }
    this.#repository = repository
    this.#bootstrapSecret = options.bootstrapSecret
    this.#sessionSecret = options.sessionSecret
    this.#sessionTtlSeconds = options.sessionTtlSeconds
    this.#sessionIdleSeconds = options.sessionIdleSeconds
    this.#maxActiveSessions = options.maxActiveSessions
    this.#now = options.now ?? Date.now
  }

  async bootstrap(input: unknown): Promise<AuthResult<{ readonly credentialVersion: number }>> {
    const parsed = adminBootstrapRequestSchema.safeParse(input)
    if (
      !parsed.success ||
      !constantTimeTextEqual(parsed.data.bootstrapSecret, this.#bootstrapSecret) ||
      this.#repository.administrator().ok
    ) {
      return BOOTSTRAP_DENIED()
    }
    try {
      const credential = await hashPassword(parsed.data.newPassword)
      const result = this.#repository.bootstrap({ credential, completedAt: this.#timestamp() })
      return result.ok
        ? authOk({ credentialVersion: result.value.credentialVersion })
        : BOOTSTRAP_DENIED()
    } catch {
      return BOOTSTRAP_DENIED()
    }
  }

  async login(input: unknown, replaceSessionToken?: string): Promise<AuthResult<IssuedSession>> {
    const parsed = loginRequestSchema.safeParse(input)
    if (!parsed.success) return AUTHENTICATION_FAILED()
    const administrator = this.#repository.administrator()
    const passwordMatches = await verifyPassword(
      parsed.data.password,
      administrator.ok ? administrator.value : DUMMY_CREDENTIAL,
    )
    if (!administrator.ok || !passwordMatches) {
      return AUTHENTICATION_FAILED()
    }
    const issued = this.#newSession(administrator.value)
    const revokeTokenHash =
      replaceSessionToken !== undefined && sessionTokenSchema.safeParse(replaceSessionToken).success
        ? keyedHash(this.#sessionSecret, 'session', replaceSessionToken)
        : undefined
    const stored = this.#repository.createSession(issued.record, {
      idleSeconds: this.#sessionIdleSeconds,
      maxActiveSessions: this.#maxActiveSessions,
      ...(revokeTokenHash === undefined ? {} : { revokeTokenHash }),
    })
    return stored.ok ? authOk(issued.public) : authError('internal-error', 'Authentication failed.')
  }

  authenticate(
    sessionToken: string,
    csrfToken?: string,
  ): AuthResult<{ readonly sessionId: string; readonly expiresAt: string }> {
    if (!sessionTokenSchema.safeParse(sessionToken).success) return SESSION_INVALID()
    const session = this.#repository.findSession(this.#tokenHash(sessionToken))
    if (
      !session.ok ||
      session.value.revokedAt !== null ||
      Date.parse(session.value.expiresAt) <= this.#now() ||
      Date.parse(session.value.lastActivityAt) + this.#sessionIdleSeconds * 1_000 <= this.#now()
    ) {
      return SESSION_INVALID()
    }
    if (
      csrfToken !== undefined &&
      (!csrfTokenSchema.safeParse(csrfToken).success ||
        !constantTimeHashEqual(
          session.value.csrfHash,
          keyedHash(this.#sessionSecret, 'csrf', csrfToken),
        ))
    ) {
      return CSRF_INVALID()
    }
    const touched = this.#repository.touchSession({
      tokenHash: this.#tokenHash(sessionToken),
      activeAt: this.#timestamp(),
      idleSeconds: this.#sessionIdleSeconds,
    })
    return touched.ok
      ? authOk({ sessionId: touched.value.id, expiresAt: touched.value.expiresAt })
      : SESSION_INVALID()
  }

  session(sessionToken: string): AuthResult<{
    readonly authenticated: true
    readonly csrfToken: string
    readonly expiresAt: string
  }> {
    const authenticated = this.authenticate(sessionToken)
    return authenticated.ok
      ? authOk({
          authenticated: true,
          csrfToken: csrfTokenForSession(this.#sessionSecret, sessionToken),
          expiresAt: authenticated.value.expiresAt,
        })
      : authenticated
  }

  rotate(sessionToken: string, csrfToken: string): AuthResult<IssuedSession> {
    const authenticated = this.authenticate(sessionToken, csrfToken)
    if (!authenticated.ok) return authenticated
    const administrator = this.#repository.administrator()
    if (!administrator.ok) return SESSION_INVALID()
    const rotatedAt = this.#timestamp()
    const replacement = this.#newSession(
      administrator.value,
      authenticated.value.sessionId,
      rotatedAt,
    )
    const rotated = this.#repository.rotateSession({
      currentTokenHash: this.#tokenHash(sessionToken),
      replacement: replacement.record,
      rotatedAt,
      idleSeconds: this.#sessionIdleSeconds,
      maxActiveSessions: this.#maxActiveSessions,
    })
    return rotated.ok ? authOk(replacement.public) : SESSION_INVALID()
  }

  logout(sessionToken: string): AuthResult<true> {
    if (!sessionTokenSchema.safeParse(sessionToken).success) return authOk(true)
    const revoked = this.#repository.revokeSession(this.#tokenHash(sessionToken), this.#timestamp())
    return revoked.ok ? authOk(true) : authError('internal-error', 'Logout failed.')
  }

  revokeAllSessions(
    sessionToken: string,
    csrfToken: string,
  ): AuthResult<{ readonly revoked: number }> {
    const authenticated = this.authenticate(sessionToken, csrfToken)
    if (!authenticated.ok) return authenticated
    const revoked = this.#repository.revokeAllSessions(this.#timestamp())
    return revoked.ok
      ? authOk({ revoked: revoked.value })
      : authError('internal-error', 'Session revocation failed.')
  }

  async changePassword(input: {
    readonly currentPassword: string
    readonly newPassword: string
  }): Promise<AuthResult<{ readonly credentialVersion: number }>> {
    if (
      typeof input.currentPassword !== 'string' ||
      typeof input.newPassword !== 'string' ||
      Buffer.byteLength(input.currentPassword, 'utf8') > 1_024
    ) {
      return AUTHENTICATION_FAILED()
    }
    const administrator = this.#repository.administrator()
    if (!administrator.ok || !(await verifyPassword(input.currentPassword, administrator.value))) {
      return AUTHENTICATION_FAILED()
    }
    try {
      const credential = await hashPassword(input.newPassword)
      const rotated = this.#repository.rotateCredential({
        expectedVersion: administrator.value.credentialVersion,
        credential,
        updatedAt: this.#timestamp(),
      })
      return rotated.ok
        ? authOk({ credentialVersion: rotated.value.credentialVersion })
        : authError('internal-error', 'Credential update failed.')
    } catch {
      return authError('invalid-input', 'New credential is invalid.')
    }
  }

  #newSession(
    administrator: AdministratorRecord,
    rotatedFromId: string | null = null,
    createdAt = this.#timestamp(),
  ) {
    const expiresAt = new Date(
      Date.parse(createdAt) + this.#sessionTtlSeconds * 1_000,
    ).toISOString()
    const sessionToken = newOpaqueSecret()
    const csrfToken = csrfTokenForSession(this.#sessionSecret, sessionToken)
    return {
      public: { sessionToken, csrfToken, expiresAt },
      record: {
        id: randomUUID(),
        tokenHash: this.#tokenHash(sessionToken),
        csrfHash: keyedHash(this.#sessionSecret, 'csrf', csrfToken),
        credentialVersion: administrator.credentialVersion,
        createdAt,
        expiresAt,
        rotatedFromId,
      },
    }
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }

  #tokenHash(token: string): string {
    return keyedHash(this.#sessionSecret, 'session', token)
  }
}
