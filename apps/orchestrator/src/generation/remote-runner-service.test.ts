import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { RunnerRequest, RunnerResponse } from '@simproof/contracts'
import { hashCanonicalJson, PENDULUM_POLICY } from '@simproof/verifier'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRemoteRunnerService, type RunnerHttpTransport } from './remote-runner-service.js'

const token = 'orchestrator-to-launcher-secret-at-least-thirty-two-characters'
const image = `sha256:${'a'.repeat(64)}`
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
  limits: { memoryBytes: 134_217_728, timeoutMs: 2_000, maxOutputBytes: 65_536, maxSamples: 10 },
}
const success: RunnerResponse = {
  protocolVersion: '1',
  requestId: request.requestId,
  domain: 'pendulum',
  observedArtifactHash: hash,
  exit: { classification: 'success', errorId: null },
  samples: [
    {
      sampleId: 'baseline',
      observation: { input: { lengthM: 1, amplitudeDeg: 10 }, periodS: 2 },
    },
  ],
  diagnostics: [],
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function service(transport: RunnerHttpTransport) {
  return createRemoteRunnerService({
    endpoint: 'http://runner-launcher:4318',
    token,
    image,
    transport,
  })
}

describe('remote runner service', () => {
  it.each([
    'https://public.example/runner',
    'http://127.0.0.1:4318',
    'http://runner-launcher:4319',
    'http://user:pass@runner-launcher:4318',
    'http://runner-launcher:4318/redirect',
    'unix:///run/simproof/launcher.sock',
  ])('rejects non-canonical launcher endpoint %s before retaining credentials', (endpoint) => {
    expect(() => createRemoteRunnerService({ endpoint, token, image })).toThrow(
      'Invalid runner endpoint.',
    )
  })

  it('sends the exact authenticated protocol envelope and validates the response', async () => {
    const transport = vi.fn<RunnerHttpTransport>().mockResolvedValue({
      status: 200,
      body: JSON.stringify(success),
    })
    await expect(service(transport).execute(request)).resolves.toEqual(success)
    const sent = transport.mock.calls[0]?.[0]
    expect(JSON.parse(sent?.body ?? '')).toEqual({ image, request })
    expect(transport).toHaveBeenCalledWith(
      {
        endpoint: { kind: 'http', origin: 'http://runner-launcher:4318' },
        method: 'POST',
        path: '/v1/execute',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: expect.any(String),
      },
      expect.any(AbortSignal),
    )
  })

  it.each([
    ['launcher denial', { status: 401, body: '{"errorId":"launcher.authentication-required"}' }],
    ['malformed response', { status: 200, body: '{' }],
    [
      'forged binding',
      {
        status: 200,
        body: JSON.stringify({ ...success, requestId: '9aaf7abe-1ca8-4f39-9380-4a5f99f126ae' }),
      },
    ],
  ])('maps %s to one safe internal runner response', async (_name, outcome) => {
    const response = await service(vi.fn().mockResolvedValue(outcome)).execute(request)
    expect(response.exit).toEqual({ classification: 'internal-error', errorId: 'runner.internal' })
    expect(JSON.stringify(response)).not.toContain(token)
  })

  it('maps an aborted transport to runner cancellation', async () => {
    const abort = new AbortController()
    const transport = vi.fn<RunnerHttpTransport>().mockImplementation(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('transport aborted')), {
            once: true,
          })
        }),
    )
    const pending = service(transport).execute(request, abort.signal)
    abort.abort('teacher-cancelled')
    await expect(pending).resolves.toMatchObject({
      exit: { classification: 'cancelled', errorId: 'runner.cancelled' },
    })
  })

  it('bounds a stalled execution transport independently of caller cancellation', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<RunnerHttpTransport>().mockImplementation(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('deadline')), { once: true })
        }),
    )
    const pending = service(transport).execute(request)
    await vi.advanceTimersByTimeAsync(request.limits.timeoutMs + 2_000)
    await expect(pending).resolves.toMatchObject({
      exit: { classification: 'internal-error', errorId: 'runner.internal' },
    })
  })

  it('authenticates readiness and binds it to the exact protocol and image', async () => {
    const transport = vi.fn<RunnerHttpTransport>().mockResolvedValue({
      status: 200,
      body: JSON.stringify({ status: 'ready', protocolVersion: '1', image }),
    })
    await expect(service(transport).readiness()).resolves.toBe(true)
    expect(transport).toHaveBeenCalledWith(
      {
        endpoint: { kind: 'http', origin: 'http://runner-launcher:4318' },
        method: 'GET',
        path: '/v1/capabilities',
        headers: { authorization: `Bearer ${token}` },
        body: '',
      },
      expect.any(AbortSignal),
    )
  })

  it.each([
    { status: 'ready', protocolVersion: '2', image },
    { status: 'ready', protocolVersion: '1', image: `sha256:${'b'.repeat(64)}` },
    { status: 'ready', protocolVersion: '1', image, extra: true },
  ])('rejects a mismatched or non-strict launcher capability %#', async (capability) => {
    const transport = vi.fn<RunnerHttpTransport>().mockResolvedValue({
      status: 200,
      body: JSON.stringify(capability),
    })
    await expect(service(transport).readiness()).resolves.toBe(false)
  })

  it('forbids redirects when using the production HTTP transport', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(success), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await createRemoteRunnerService({
      endpoint: 'http://runner-launcher:4318',
      token,
      image,
    }).execute(request)
    expect(fetch).toHaveBeenCalledWith(
      'http://runner-launcher:4318/v1/execute',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('cancels a partial production response stream when the execution deadline fires', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"protocolVersion":"1"'))
      },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const pending = createRemoteRunnerService({
      endpoint: 'http://runner-launcher:4318',
      token,
      image,
    }).execute(request)
    await vi.advanceTimersByTimeAsync(request.limits.timeoutMs + 2_000)
    await expect(pending).resolves.toMatchObject({
      exit: { classification: 'internal-error', errorId: 'runner.internal' },
    })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('orchestrator Docker authority boundary', () => {
  it('contains no Docker client, socket, or process-spawn authority', async () => {
    const root = new URL('..', import.meta.url).pathname
    const files = (await readdir(root, { recursive: true }))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => join(root, file))
    const sourceText = await Promise.all(files.map(async (file) => await readFile(file, 'utf8')))
    expect(sourceText.join('\n')).not.toMatch(
      /node:child_process|docker-launcher|\/var\/run\/docker\.sock|DOCKER_HOST/u,
    )
    const manifest = JSON.parse(await readFile(join(root, '..', 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >
    expect(manifest.dependencies).not.toHaveProperty('@simproof/runner')
  })
})
