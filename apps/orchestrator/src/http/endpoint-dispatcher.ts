import {
  adminBootstrapRequestSchema,
  educatorSessionSchema,
  generationIdempotencyKeySchema,
  generationRequestSchema,
  loginRequestSchema,
  newPasswordInputSchema,
  passwordInputSchema,
  privacySettingsUpdateRequestSchema,
  simulationDeletionRequestSchema,
} from '@simproof/contracts'
import { z } from 'zod'

import { clearSessionCookie, serializeSessionCookie } from '../auth/cookies.js'
import { isEducatorRouteKey, type LegacyRouteKey } from './educator-dispatch-support.js'
import { EducatorDispatcher } from './educator-dispatcher.js'
import {
  generationOperationResult,
  internalError,
  privacyResult,
} from './legacy-operation-result.js'
import type { LocalAuthBypass } from './local-auth-bypass.js'
import { failure, success } from './response.js'
import type { RouteDefinition } from './routes.js'
import type { HttpApiOptions, HttpResponse, RequestCorrelation } from './types.js'

const emptySchema = z.object({}).strict()
const passwordChangeSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: newPasswordInputSchema,
  })
  .strict()
const passwordConfirmationSchema = z.object({ currentPassword: passwordInputSchema }).strict()
const deletionSchema = simulationDeletionRequestSchema.extend({
  currentPassword: passwordInputSchema,
})
const generationCancellationSchema = z
  .object({ idempotencyKey: generationIdempotencyKeySchema })
  .strict()
const INVALID_INPUT = 'http.invalid-input'

export interface EndpointDispatchContext {
  readonly correlation: RequestCorrelation
  readonly route: RouteDefinition
  readonly parameters: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly body: unknown
  readonly token: string | undefined
  readonly csrf: string | undefined
  readonly sessionId: string | undefined
  readonly origin: string | undefined
}

export class EndpointDispatcher {
  readonly #educator: EducatorDispatcher

  constructor(
    readonly options: HttpApiOptions,
    readonly localAuthBypass?: LocalAuthBypass,
  ) {
    this.#educator = new EducatorDispatcher(options.callbacks.educator)
  }

  async dispatch(context: EndpointDispatchContext): Promise<HttpResponse> {
    const key = context.route.key
    if (isEducatorRouteKey(key)) {
      return (
        (await this.#educator.dispatch(context)) ??
        internalError(context.origin, 'dispatch.educator-route-unresolved')
      )
    }
    return await this.#dispatchLegacy(context, key)
  }

  async #dispatchLegacy(
    context: EndpointDispatchContext,
    key: LegacyRouteKey,
  ): Promise<HttpResponse> {
    const { body, correlation, csrf, origin, sessionId, token } = context
    switch (key) {
      case 'health':
        return success(200, await this.options.callbacks.health(correlation), origin)
      case 'readiness':
        return await this.#readiness(correlation, origin)
      case 'bootstrap':
        return await this.#bootstrap(body, origin)
      case 'login':
        return await this.#login(body, token, origin)
      case 'logout':
        return this.#logout(body, token, origin)
      case 'rotate':
        return this.#rotate(body, token, csrf, origin)
      case 'password':
        return await this.#password(body, origin)
      case 'session':
        return this.#session(token, origin)
      case 'privacy-get':
        return privacyResult(await this.options.callbacks.getPrivacy(required(sessionId)), origin)
      case 'privacy-update':
        return await this.#privacyUpdate(body, required(sessionId), origin)
      case 'privacy-export':
        return await this.#privacyExport(body, required(sessionId), origin)
      case 'privacy-delete':
        return await this.#privacyDelete(body, required(sessionId), origin)
      case 'generation-start':
        return await this.#generationStart(body, required(sessionId), origin)
      case 'generation-cancel':
        return await this.#generationCancel(body, required(sessionId), origin)
    }
  }

