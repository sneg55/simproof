import { randomUUID } from 'node:crypto'

import {
  CorrelationContext,
  correlationSchema,
  operationalErrorIdSchema,
} from '@simproof/observability'
import type { EndpointDispatchContext } from './endpoint-dispatcher.js'
import { EndpointDispatcher } from './endpoint-dispatcher.js'
import { diagnosticAttributes } from './failure-diagnostic.js'
import { createLocalAuthBypass, type LocalAuthBypass } from './local-auth-bypass.js'
import { AuthAttemptLimiter, trustedClientSource } from './rate-limiter.js'
import {
  forwardedSource,
  normalizeHeaders,
  RequestError,
  readJsonBody,
  sessionCookie,
} from './request.js'
import { corsPreflight, failure } from './response.js'
import { matchRequestTarget, validateRouteInventory } from './route-url.js'
import type { RouteDefinition } from './routes.js'
import { ROUTE_INVENTORY } from './routes.js'
import type { HttpApiOptions, HttpRequest, HttpResponse, RequestCorrelation } from './types.js'

export { ROUTE_INVENTORY } from './routes.js'

validateRouteInventory(ROUTE_INVENTORY)

export function createHttpApi(options: HttpApiOptions): {
  handle(request: HttpRequest): Promise<HttpResponse>
} {
  const boundary = new HttpBoundary(options)
  return { handle: (request) => boundary.handle(request) }
}

class HttpBoundary {
  readonly #dispatcher: EndpointDispatcher
  readonly #limiter: AuthAttemptLimiter
  readonly #correlationContext: Pick<CorrelationContext, 'run'>
  readonly #localAuthBypass: LocalAuthBypass | undefined

  constructor(readonly options: HttpApiOptions) {
    this.#localAuthBypass = createLocalAuthBypass(options.config)
    this.#dispatcher = new EndpointDispatcher(options, this.#localAuthBypass)
    this.#limiter = new AuthAttemptLimiter(options.limiterOptions)
    this.#correlationContext = options.correlationContext ?? new CorrelationContext()
  }

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const correlation = requestCorrelation(request.requestId, this.options.createRequestId)
    const response = await this.#correlationContext.run(correlation, () =>
      this.#handle(request, correlation),
    )
    this.options.logger?.emit({
      severity: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
      component: 'web-api',
      event: 'http.request.completed',
      correlation,
      attributes: {
        operation: requestOperation(request),
        statusCode: response.status,
        ...diagnosticAttributes(response.diagnostic),
      },
      ...registeredResponseError(response),
    })
    return withRequestId(response, correlation.requestId)
  }

  async #handle(request: HttpRequest, correlation: RequestCorrelation): Promise<HttpResponse> {
    let origin: string | undefined
    try {
      const headers = normalizeHeaders(request.headers)
      const suppliedOrigin = headers.get('origin')
      origin = this.options.config.allowedOrigins.includes(suppliedOrigin ?? '')
        ? suppliedOrigin
        : undefined
      if (request.method === 'OPTIONS') return this.#preflight(request.path, headers, origin)
      const matched = matchRequestTarget(request.method, request.path, ROUTE_INVENTORY)
      if (!matched.ok) return failure(400, matched.errorId, origin)
      if (matched.match === undefined) return failure(404, 'http.route-not-found', origin)
      const { parameters, query, route } = matched.match
      if (route.unsafe && origin === undefined) return failure(403, 'http.origin-denied', undefined)

      const secureCookie = this.options.config.deploymentMode === 'network'
      const token = sessionCookie(headers.get('cookie'), secureCookie)
      const csrf = headers.get('x-csrf-token')
      const authenticated = this.#authenticate(route, token, csrf, origin)
      if (!authenticated.ok) return authenticated.response

      const body = route.unsafe
        ? await readJsonBody(request.body, headers, this.options.config.request.maxBytes)
        : undefined
      const dispatchContext: EndpointDispatchContext = {
        correlation,
        route,
        parameters,
        query,
        body,
        token,
        csrf,
        sessionId: authenticated.sessionId,
        origin,
      }
      if (requiresPasswordWork(route)) {
        return await this.#limitedDispatch(
          dispatchContext,
          trustedClientSource(
            request.peerAddress,
            forwardedSource(headers),
            this.options.config.trustedProxyAddress,
          ),
        )
      }
      return await this.#dispatcher.dispatch(dispatchContext)
    } catch (error) {
      return error instanceof RequestError
        ? failure(error.status, error.id, origin)
        : failure(500, 'http.internal-error', origin)
    }
  }

  #preflight(
    path: string,
    headers: ReadonlyMap<string, string>,
    origin: string | undefined,
  ): HttpResponse {
    if (origin === undefined) return failure(403, 'http.origin-denied', undefined)
    const method = headers.get('access-control-request-method')
    if (method === undefined) return failure(404, 'http.route-not-found', origin)
    const matched = matchRequestTarget(method, path, ROUTE_INVENTORY)
    if (!matched.ok) return failure(400, matched.errorId, origin)
    const route = matched.match?.route
    if (route === undefined) return failure(404, 'http.route-not-found', origin)
    const requested = headers.get('access-control-request-headers') ?? ''
    const names = requested.split(',').map((name) => name.trim().toLowerCase())
    const allowed = new Set(['content-type', 'x-csrf-token'])
    if (
      names.some((name) => name.length === 0 || !allowed.has(name)) ||
      new Set(names).size !== names.length
    ) {
      return failure(403, 'http.cors-headers-denied', origin)
    }
    return corsPreflight(origin, route.method, names.join(', '))
  }

  #authenticate(
    route: RouteDefinition,
    token: string | undefined,
    csrf: string | undefined,
    origin: string | undefined,
  ): { ok: true; sessionId: string | undefined } | { ok: false; response: HttpResponse } {
    if (route.access === 'public') return { ok: true, sessionId: undefined }
    if (this.#localAuthBypass !== undefined) {
      if (route.unsafe && csrf !== this.#localAuthBypass.session.csrfToken) {
        return { ok: false, response: failure(403, 'http.csrf-denied', origin) }
      }
      return { ok: true, sessionId: this.#localAuthBypass.sessionId }
    }
    if (token === undefined)
      return { ok: false, response: failure(401, 'http.session-required', origin) }
    if (route.unsafe && csrf === undefined) {
      return { ok: false, response: failure(403, 'http.csrf-denied', origin) }
    }
    const result = this.options.auth.authenticate(token, route.unsafe ? csrf : undefined)
    if (!result.ok) {
      const csrfFailure = route.unsafe && result.error.code === 'csrf-invalid'
      return {
        ok: false,
        response: failure(
          csrfFailure ? 403 : 401,
          csrfFailure ? 'http.csrf-denied' : 'http.session-required',
          origin,
        ),
      }
    }
    return { ok: true, sessionId: result.value.sessionId }
  }

  async #limitedDispatch(context: EndpointDispatchContext, source: string): Promise<HttpResponse> {
    const lease = this.#limiter.acquire(source, context.sessionId)
    if (!lease.ok) return failure(429, `http.auth-${lease.reason}-limit`, context.origin)
    try {
      return await this.#dispatcher.dispatch(context)
    } finally {
      lease.release()
    }
  }
}

