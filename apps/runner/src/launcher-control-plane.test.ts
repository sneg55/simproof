import { createHash } from 'node:crypto'

import type { RunnerRequest, RunnerResponse } from '@simproof/contracts'
import { hashCanonicalJson, PENDULUM_POLICY } from '@simproof/verifier'
import { describe, expect, it, vi } from 'vitest'

import { createLauncherControlPlane } from './launcher-control-plane.js'
import type { IsolationLauncher } from './runner-service.js'

const token = 'launcher-token-with-at-least-thirty-two-characters'
const image = `sha256:${'c'.repeat(64)}`
const source = 'export default { sample: input => ({ periodS: input.lengthM * 2 }) }'
const hash = `sha256:${createHash('sha256').update(source).digest('hex')}` as const
const request: RunnerRequest = {
  protocolVersion: '1',
  requestId: '018f6bc1-0811-70c1-a139-938a3ad2dee0',
  artifact: { format: 'javascript-esm', content: source, hash },
  domain: 'pendulum',
  policy: {
    id: PENDULUM_POLICY.id,
    version: PENDULUM_POLICY.version,
    contentHash: hashCanonicalJson(PENDULUM_POLICY),
  },
  inputs: [{ sampleId: 'baseline', input: { lengthM: 1, amplitudeDeg: 10 } }],
  limits: { memoryBytes: 268_435_456, timeoutMs: 8_000, maxOutputBytes: 80_000, maxSamples: 10 },
}

const successfulResponse = (input: RunnerRequest): RunnerResponse => ({
  protocolVersion: '1',
  requestId: input.requestId,
  domain: 'pendulum',
  observedArtifactHash: input.artifact.hash,
  exit: { classification: 'success', errorId: null },
  samples: [
    {
      sampleId: 'baseline',
      observation: { input: { lengthM: 1, amplitudeDeg: 10 }, periodS: 2 },
    },
  ],
  diagnostics: [],
})

function fixture(launch: IsolationLauncher['launch'] = vi.fn()) {
  const plane = createLauncherControlPlane({
    token,
    image,
    maxRequestBytes: 600_000,
    maxConcurrent: 1,
    maximumLimits: {
      memoryBytes: 134_217_728,
      timeoutMs: 2_000,
      maxOutputBytes: 65_536,
      maxSamples: 32,
    },
    launcher: { launch },
  })
  const execute = (overrides: Partial<Parameters<typeof plane.handle>[0]> = {}) =>
    plane.handle({
      method: 'POST',
      path: '/v1/execute',
      authorization: `Bearer ${token}`,
      body: JSON.stringify({ image, request }),
      ...overrides,
    })
  return { execute, plane }
}

