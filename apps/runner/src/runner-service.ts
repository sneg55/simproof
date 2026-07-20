import { createHash } from 'node:crypto'

import {
  MAX_RUNNER_ARTIFACT_BYTES,
  type RunnerErrorId,
  type RunnerExit,
  type RunnerLimits,
  type RunnerRequest,
  type RunnerRequestErrorId,
  type RunnerResponse,
  runnerRequestSchema,
  runnerResponseSchema,
} from '@simproof/contracts'
import { getDomainPack, hashCanonicalJson } from '@simproof/verifier'

import type { IsolationResult } from './docker-launcher.js'
import { inspectGeneratedSource } from './source-policy.js'

export interface IsolationLauncher {
  readonly launch: (
    serializedRequest: string,
    limits: RunnerLimits,
    signal?: AbortSignal,
  ) => Promise<IsolationResult>
}

export class RunnerProtocolError extends TypeError {
  readonly errorId: RunnerRequestErrorId

  constructor(errorId: RunnerRequestErrorId) {
    super('Runner request failed protocol validation.')
    this.name = 'RunnerProtocolError'
    this.errorId = errorId
  }
}

export interface RunnerService {
  readonly execute: (input: unknown, signal?: AbortSignal) => Promise<RunnerResponse>
}

export interface RunnerServiceOptions {
  readonly maxConcurrent?: number
}

const artifactHash = (source: string) =>
  `sha256:${createHash('sha256').update(source).digest('hex')}` as const

function exitFor(errorId: RunnerErrorId): RunnerExit {
  if (errorId.startsWith('runner.denied.')) {
    return { classification: 'policy-denied', errorId } as RunnerExit
  }
  if (errorId.startsWith('runner.artifact.')) {
    return { classification: 'invalid-artifact', errorId } as RunnerExit
  }
  if (errorId.startsWith('runner.limit.')) {
    return { classification: 'resource-limit', errorId } as RunnerExit
  }
  if (errorId === 'runner.cancelled') return { classification: 'cancelled', errorId }
  if (errorId === 'runner.internal') return { classification: 'internal-error', errorId }
  return { classification: 'runtime-error', errorId } as RunnerExit
}

function failureResponse(
  request: RunnerRequest,
  observedArtifactHash: `sha256:${string}`,
  errorId: RunnerErrorId,
  message: string,
): RunnerResponse {
  return runnerResponseSchema.parse({
    protocolVersion: '1',
    requestId: request.requestId,
    domain: request.domain,
    observedArtifactHash,
    exit: exitFor(errorId),
    samples: [],
    diagnostics: [{ severity: 'error', code: errorId, message }],
  })
}

function isolationFailure(
  request: RunnerRequest,
  observedArtifactHash: `sha256:${string}`,
  result: Exclude<IsolationResult, { kind: 'exited' }>,
): RunnerResponse {
  if (result.kind === 'cancelled') {
    return failureResponse(request, observedArtifactHash, 'runner.cancelled', 'Runner cancelled.')
  }
  if (result.kind === 'timeout') {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.limit.timeout',
      'Runner execution exceeded its limit.',
    )
  }
  if (result.kind === 'internal') {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.internal',
      'Runner cleanup could not be established.',
    )
  }
  return failureResponse(
    request,
    observedArtifactHash,
    'runner.limit.output',
    'Runner output exceeded its limit.',
  )
}

function trustedPolicyMatches(request: RunnerRequest): boolean {
  const domainPack = getDomainPack(request.domain)
  if (domainPack === undefined) return false
  return (
    request.policy.id === domainPack.policy.id &&
    request.policy.version === domainPack.policy.version &&
    request.policy.contentHash === hashCanonicalJson(domainPack.policy)
  )
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.entries(value).find(([candidate]) => candidate === key)?.[1]
}

function parseRunnerRequest(input: unknown): RunnerRequest {
  if (typeof input === 'object' && input !== null) {
    const protocolVersion = field(input, 'protocolVersion')
    if (protocolVersion !== undefined && protocolVersion !== '1') {
      throw new RunnerProtocolError('runner.artifact.unsupported-protocol')
    }
    const artifact = field(input, 'artifact')
    if (typeof artifact === 'object' && artifact !== null) {
      const content = field(artifact, 'content')
      if (
        typeof content === 'string' &&
        (content.length > MAX_RUNNER_ARTIFACT_BYTES ||
          new TextEncoder().encode(content).byteLength > MAX_RUNNER_ARTIFACT_BYTES)
      ) {
        throw new RunnerProtocolError('runner.artifact.oversized')
      }
    }
  }
  const parsed = runnerRequestSchema.safeParse(input)
  if (parsed.success) return parsed.data
  throw new RunnerProtocolError('runner.request.invalid')
}

