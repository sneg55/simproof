import type { FailureDiagnostic } from './failure-diagnostic.js'
import type { HttpResponse } from './types.js'

const BASE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
})

export function success(
  status: number,
  value: unknown,
  origin: string | undefined,
  extraHeaders: Readonly<Record<string, string>> = {},
): HttpResponse {
  return {
    status,
    headers: headers(origin, extraHeaders),
    body: { ok: true, value },
  }
}

export function failure(
  status: number,
  id: string,
  origin: string | undefined,
  diagnostic?: FailureDiagnostic,
): HttpResponse {
  return {
    status,
    headers: headers(origin),
    body: { ok: false, error: { id, message: publicMessage(status) } },
    ...(diagnostic === undefined ? {} : { diagnostic }),
  }
}

export function corsPreflight(
  origin: string,
  method: string,
  requestedHeaders: string,
): HttpResponse {
  return {
    status: 204,
    headers: headers(origin, {
      'access-control-allow-methods': method,
      'access-control-allow-headers': requestedHeaders,
      vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    }),
    body: null,
  }
}

function headers(
  origin: string | undefined,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    ...BASE_HEADERS,
    ...(origin === undefined
      ? {}
      : {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-expose-headers': 'x-simproof-request-id',
          vary: 'Origin',
        }),
    ...extra,
  }
}

function publicMessage(status: number): string {
  if (status === 400) return 'Request input is invalid.'
  if (status === 401) return 'Authentication is required.'
  if (status === 403) return 'Request was denied.'
  if (status === 404) return 'Route was not found.'
  if (status === 409) return 'Request conflicts with current state.'
  if (status === 413) return 'Request body is too large.'
  if (status === 415) return 'Request media type is unsupported.'
  if (status === 429) return 'Request limit exceeded.'
  return 'Request could not be completed.'
}