describe('launcher control plane', () => {
  it.each(['/healthz', '/readyz'])('keeps %s dependency-safe and unauthenticated', async (path) => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const { plane } = fixture(launch)
    await expect(plane.handle({ method: 'GET', path, body: '' })).resolves.toEqual({
      status: 200,
      body: { status: path === '/healthz' ? 'ok' : 'ready' },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it('fails readiness closed when the injected daemon/image probe is unavailable', async () => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const readiness = vi.fn().mockResolvedValue(false)
    const { plane } = fixture(launch)
    const unavailable = createLauncherControlPlane({
      token,
      image,
      maxRequestBytes: 600_000,
      maxConcurrent: 1,
      maximumLimits: request.limits,
      launcher: { launch },
      readiness,
    })
    await expect(unavailable.handle({ method: 'GET', path: '/readyz', body: '' })).resolves.toEqual(
      { status: 503, body: { errorId: 'launcher.unavailable' } },
    )
    expect(readiness).toHaveBeenCalledOnce()
    expect(launch).not.toHaveBeenCalled()
    await plane.handle({ method: 'GET', path: '/healthz', body: '' })
  })

  it('authenticates a content-free capability bound to exact protocol and image', async () => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const { plane } = fixture(launch)
    await expect(
      plane.handle({
        method: 'GET',
        path: '/v1/capabilities',
        authorization: `Bearer ${token}`,
        body: '',
      }),
    ).resolves.toEqual({
      status: 200,
      body: { status: 'ready', protocolVersion: '1', image },
    })
    await expect(
      plane.handle({ method: 'GET', path: '/v1/capabilities', body: '' }),
    ).resolves.toEqual({
      status: 401,
      body: { errorId: 'launcher.authentication-required' },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it.each([undefined, 'Bearer wrong-token-with-at-least-thirty-two-characters', `Basic ${token}`])(
    'rejects missing or invalid authorization without inspecting work',
    async (authorization) => {
      const launch = vi.fn<IsolationLauncher['launch']>()
      const { execute, plane } = fixture(launch)
      const result =
        authorization === undefined
          ? plane.handle({ method: 'POST', path: '/v1/execute', body: '{}' })
          : execute({ authorization })
      await expect(result).resolves.toEqual({
        status: 401,
        body: { errorId: 'launcher.authentication-required' },
      })
      expect(launch).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['malformed JSON', '{', 400, 'launcher.invalid-request'],
    [
      'unknown envelope field',
      JSON.stringify({ image, request, secret: 'value' }),
      400,
      'launcher.invalid-request',
    ],
    ['oversized body', 'x'.repeat(600_001), 413, 'launcher.request-too-large'],
    [
      'mutable image',
      JSON.stringify({ image: 'simproof-runner:latest', request }),
      400,
      'launcher.invalid-request',
    ],
    [
      'unallowlisted image',
      JSON.stringify({ image: `sha256:${'d'.repeat(64)}`, request }),
      403,
      'launcher.image-denied',
    ],
  ])('rejects %s without a launch', async (_name, body, status, errorId) => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const { execute } = fixture(launch)
    await expect(execute({ body })).resolves.toEqual({ status, body: { errorId } })
    expect(launch).not.toHaveBeenCalled()
  })

  it('clamps every caller limit before invoking Docker isolation', async () => {
    const launch = vi.fn<IsolationLauncher['launch']>().mockImplementation((serialized) => {
      const clamped = JSON.parse(serialized) as RunnerRequest
      return Promise.resolve({
        kind: 'exited',
        exitCode: 0,
        stdout: JSON.stringify(successfulResponse(clamped)),
        stderr: '',
      })
    })
    const { execute } = fixture(launch)
    const response = await execute()
    expect(response.status).toBe(200)
    expect(JSON.parse(String(launch.mock.calls[0]?.[0])).limits).toEqual({
      memoryBytes: 134_217_728,
      timeoutMs: 2_000,
      maxOutputBytes: 65_536,
      maxSamples: 10,
    })
  })

  it('enforces one shared admission limit', async () => {
    let release: (() => void) | undefined
    const launch = vi.fn<IsolationLauncher['launch']>().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ kind: 'cancelled' })
        }),
    )
    const { execute } = fixture(launch)
    const first = execute()
    const saturated = await execute()
    expect(saturated.status).toBe(200)
    expect((saturated.body as RunnerResponse).exit).toEqual({
      classification: 'resource-limit',
      errorId: 'runner.limit.processes',
    })
    release?.()
    await first
  })

  it('propagates transport cancellation into launcher cleanup', async () => {
    const abort = new AbortController()
    const launch = vi.fn<IsolationLauncher['launch']>().mockImplementation(
      (_body, _limits, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ kind: 'cancelled' }), { once: true })
        }),
    )
    const { execute } = fixture(launch)
    const pending = execute({ signal: abort.signal })
    abort.abort()
    const response = await pending
    expect((response.body as RunnerResponse).exit.classification).toBe('cancelled')
  })

  it('rejects a control plane above the shared request ceiling', () => {
    expect(() =>
      createLauncherControlPlane({
        token,
        image,
        maxRequestBytes: 1_048_577,
        maxConcurrent: 1,
        maximumLimits: request.limits,
        launcher: { launch: vi.fn() },
      }),
    ).toThrowError(/request limit/u)
  })
})