function samplesMatchRequest(response: RunnerResponse, request: RunnerRequest): boolean {
  if (response.exit.classification !== 'success') return true
  if (response.samples.length !== request.inputs.length) return false
  const expected = new Map(request.inputs.map((item) => [item.sampleId, item.input]))
  return response.samples.every((sample) => {
    const input = expected.get(sample.sampleId)
    if (input === undefined) return false
    const actual = sample.observation.input
    if (request.domain === 'pendulum' && 'lengthM' in input) {
      return (
        'lengthM' in actual &&
        actual.lengthM === input.lengthM &&
        'amplitudeDeg' in actual &&
        actual.amplitudeDeg === input.amplitudeDeg
      )
    }
    return (
      'initialSpeedMps' in input &&
      'initialSpeedMps' in actual &&
      actual.initialSpeedMps === input.initialSpeedMps &&
      'launchAngleDeg' in actual &&
      actual.launchAngleDeg === input.launchAngleDeg
    )
  })
}

function parseContainerResponse(
  request: RunnerRequest,
  observedArtifactHash: `sha256:${string}`,
  result: Extract<IsolationResult, { kind: 'exited' }>,
): RunnerResponse {
  if (result.exitCode !== 0) {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.runtime.crash',
      'Runner process exited unexpectedly.',
    )
  }
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.runtime.malformed-output',
      'Runner returned malformed output.',
    )
  }
  const parsed = runnerResponseSchema.safeParse(value)
  if (!parsed.success) {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.runtime.malformed-output',
      'Runner returned invalid output.',
    )
  }
  if (
    parsed.data.requestId !== request.requestId ||
    parsed.data.domain !== request.domain ||
    parsed.data.observedArtifactHash !== observedArtifactHash ||
    !samplesMatchRequest(parsed.data, request)
  ) {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.runtime.malformed-output',
      'Runner response bindings did not match the request.',
    )
  }
  return parsed.data
}

async function executeRunnerRequest(
  request: RunnerRequest,
  launcher: IsolationLauncher,
  signal?: AbortSignal,
): Promise<RunnerResponse> {
  const observedArtifactHash = artifactHash(request.artifact.content)
  if (observedArtifactHash !== request.artifact.hash) {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.artifact.hash-mismatch',
      'Artifact hash did not match its content.',
    )
  }
  if (!trustedPolicyMatches(request)) {
    return failureResponse(
      request,
      observedArtifactHash,
      'runner.denied.policy-reference',
      'Runner policy reference is not installed for this domain.',
    )
  }
  const policy = inspectGeneratedSource(request.artifact.content)
  if (!policy.ok) {
    return failureResponse(request, observedArtifactHash, policy.errorId, policy.message)
  }
  const result = await launcher.launch(JSON.stringify(request), request.limits, signal)
  return result.kind === 'exited'
    ? parseContainerResponse(request, observedArtifactHash, result)
    : isolationFailure(request, observedArtifactHash, result)
}

export function createRunnerService(
  launcher: IsolationLauncher,
  options: RunnerServiceOptions = {},
): RunnerService {
  const maxConcurrent = options.maxConcurrent ?? 2
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) {
    throw new TypeError('Runner concurrency limit must be a bounded positive integer.')
  }
  let active = 0
  return Object.freeze({
    async execute(input: unknown, signal?: AbortSignal): Promise<RunnerResponse> {
      const request = parseRunnerRequest(input)
      const observedArtifactHash = artifactHash(request.artifact.content)
      if (active >= maxConcurrent) {
        return failureResponse(
          request,
          observedArtifactHash,
          'runner.limit.processes',
          'Runner admission limit is saturated.',
        )
      }
      active += 1
      try {
        return await executeRunnerRequest(request, launcher, signal)
      } finally {
        active -= 1
      }
    },
  })
}
