import {
  type RunnerRequest,
  type RunnerResponse,
  runnerImageDigestSchema,
  runnerLauncherCapabilitySchema,
  runnerRequestSchema,
  runnerResponseSchema,
} from '@simproof/contracts'
import type { RunnerServicePort } from './runner-service-port.js'

export interface RunnerEndpoint {
  readonly kind: 'http'
  readonly origin: string
}

export interface RunnerTransportRequest {
  readonly endpoint: RunnerEndpoint
  readonly method: 'GET' | 'POST'
  readonly path: '/v1/capabilities' | '/v1/execute'
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface RunnerTransportResponse {
  readonly status: number
  readonly body: string
}

export type RunnerHttpTransport = (
  request: RunnerTransportRequest,
  signal?: AbortSignal,
) => Promise<RunnerTransportResponse>

export interface RemoteRunnerService extends RunnerServicePort {
  readonly readiness: () => Promise<boolean>
}

export interface RemoteRunnerServiceOptions {
  readonly endpoint: string
  readonly token: string
  readonly image: string
  readonly transport?: RunnerHttpTransport
}

const MAX_RESPONSE_BYTES = 16_842_752
const TRANSPORT_ALLOWANCE_MS = 2_000

function parseEndpoint(value: string): RunnerEndpoint {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'runner-launcher' ||
    url.port !== '4318' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new TypeError('Invalid runner endpoint.')
  }
  return { kind: 'http', origin: url.origin }
}

function safeFailure(request: RunnerRequest, cancelled: boolean): RunnerResponse {
  const errorId = cancelled ? 'runner.cancelled' : 'runner.internal'
  return runnerResponseSchema.parse({
    protocolVersion: '1',
    requestId: request.requestId,
    domain: request.domain,
    observedArtifactHash: request.artifact.hash,
    exit: {
      classification: cancelled ? 'cancelled' : 'internal-error',
      errorId,
    },
    samples: [],
    diagnostics: [
      {
        severity: 'error',
        code: errorId,
        message: cancelled ? 'Runner cancelled.' : 'Runner service is unavailable.',
      },
    ],
  })
}

function boundResponse(value: unknown, request: RunnerRequest): RunnerResponse | undefined {
  const parsed = runnerResponseSchema.safeParse(value)
  if (!parsed.success) return undefined
  return parsed.data.requestId === request.requestId &&
    parsed.data.domain === request.domain &&
    parsed.data.observedArtifactHash === request.artifact.hash
    ? parsed.data
    : undefined
}

async function readFetchBody(response: Response, signal?: AbortSignal): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new TypeError('Runner response exceeded its limit.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

async function fetchTransport(
  input: RunnerTransportRequest,
  signal?: AbortSignal,
): Promise<RunnerTransportResponse> {
  const response = await fetch(`${input.endpoint.origin}${input.path}`, {
    method: input.method,
    headers: input.headers,
    ...(input.body === '' ? {} : { body: input.body }),
    ...(signal === undefined ? {} : { signal }),
    redirect: 'error',
  })
  return { status: response.status, body: await readFetchBody(response, signal) }
}

export function createRemoteRunnerService(
  options: RemoteRunnerServiceOptions,
): RemoteRunnerService {
  const endpoint = parseEndpoint(options.endpoint)
  const image = runnerImageDigestSchema.parse(options.image)
  if (options.token.length < 32 || options.token.length > 4_096) {
    throw new TypeError('Runner token must be a bounded secret.')
  }
  const transport = options.transport ?? fetchTransport
  return Object.freeze({
    async execute(input: unknown, signal?: AbortSignal): Promise<RunnerResponse> {
      const request = runnerRequestSchema.parse(input)
      const cancelled = () => signal?.aborted === true
      if (cancelled()) return safeFailure(request, true)
      const deadline = AbortSignal.timeout(request.limits.timeoutMs + TRANSPORT_ALLOWANCE_MS)
      const transportSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
      try {
        const result = await transport(
          {
            endpoint,
            method: 'POST',
            path: '/v1/execute',
            headers: {
              authorization: `Bearer ${options.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ image, request }),
          },
          transportSignal,
        )
        if (result.status !== 200) return safeFailure(request, false)
        return boundResponse(JSON.parse(result.body), request) ?? safeFailure(request, false)
      } catch {
        return safeFailure(request, cancelled())
      }
    },
    async readiness(): Promise<boolean> {
      const cancellation = new AbortController()
      const timer = setTimeout(() => cancellation.abort(), 2_000)
      try {
        const result = await transport(
          {
            endpoint,
            method: 'GET',
            path: '/v1/capabilities',
            headers: { authorization: `Bearer ${options.token}` },
            body: '',
          },
          cancellation.signal,
        )
        if (result.status !== 200) return false
        const parsed = runnerLauncherCapabilitySchema.safeParse(JSON.parse(result.body))
        return parsed.success && parsed.data.image === image
      } catch {
        return false
      } finally {
        clearTimeout(timer)
      }
    },
  })
}
