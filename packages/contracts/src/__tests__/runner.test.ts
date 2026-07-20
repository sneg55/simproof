import { describe, expect, it } from 'vitest'

import {
  MAX_RUNNER_ARTIFACT_BYTES,
  MAX_RUNNER_OUTPUT_BYTES,
  runnerLauncherCapabilitySchema,
  runnerLauncherErrorSchema,
  runnerLauncherRequestSchema,
  runnerRequestSchema,
  runnerResponseSchema,
} from '../runner.js'

const hash = `sha256:${'a'.repeat(64)}`
const observedHash = `sha256:${'b'.repeat(64)}`

const request = {
  protocolVersion: '1',
  requestId: '018f6bc1-0811-70c1-a139-938a3ad2dee0',
  artifact: {
    format: 'javascript-esm',
    content: 'export default { protocolVersion: "1", sample: input => input }',
    hash,
  },
  domain: 'projectile',
  policy: { id: 'projectile.default', version: '1.0.0', contentHash: hash },
  inputs: [{ sampleId: 'baseline', input: { initialSpeedMps: 30, launchAngleDeg: 45 } }],
  limits: {
    timeoutMs: 2_000,
    memoryBytes: 134_217_728,
    maxOutputBytes: 1_048_576,
    maxSamples: 100,
  },
} as const

const response = {
  protocolVersion: '1',
  requestId: request.requestId,
  domain: 'projectile',
  observedArtifactHash: observedHash,
  exit: { classification: 'success', errorId: null },
  samples: [
    {
      sampleId: 'baseline',
      observation: {
        input: { initialSpeedMps: 30, launchAngleDeg: 45 },
        summary: {
          rangeM: 91.74,
          apexHeightM: 22.94,
          flightTimeS: 4.32,
          initialSpeedMps: 30,
        },
        trajectory: [{ timeS: 0, xM: 0, yM: 0, speedMps: 30 }],
      },
    },
  ],
  diagnostics: [],
} as const

describe('runner request protocol', () => {
  it('accepts a strict versioned request with deterministic domain inputs and limits', () => {
    expect(runnerRequestSchema.parse(request)).toEqual(request)
  })

  it.each([
    ['unknown top-level field', { ...request, secret: 'must not cross boundary' }],
    ['unknown artifact field', { ...request, artifact: { ...request.artifact, path: '/tmp/x' } }],
    [
      'non-finite input',
      {
        ...request,
        inputs: [
          { sampleId: 'baseline', input: { initialSpeedMps: Number.NaN, launchAngleDeg: 45 } },
        ],
      },
    ],
    ['duplicate sample id', { ...request, inputs: [request.inputs[0], request.inputs[0]] }],
    [
      'input count beyond declared limit',
      {
        ...request,
        limits: { ...request.limits, maxSamples: 1 },
        inputs: [
          request.inputs[0],
          { sampleId: 'second', input: { initialSpeedMps: 20, launchAngleDeg: 30 } },
        ],
      },
    ],
    ['unsupported protocol', { ...request, protocolVersion: '2' }],
    [
      'oversized output allowance',
      {
        ...request,
        limits: { ...request.limits, maxOutputBytes: MAX_RUNNER_OUTPUT_BYTES + 1 },
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(runnerRequestSchema.safeParse(value).success).toBe(false)
  })

  it('measures the artifact cap in UTF-8 bytes', () => {
    const multibyteArtifact = '😀'.repeat(Math.floor(MAX_RUNNER_ARTIFACT_BYTES / 4) + 1)
    expect(
      runnerRequestSchema.safeParse({
        ...request,
        artifact: { ...request.artifact, content: multibyteArtifact },
      }).success,
    ).toBe(false)
  })
})

describe('runner response protocol', () => {
  it('accepts normalized successful samples and an observed artifact hash', () => {
    expect(runnerResponseSchema.parse(response)).toEqual(response)
  })

  it('accepts a stable classified failure without partial samples', () => {
    expect(
      runnerResponseSchema.safeParse({
        ...response,
        exit: {
          classification: 'policy-denied',
          errorId: 'runner.denied.network',
        },
        samples: [],
        diagnostics: [
          {
            severity: 'error',
            code: 'runner.denied.network',
            message: 'Network access is forbidden.',
          },
        ],
      }).success,
    ).toBe(true)
  })

  it.each([
    ['unknown response field', { ...response, workspacePath: '/tmp/private' }],
    [
      'non-finite output',
      {
        ...response,
        samples: [
          {
            ...response.samples[0],
            observation: {
              ...response.samples[0].observation,
              summary: {
                ...response.samples[0].observation.summary,
                rangeM: Number.POSITIVE_INFINITY,
              },
            },
          },
        ],
      },
    ],
    [
      'classification/error mismatch',
      {
        ...response,
        exit: { classification: 'resource-limit', errorId: 'runner.denied.network' },
        samples: [],
      },
    ],
    [
      'failure with partial samples',
      {
        ...response,
        exit: { classification: 'runtime-error', errorId: 'runner.runtime.crash' },
      },
    ],
    [
      'failure without matching error diagnostic',
      {
        ...response,
        exit: { classification: 'runtime-error', errorId: 'runner.runtime.crash' },
        samples: [],
        diagnostics: [],
      },
    ],
    [
      'successful response with error diagnostic',
      {
        ...response,
        diagnostics: [
          {
            severity: 'error',
            code: 'runner.internal',
            message: 'This contradicts the successful exit.',
          },
        ],
      },
    ],
    ['success without samples', { ...response, samples: [] }],
  ])('rejects %s', (_name, value) => {
    expect(runnerResponseSchema.safeParse(value).success).toBe(false)
  })
})

describe('runner launcher protocol', () => {
  const image = `sha256:${'c'.repeat(64)}`

  it('accepts only an exact digest-pinned image and runner request envelope', () => {
    expect(runnerLauncherRequestSchema.parse({ image, request })).toEqual({ image, request })
    expect(
      runnerLauncherRequestSchema.safeParse({ image: 'ghcr.io/simproof/runner:latest', request })
        .success,
    ).toBe(false)
    expect(
      runnerLauncherRequestSchema.safeParse({
        image: `ghcr.io/simproof/runner@sha256:${'c'.repeat(64)}`,
        request,
      }).success,
    ).toBe(false)
    expect(runnerLauncherRequestSchema.safeParse({ image, request, token: 'secret' }).success).toBe(
      false,
    )
  })

  it('keeps launcher errors strict and content-free', () => {
    expect(runnerLauncherErrorSchema.parse({ errorId: 'launcher.image-denied' })).toEqual({
      errorId: 'launcher.image-denied',
    })
    expect(
      runnerLauncherErrorSchema.safeParse({
        errorId: 'launcher.image-denied',
        message: 'requested image was private',
      }).success,
    ).toBe(false)
  })

  it('binds authenticated capabilities to the exact protocol and image', () => {
    expect(
      runnerLauncherCapabilitySchema.parse({ status: 'ready', protocolVersion: '1', image }),
    ).toEqual({ status: 'ready', protocolVersion: '1', image })
    expect(
      runnerLauncherCapabilitySchema.safeParse({
        status: 'ready',
        protocolVersion: '1',
        image: `sha256:${'d'.repeat(64)}`,
        token: 'secret',
      }).success,
    ).toBe(false)
  })
})