function requestOperation(request: HttpRequest): string {
  if (request.method === 'OPTIONS') return 'http.preflight'
  const matched = matchRequestTarget(request.method, request.path, ROUTE_INVENTORY)
  return matched.ok && matched.match !== undefined
    ? `http.${matched.match.route.key}`
    : 'http.unmatched'
}

function registeredResponseError(response: HttpResponse) {
  if (typeof response.body !== 'object' || response.body === null || !('error' in response.body)) {
    return {}
  }
  const error = response.body.error
  if (typeof error !== 'object' || error === null || !('id' in error)) return {}
  const parsed = operationalErrorIdSchema.safeParse(error.id)
  return parsed.success ? { errorId: parsed.data } : {}
}

function requestCorrelation(
  transportedRequestId: string | undefined,
  createRequestId: (() => string) | undefined,
): RequestCorrelation {
  let candidate = transportedRequestId
  if (candidate === undefined && createRequestId !== undefined) {
    try {
      candidate = createRequestId()
    } catch {
      candidate = undefined
    }
  }
  const parsed = correlationSchema.safeParse({ requestId: candidate ?? randomUUID() })
  return parsed.success && parsed.data.requestId !== undefined
    ? { ...parsed.data, requestId: parsed.data.requestId }
    : { requestId: randomUUID() }
}

function withRequestId(response: HttpResponse, requestId: string): HttpResponse {
  return {
    ...response,
    headers: { ...response.headers, 'x-simproof-request-id': requestId },
  }
}

function requiresPasswordWork(route: RouteDefinition): boolean {
  return [
    'bootstrap',
    'login',
    'password',
    'privacy-export',
    'privacy-delete',
    'simulation-export',
  ].includes(route.key)
}
