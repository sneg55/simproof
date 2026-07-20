import { createHash } from 'node:crypto'

import type { RunnerRequest, RunnerResponse } from '@simproof/contracts'
import { hashCanonicalJson, PENDULUM_POLICY, PROJECTILE_POLICY } from '@simproof/verifier'
import { describe, expect, it, vi } from 'vitest'

import {
  createRunnerService,
  type IsolationLauncher,
  type RunnerProtocolError,
} from './runner-service.js'

const artifact =
  "export default { protocolVersion: '1', sample: input => ({ periodS: input.lengthM * 2 }) }"
const hash = `sha256:${createHash('sha256').update(artifact).digest('hex')}` as const
const policyHash = hashCanonicalJson(PENDULUM_POLICY)
const request: RunnerRequest = {
  protocolVersion: '1',
  requestId: '018f6bc1-0811-70c1-a139-938a3ad2dee0',
  artifact: { format: 'javascript-esm', content: artifact, hash },
  domain: 'pendulum',
  policy: { id: PENDULUM_POLICY.id, version: PENDULUM_POLICY.version, contentHash: policyHash },
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

const executeRunnerRequest = (input: unknown, launcher: IsolationLauncher, signal?: AbortSignal) =>
  createRunnerService(launcher).execute(input, signal)

describe('runner service', () => {
  it('rejects malformed requests before launching isolation', async () => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    await expect(executeRunnerRequest({ ...request, unknown: true }, { launch })).rejects.toEqual(
      expect.objectContaining<Partial<RunnerProtocolError>>({
        errorId: 'runner.request.invalid',
      }),
    )
    expect(launch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'unsupported protocol',
      { ...request, protocolVersion: '2' },
      'runner.artifact.unsupported-protocol',
    ],
    [
      'oversized artifact',
      {
        ...request,
        artifact: { ...request.artifact, content: 'x'.repeat(5_000_000) },
      },
      'runner.artifact.oversized',
    ],
  ])('returns a stable boundary error for %s', async (_name, input, errorId) => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    await expect(executeRunnerRequest(input, { launch })).rejects.toMatchObject({ errorId })
    expect(launch).not.toHaveBeenCalled()
  })

  it('rejects an artifact hash mismatch before launching isolation', async () => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const response = await executeRunnerRequest(
      { ...request, artifact: { ...request.artifact, hash: `sha256:${'0'.repeat(64)}` } },
      { launch },
    )

    expect(launch).not.toHaveBeenCalled()
    expect(response.exit).toEqual({
      classification: 'invalid-artifact',
      errorId: 'runner.artifact.hash-mismatch',
    })
  })

  it('statically rejects forbidden capabilities before isolation', async () => {
    const source = 'export default { sample: () => process.env }'
    const launch = vi.fn<IsolationLauncher['launch']>()
    const response = await executeRunnerRequest(
      {
        ...request,
        artifact: {
          ...request.artifact,
          content: source,
          hash: `sha256:${createHash('sha256').update(source).digest('hex')}`,
        },
      },
      { launch },
    )
    expect(launch).not.toHaveBeenCalled()
    expect(response.exit).toEqual({
      classification: 'policy-denied',
      errorId: 'runner.denied.environment',
    })
  })

  it.each([
    ['unknown ID', { ...request.policy, id: 'pendulum.unknown' }],
    ['stale version', { ...request.policy, version: '9.0.0' }],
    ['wrong content hash', { ...request.policy, contentHash: hash }],
    [
      'cross-domain policy',
      {
        id: PROJECTILE_POLICY.id,
        version: PROJECTILE_POLICY.version,
        contentHash: hashCanonicalJson(PROJECTILE_POLICY),
      },
    ],
  ])('rejects %s policy references before isolation', async (_name, policy) => {
    const launch = vi.fn<IsolationLauncher['launch']>()
    const response = await executeRunnerRequest({ ...request, policy }, { launch })
    expect(launch).not.toHaveBeenCalled()
    expect(response.exit).toEqual({
      classification: 'policy-denied',
      errorId: 'runner.denied.policy-reference',
    })
  })

  it('accepts only a schema-valid response bound to the request', async () => {
    const launcher: IsolationLauncher = {
      launch: vi.fn().mockResolvedValue({
        kind: 'exited',
        exitCode: 0,
        stdout: JSON.stringify(success),
        stderr: '',
      }),
    }
    await expect(executeRunnerRequest(request, launcher)).resolves.toEqual(success)
  })

  it.each([
    [{ kind: 'cancelled' }, 'cancelled', 'runner.cancelled'],
    [{ kind: 'timeout' }, 'resource-limit', 'runner.limit.timeout'],
    [{ kind: 'output-limit' }, 'resource-limit', 'runner.limit.output'],
    [
      { kind: 'exited', exitCode: 7, stdout: '', stderr: 'secret' },
      'runtime-error',
      'runner.runtime.crash',
    ],
    [
      { kind: 'exited', exitCode: 0, stdout: '{not json', stderr: '' },
      'runtime-error',
      'runner.runtime.malformed-output',
    ],
  ] as const)('classifies isolation result %#', async (result, classification, errorId) => {
    const launcher: IsolationLauncher = { launch: vi.fn().mockResolvedValue(result) }
    const response = await executeRunnerRequest(request, launcher)
    expect(response.exit).toEqual({ classification, errorId })
    expect(JSON.stringify(response)).not.toContain('secret')
  })

  it('rejects a forged response binding', async () => {
    const launcher: IsolationLauncher = {
      launch: vi.fn().mockResolvedValue({
        kind: 'exited',
        exitCode: 0,
        stdout: JSON.stringify({ ...success, requestId: '9aaf7abe-1ca8-4f39-9380-4a5f99f126ae' }),
        stderr: '',
      }),
    }
    const response = await executeRunnerRequest(request, launcher)
    expect(response.exit).toEqual({
      classification: 'runtime-error',
      errorId: 'runner.runtime.malformed-output',
    })
  })

  it.each([
    ['missing requested sample', { ...success, samples: [] }],
    [
      'unknown sample ID',
      {
        ...success,
        samples: [{ ...success.samples[0], sampleId: 'forged' }],
      },
    ],
    [
      'mutated trusted input',
      {
        ...success,
        samples: [
          {
            ...success.samples[0],
            observation: {
              input: { lengthM: 2, amplitudeDeg: 10 },
              periodS: 2,
            },
          },
        ],
      },
    ],
  ])('rejects %s in an otherwise bound response', async (_name, forged) => {
    const launcher: IsolationLauncher = {
      launch: vi.fn().mockResolvedValue({
        kind: 'exited',
        exitCode: 0,
        stdout: JSON.stringify(forged),
        stderr: '',
      }),
    }
    const response = await executeRunnerRequest(request, launcher)
    expect(response.exit).toEqual({
      classification: 'runtime-error',
      errorId: 'runner.runtime.malformed-output',
    })
  })

  it('rejects saturated admission without launching another container', async () => {
    let release: (() => void) | undefined
    const firstLaunch = new Promise<Awaited<ReturnType<IsolationLauncher['launch']>>>((resolve) => {
      release = () =>
        resolve({
          kind: 'exited',
          exitCode: 0,
          stdout: JSON.stringify(success),
          stderr: '',
        })
    })
    const launch = vi.fn<IsolationLauncher['launch']>().mockReturnValue(firstLaunch)
    const service = createRunnerService({ launch }, { maxConcurrent: 1 })
    const first = service.execute(request)
    const saturated = await service.execute(request)
    expect(saturated.exit).toEqual({
      classification: 'resource-limit',
      errorId: 'runner.limit.processes',
    })
    expect(launch).toHaveBeenCalledTimes(1)
    release?.()
    await expect(first).resolves.toEqual(success)
  })
})
