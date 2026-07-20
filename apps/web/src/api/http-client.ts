import { csrfTokenSchema, identifierSchema } from '@simproof/contracts'
import { type ZodType, z } from 'zod'

export type ApiFailureKind =
  | 'authentication'
  | 'conflict'
  | 'invalid-request'
  | 'invalid-response'
  | 'network'
  | 'permission'
  | 'rate-limit'
  | 'unavailable'

export interface ApiFailure {
  readonly kind: ApiFailureKind
  readonly id: string
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiFailure }

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly csrfToken?: string | undefined
  readonly sessionlessUnsafe?: boolean
  readonly signal?: AbortSignal | undefined
}

export interface HttpClient {
  request<T>(path: string, schema: ZodType<T>, options?: RequestOptions): Promise<ApiResult<T>>
}

export const SESSION_EXPIRED_EVENT = 'simproof:session-expired'

const errorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        id: identifierSchema,
        message: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict()

export function createHttpClient(
  fetcher: typeof fetch = fetch,
  onAuthenticationFailure: () => void = notifyBrowserSessionExpired,
): HttpClient {
  return {
    async request<T>(
      path: string,
      schema: ZodType<T>,
      options: RequestOptions = {},
    ): Promise<ApiResult<T>> {
      const method = options.method ?? 'GET'
      if (!validPath(path) || !validUnsafeOptions(method, options)) {
        return failure('invalid-request', 'web.invalid-request')
      }
      try {
        const response = await fetcher(path, requestInit(method, options))
        const result = await decodeResponse(response, schema)
        if (!result.ok && result.error.kind === 'authentication') onAuthenticationFailure()
        return result
      } catch (cause: unknown) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          return failure('network', 'web.request-aborted')
        }
        return failure('network', 'web.network-unavailable')
      }
    },
  }
}

function notifyBrowserSessionExpired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

function requestInit(method: string, options: RequestOptions): RequestInit {
  const unsafe = method !== 'GET'
  return {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(unsafe ? { 'content-type': 'application/json' } : {}),
      ...(options.csrfToken === undefined ? {} : { 'x-csrf-token': options.csrfToken }),
    },
    ...(unsafe ? { body: JSON.stringify(options.body ?? {}) } : {}),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

async function decodeResponse<T>(response: Response, schema: ZodType<T>): Promise<ApiResult<T>> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return failure('invalid-response', 'web.invalid-response')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failure('invalid-response', 'web.invalid-response')
  }
  if (response.ok) {
    const parsed = z
      .object({ ok: z.literal(true), value: schema })
      .strict()
      .safeParse(body)
    return parsed.success
      ? { ok: true, value: parsed.data.value }
      : failure('invalid-response', 'web.invalid-response')
  }
  const parsed = errorEnvelopeSchema.safeParse(body)
  return parsed.success
    ? failure(kindForStatus(response.status), parsed.data.error.id)
    : failure('invalid-response', 'web.invalid-response')
}

function kindForStatus(status: number): ApiFailureKind {
  if (status === 400 || status === 404 || status === 413 || status === 415) return 'invalid-request'
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limit'
  return 'unavailable'
}

function failure(kind: ApiFailureKind, id: string): ApiResult<never> {
  return { ok: false, error: { kind, id } }
}

function validPath(path: string): boolean {
  if (
    path.length > 4_096 ||
    !path.startsWith('/api/') ||
    path.startsWith('//') ||
    path.includes('#')
  ) {
    return false
  }
  const [rawPath, ...queryParts] = path.split('?')
  if (
    rawPath === undefined ||
    rawPath.endsWith('/') ||
    rawPath.includes('//') ||
    queryParts.length > 1
  ) {
    return false
  }
  const segments = rawPath.slice(1).split('/')
  if (segments.some((segment) => !canonicalComponent(segment, true))) return false
  const query = queryParts[0]
  if (query === undefined) return true
  if (query === '') return false
  const keys = new Set<string>()
  return query.split('&').every((pair) => {
    const separator = pair.indexOf('=')
    if (separator < 1 || pair.indexOf('=', separator + 1) !== -1) return false
    const key = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (!canonicalComponent(key, false) || !canonicalComponent(value, false)) return false
    const decodedKey = decodeURIComponent(key)
    if (keys.has(decodedKey)) return false
    keys.add(decodedKey)
    return true
  })
}

function canonicalComponent(value: string, pathSegment: boolean): boolean {
  if (value === '' || value.includes('+')) return false
  try {
    const decoded = decodeURIComponent(value)
    return (
      encodeURIComponent(decoded) === value &&
      !/\p{C}/u.test(decoded) &&
      (!pathSegment || (decoded !== '.' && decoded !== '..' && !/[\\/]/u.test(decoded)))
    )
  } catch {
    return false
  }
}

function validUnsafeOptions(method: string, options: RequestOptions): boolean {
  return (
    method === 'GET' ||
    options.sessionlessUnsafe === true ||
    csrfTokenSchema.safeParse(options.csrfToken).success
  )
}
