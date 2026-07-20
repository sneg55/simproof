import { createHash, timingSafeEqual } from 'node:crypto'

import {
  MAX_RUNNER_LAUNCHER_REQUEST_BYTES,
  type RunnerImageDigest,
  type RunnerLauncherCapability,
  type RunnerLauncherErrorId,
  type RunnerLimits,
  type RunnerRequest,
  type RunnerResponse,
  runnerImageDigestSchema,
  runnerLauncherRequestSchema,
  runnerLimitsSchema,
} from '@simproof/contracts'

import {
  createRunnerService,
  type IsolationLauncher,
  type RunnerService,
} from './runner-service.js'

export interface LauncherControlRequest {
  readonly method: string
  readonly path: string
  readonly authorization?: string
  readonly body: string
  readonly bodyTooLarge?: true
  readonly signal?: AbortSignal
}

export type LauncherControlResponse =
  | {
      readonly status: 200
      readonly body: RunnerResponse | RunnerLauncherCapability | { readonly status: 'ok' | 'ready' }
    }
  | { readonly status: 400 | 401 | 403 | 404 | 405 | 413 | 503; readonly body: LauncherErrorBody }

interface LauncherErrorBody {
  readonly errorId: RunnerLauncherErrorId
}

export interface LauncherControlPlane {
  readonly handle: (request: LauncherControlRequest) => Promise<LauncherControlResponse>
}

export interface LauncherControlPlaneOptions {
  readonly token: string
  readonly image: string
  readonly maxRequestBytes: number
  readonly maxConcurrent: number
  readonly maximumLimits: RunnerLimits
  readonly launcher: IsolationLauncher
  readonly readiness?: () => boolean | Promise<boolean>
}

const bodyBytes = (value: string) => new TextEncoder().encode(value).byteLength
const INVALID_REQUEST = 'launcher.invalid-request' as const
const failure = (
  status: Exclude<LauncherControlResponse['status'], 200>,
  errorId: RunnerLauncherErrorId,
): LauncherControlResponse => ({ status, body: { errorId } })

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function authorized(header: string | undefined, expectedDigest: Buffer): boolean {
  const candidate = header?.startsWith('Bearer ') ? header.slice(7) : ''
  return timingSafeEqual(tokenDigest(candidate), expectedDigest)
}

function clampLimits(request: RunnerRequest, maximum: RunnerLimits): RunnerRequest | undefined {
  if (request.inputs.length > maximum.maxSamples) return undefined
  const limits = runnerLimitsSchema.parse({
    timeoutMs: Math.min(request.limits.timeoutMs, maximum.timeoutMs),
    memoryBytes: Math.min(request.limits.memoryBytes, maximum.memoryBytes),
    maxOutputBytes: Math.min(request.limits.maxOutputBytes, maximum.maxOutputBytes),
    maxSamples: Math.min(request.limits.maxSamples, maximum.maxSamples),
  })
  return { ...request, limits }
}

async function readinessResponse(
  probe: LauncherControlPlaneOptions['readiness'],
): Promise<LauncherControlResponse> {
  try {
    if ((await probe?.()) === false) return failure(503, 'launcher.unavailable')
  } catch {
    return failure(503, 'launcher.unavailable')
  }
  return { status: 200, body: { status: 'ready' } }
}

async function capabilityResponse(input: {
  readonly request: LauncherControlRequest
  readonly probe: LauncherControlPlaneOptions['readiness']
  readonly expectedToken: Buffer
  readonly image: RunnerImageDigest
}): Promise<LauncherControlResponse> {
  if (input.request.method !== 'GET') return failure(405, INVALID_REQUEST)
  if (!authorized(input.request.authorization, input.expectedToken)) {
    return failure(401, 'launcher.authentication-required')
  }
  const readiness = await readinessResponse(input.probe)
  return readiness.status === 200
    ? {
        status: 200,
        body: { status: 'ready', protocolVersion: '1', image: input.image },
      }
    : readiness
}

async function executionResponse(input: {
  readonly request: LauncherControlRequest
  readonly options: LauncherControlPlaneOptions
  readonly expectedToken: Buffer
  readonly image: RunnerImageDigest
  readonly maximumLimits: RunnerLimits
  readonly service: RunnerService
}): Promise<LauncherControlResponse> {
  const { request } = input
  if (request.path !== '/v1/execute') return failure(404, INVALID_REQUEST)
  if (request.method !== 'POST') return failure(405, INVALID_REQUEST)
  if (!authorized(request.authorization, input.expectedToken)) {
    return failure(401, 'launcher.authentication-required')
  }
  if (request.bodyTooLarge === true || bodyBytes(request.body) > input.options.maxRequestBytes) {
    return failure(413, 'launcher.request-too-large')
  }
  let value: unknown
  try {
    value = JSON.parse(request.body)
  } catch {
    return failure(400, INVALID_REQUEST)
  }
  const parsed = runnerLauncherRequestSchema.safeParse(value)
  if (!parsed.success) return failure(400, INVALID_REQUEST)
  if (parsed.data.image !== input.image) return failure(403, 'launcher.image-denied')
  const clamped = clampLimits(parsed.data.request, input.maximumLimits)
  if (clamped === undefined) return failure(400, INVALID_REQUEST)
  return { status: 200, body: await input.service.execute(clamped, request.signal) }
}

function validateOptions(options: LauncherControlPlaneOptions): {
  readonly image: RunnerImageDigest
  readonly maximumLimits: RunnerLimits
} {
  if (options.token.length < 32 || options.token.length > 4_096) {
    throw new TypeError('Launcher token must be a bounded secret.')
  }
  if (
    !Number.isInteger(options.maxRequestBytes) ||
    options.maxRequestBytes < 16_384 ||
    options.maxRequestBytes > MAX_RUNNER_LAUNCHER_REQUEST_BYTES
  ) {
    throw new TypeError('Launcher request limit must be bounded.')
  }
  return {
    image: runnerImageDigestSchema.parse(options.image),
    maximumLimits: runnerLimitsSchema.parse(options.maximumLimits),
  }
}

export function createLauncherControlPlane(
  options: LauncherControlPlaneOptions,
): LauncherControlPlane {
  const trusted = validateOptions(options)
  const expectedToken = tokenDigest(options.token)
  const service = createRunnerService(options.launcher, { maxConcurrent: options.maxConcurrent })
  return Object.freeze({
    async handle(request: LauncherControlRequest): Promise<LauncherControlResponse> {
      if (request.method === 'GET' && request.path === '/healthz') {
        return { status: 200, body: { status: 'ok' } }
      }
      if (request.method === 'GET' && request.path === '/readyz') {
        return await readinessResponse(options.readiness)
      }
      if (request.path === '/v1/capabilities') {
        return await capabilityResponse({
          request,
          probe: options.readiness,
          expectedToken,
          image: trusted.image,
        })
      }
      return await executionResponse({
        request,
        options,
        expectedToken,
        image: trusted.image,
        maximumLimits: trusted.maximumLimits,
        service,
      })
    },
  })
}