  async #readiness(
    correlation: RequestCorrelation,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const report = await this.options.callbacks.readiness(correlation)
    return report.status === 'ready'
      ? success(200, report, origin)
      : failure(503, report.errorId, origin)
  }

  #session(token: string | undefined, origin: string | undefined): HttpResponse {
    if (this.localAuthBypass !== undefined) {
      return success(200, this.localAuthBypass.session, origin)
    }
    if (token === undefined) return failure(401, 'http.session-required', origin)
    const session = this.options.auth.session(token)
    if (!session.ok) return failure(401, 'http.session-required', origin)
    const parsed = educatorSessionSchema.safeParse(session.value)
    return parsed.success
      ? success(200, parsed.data, origin)
      : internalError(origin, 'auth.session-schema-invalid')
  }

  async #bootstrap(body: unknown, origin: string | undefined): Promise<HttpResponse> {
    const parsed = adminBootstrapRequestSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    const result = await this.options.auth.bootstrap(parsed.data)
    return result.ok
      ? success(200, result.value, origin)
      : failure(403, 'http.bootstrap-denied', origin)
  }

  async #login(
    body: unknown,
    existingToken: string | undefined,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = loginRequestSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    const result = await this.options.auth.login(parsed.data, existingToken)
    if (!result.ok) return failure(401, 'http.authentication-failed', origin)
    return this.#issuedSession(result.value, origin)
  }

  #logout(body: unknown, token: string | undefined, origin: string | undefined): HttpResponse {
    if (!emptySchema.safeParse(body).success || token === undefined) {
      return failure(400, INVALID_INPUT, origin)
    }
    const result = this.options.auth.logout(token)
    return result.ok
      ? success(200, true, origin, {
          'set-cookie': clearSessionCookie(this.options.config.deploymentMode === 'network'),
        })
      : internalError(origin, 'auth.logout-failed')
  }

  #rotate(
    body: unknown,
    token: string | undefined,
    csrf: string | undefined,
    origin: string | undefined,
  ): HttpResponse {
    if (!emptySchema.safeParse(body).success || token === undefined || csrf === undefined) {
      return failure(400, INVALID_INPUT, origin)
    }
    const result = this.options.auth.rotate(token, csrf)
    return result.ok
      ? this.#issuedSession(result.value, origin)
      : failure(401, 'http.session-required', origin)
  }

  async #password(body: unknown, origin: string | undefined): Promise<HttpResponse> {
    const parsed = passwordChangeSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    const result = await this.options.auth.changePassword(parsed.data)
    return result.ok
      ? success(200, result.value, origin, {
          'set-cookie': clearSessionCookie(this.options.config.deploymentMode === 'network'),
        })
      : failure(403, 'http.password-denied', origin)
  }

  async #privacyUpdate(
    body: unknown,
    sessionId: string,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = privacySettingsUpdateRequestSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    return privacyResult(await this.options.callbacks.updatePrivacy(parsed.data, sessionId), origin)
  }

  async #privacyExport(
    body: unknown,
    sessionId: string,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = passwordConfirmationSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    return privacyResult(
      await this.options.callbacks.exportData(parsed.data.currentPassword, sessionId),
      origin,
    )
  }

  async #privacyDelete(
    body: unknown,
    sessionId: string,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = deletionSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    return privacyResult(
      await this.options.callbacks.deleteSimulation(
        parsed.data.simulationId,
        parsed.data.currentPassword,
        sessionId,
      ),
      origin,
    )
  }

  async #generationStart(
    body: unknown,
    sessionId: string,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = generationRequestSchema.safeParse(body)
    if (
      !parsed.success ||
      parsed.data.prompt.length > this.options.config.request.maxPromptCharacters
    ) {
      return failure(400, INVALID_INPUT, origin)
    }
    return generationOperationResult(
      await this.options.callbacks.startGeneration(parsed.data, sessionId),
      origin,
    )
  }

  async #generationCancel(
    body: unknown,
    sessionId: string,
    origin: string | undefined,
  ): Promise<HttpResponse> {
    const parsed = generationCancellationSchema.safeParse(body)
    if (!parsed.success) return failure(400, INVALID_INPUT, origin)
    return generationOperationResult(
      await this.options.callbacks.cancelGeneration(parsed.data.idempotencyKey, sessionId),
      origin,
    )
  }

  #issuedSession(
    session: { csrfToken: string; sessionToken: string; expiresAt: string },
    origin: string | undefined,
  ): HttpResponse {
    return success(
      200,
      { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
      origin,
      {
        'set-cookie': serializeSessionCookie({
          token: session.sessionToken,
          maxAgeSeconds: this.options.config.session.ttlSeconds,
          secure: this.options.config.deploymentMode === 'network',
        }),
      },
    )
  }
}

function required(value: string | undefined): string {
  if (value === undefined) throw new TypeError('Required authenticated context is absent.')
  return value
}
