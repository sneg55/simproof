import type {
  ConceptSpec,
  RunnerRequest,
  RunnerResponse,
  VerificationDependencyBinding,
} from '@simproof/contracts'
import {
  getDomainPack,
  hashCanonicalJson,
  hashNormalizedSource,
  PENDULUM_POLICY,
  PROJECTILE_POLICY,
} from '@simproof/verifier'
import { describe, expect, it, vi } from 'vitest'
import type { RunnerServicePort as RunnerService } from './runner-service-port.js'
import { createTrustedRunnerAdapter } from './trusted-runner-adapter.js'
import { createTrustedVerifierAdapter } from './trusted-verifier-adapter.js'

const runnerBinding = { version: '1.0.0', protocolVersion: '1' as const }
const limits = {
  timeoutMs: 2_000,
  memoryBytes: 134_217_728,
  maxOutputBytes: 65_536,
  maxSamples: 32,
}
const dependencies: VerificationDependencyBinding = {
  schemaVersion: '1',
  entries: [
    {
      id: 'runner-runtime',
      version: '1.0.0',
      contentHash: `sha256:${'d'.repeat(64)}`,
    },
  ],
  contentHash: `sha256:${'e'.repeat(64)}`,
}

const pendulumConcept: ConceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Small-angle pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 5, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
}

const projectileConcept: ConceptSpec = {
  schemaVersion: '1',
  domain: 'projectile',
  title: 'Projectile',
  parameters: {
    initialSpeed: { unit: 'm/s', defaultValue: 20, requestedRange: { min: 15, max: 40 } },
    launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
  },
  requestedControls: ['initialSpeed', 'launchAngle'],
}

const artifacts = {
  core: {
    path: 'core.mjs' as const,
    content:
      "export default { protocolVersion: '1', sample: input => ({ periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.81) }) }\n",
  },
  renderer: { path: 'renderer.json' as const, content: '{}' },
  manifest: { path: 'manifest.json' as const, content: '{}' },
  testAdapter: { path: 'test-adapter.json' as const, content: '{}' },
}

const requestId = '8d4448d2-45a1-4cb7-bd38-54341404304f'
const reportId = '018f6bc1-0811-70c1-a139-938a3ad2dee0'

function responseFor(request: RunnerRequest): RunnerResponse {
  if (request.domain !== 'pendulum') throw new TypeError('Expected pendulum request.')
  return {
    protocolVersion: '1',
    requestId: request.requestId,
    domain: 'pendulum',
    observedArtifactHash: request.artifact.hash,
    exit: { classification: 'success', errorId: null },
    samples: request.inputs.map(({ input, sampleId }) => ({
      sampleId,
      observation: {
        input,
        periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.81),
      },
    })),
    diagnostics: [],
  }
}

describe('trusted runner adapter', () => {
  it('builds the request from the installed policy grid and maps successful observations', async () => {
    let captured: RunnerRequest | undefined
    const execute = vi.fn<RunnerService['execute']>((input, signal) => {
      expect(signal).toBe(abort.signal)
      captured = input as RunnerRequest
      return Promise.resolve(responseFor(captured))
    })
    const abort = new AbortController()
    const adapter = createTrustedRunnerAdapter({
      service: { execute },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })

    const result = await adapter.execute(pendulumConcept, artifacts, abort.signal)

    expect(result).toMatchObject({
      ok: true,
      observations: expect.any(Array),
      diagnostics: [],
      verificationInput: { artifactSource: artifacts.core.content, runner: runnerBinding },
    })
    expect(captured).toEqual({
      protocolVersion: '1',
      requestId,
      artifact: {
        format: 'javascript-esm',
        content: artifacts.core.content,
        hash: result.ok ? result.artifactHash : undefined,
      },
      domain: 'pendulum',
      policy: {
        id: PENDULUM_POLICY.id,
        version: PENDULUM_POLICY.version,
        contentHash: hashCanonicalJson(PENDULUM_POLICY),
      },
      inputs: PENDULUM_POLICY.sampling.cases.map((input, index) => ({
        sampleId: `sample-${String(index + 1).padStart(4, '0')}`,
        input,
      })),
      limits,
    })
  })

  it('uses the complete deduplicated projectile verification grid', async () => {
    const execute = vi.fn<RunnerService['execute']>((input) => {
      const request = input as RunnerRequest
      expect(request.domain).toBe('projectile')
      expect(request.inputs).toHaveLength(9)
      expect(new Set(request.inputs.map(({ sampleId }) => sampleId)).size).toBe(9)
      expect(request.policy).toEqual({
        id: PROJECTILE_POLICY.id,
        version: PROJECTILE_POLICY.version,
        contentHash: hashCanonicalJson(PROJECTILE_POLICY),
      })
      return Promise.resolve({
        protocolVersion: '1',
        requestId: request.requestId,
        domain: 'projectile',
        observedArtifactHash: request.artifact.hash,
        exit: { classification: 'runtime-error', errorId: 'runner.runtime.crash' },
        samples: [],
        diagnostics: [
          { severity: 'error', code: 'runner.runtime.crash', message: 'Candidate crashed.' },
        ],
      })
    })
    const adapter = createTrustedRunnerAdapter({
      service: { execute },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })

    await expect(adapter.execute(projectileConcept, artifacts)).resolves.toEqual({
      ok: false,
      stableErrorId: 'runner.runtime.crash',
      diagnostics: [
        { severity: 'error', code: 'runner.runtime.crash', message: 'Candidate crashed.' },
      ],
    })
  })

  it('preserves the runner cancellation classification', async () => {
    const service: RunnerService = {
      execute: (input) => {
        const request = input as RunnerRequest
        return Promise.resolve({
          protocolVersion: '1',
          requestId: request.requestId,
          domain: 'pendulum',
          observedArtifactHash: request.artifact.hash,
          exit: { classification: 'cancelled', errorId: 'runner.cancelled' },
          samples: [],
          diagnostics: [
            { severity: 'error', code: 'runner.cancelled', message: 'Runner cancelled.' },
          ],
        })
      },
    }
    const adapter = createTrustedRunnerAdapter({ service, runner: runnerBinding, limits })

    await expect(adapter.execute(pendulumConcept, artifacts)).resolves.toMatchObject({
      ok: false,
      cancelled: true,
      stableErrorId: 'runner.cancelled',
    })
  })
})

describe('trusted verifier adapter', () => {
  it('returns an immutable full report and exact dependency binding', async () => {
    const runner = createTrustedRunnerAdapter({
      service: {
        execute: (input) => Promise.resolve(responseFor(input as RunnerRequest)),
      },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })
    const execution = await runner.execute(pendulumConcept, artifacts)
    if (!execution.ok) throw new TypeError('Expected successful runner execution.')
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    const result = await adapter.verify(pendulumConcept, execution)

    expect(result.verdict).toBe('verified')
    expect(result.report).toMatchObject({
      reportId,
      conceptSpecHash: hashCanonicalJson(pendulumConcept),
      artifact: { hash: hashNormalizedSource(artifacts.core.content) },
      policy: { id: PENDULUM_POLICY.id },
      domainPack: { id: getDomainPack('pendulum').id },
      runner: runnerBinding,
      observationHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      verdict: 'verified',
    })
    expect(result.dependencies).toEqual(dependencies)
    expect(result.reportHash).toBe(hashCanonicalJson(result.report))
    expect(result.findingsHash).toBe(hashCanonicalJson(result.report.findings))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.report)).toBe(true)
    expect(Object.isFrozen(result.report.checks)).toBe(true)
    expect(Object.isFrozen(result.dependencies.entries)).toBe(true)
  })

  it('derives scientific rejection from the trusted verifier', async () => {
    const runner = createTrustedRunnerAdapter({
      service: {
        execute: (input) => {
          const response = responseFor(input as RunnerRequest)
          if (response.domain !== 'pendulum') return Promise.resolve(response)
          return Promise.resolve({
            ...response,
            samples: response.samples.map((sample) => ({
              ...sample,
              observation: { ...sample.observation, periodS: 1 },
            })),
          })
        },
      },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })
    const execution = await runner.execute(pendulumConcept, artifacts)
    if (!execution.ok) throw new TypeError('Expected successful runner execution.')
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    const result = await adapter.verify(pendulumConcept, execution)

    expect(result.verdict).toBe('rejected')
    expect(result.report.verdict).toBe('rejected')
    expect(result.findings).toEqual(result.report.findings)
    expect(result.findings).not.toHaveLength(0)
  })

  it('rejects execution data that did not come from the trusted runner adapter', async () => {
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    await expect(
      adapter.verify(pendulumConcept, {
        ok: true,
        artifactHash: `sha256:${'a'.repeat(64)}`,
        observations: [],
        diagnostics: [],
      }),
    ).rejects.toThrow(/trusted runner execution/iu)
  })

  it('rejects tampering between runner execution and report construction', async () => {
    const runner = createTrustedRunnerAdapter({
      service: {
        execute: (input) => Promise.resolve(responseFor(input as RunnerRequest)),
      },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })
    const execution = await runner.execute(pendulumConcept, artifacts)
    if (!execution.ok) throw new TypeError('Expected successful runner execution.')
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    await expect(
      adapter.verify(pendulumConcept, {
        ...execution,
        verificationInput: {
          ...execution.verificationInput,
          artifactSource: `${execution.verificationInput.artifactSource}// tampered`,
        },
      }),
    ).rejects.toThrow(/artifact-bound/iu)
  })

  it('rejects a trusted execution with a different runner protocol binding', async () => {
    const runner = createTrustedRunnerAdapter({
      service: {
        execute: (input) => Promise.resolve(responseFor(input as RunnerRequest)),
      },
      runner: runnerBinding,
      limits,
      createRequestId: () => requestId,
    })
    const execution = await runner.execute(pendulumConcept, artifacts)
    if (!execution.ok) throw new TypeError('Expected successful runner execution.')
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    await expect(
      adapter.verify(pendulumConcept, {
        ...execution,
        verificationInput: {
          ...execution.verificationInput,
          runner: { ...execution.verificationInput.runner, protocolVersion: '2' as '1' },
        },
      }),
    ).rejects.toThrow(/trusted runner execution/iu)
  })

  it('honors cancellation before trusted verification starts', async () => {
    const abort = new AbortController()
    abort.abort('teacher-cancelled')
    const adapter = createTrustedVerifierAdapter({
      runner: runnerBinding,
      dependencies,
      createReportId: () => reportId,
      now: () => '2026-07-16T12:00:00.000Z',
    })

    await expect(
      adapter.verify(
        pendulumConcept,
        {
          ok: true,
          artifactHash: `sha256:${'a'.repeat(64)}`,
          observations: [],
          diagnostics: [],
        },
        abort.signal,
      ),
    ).rejects.toBe('teacher-cancelled')
  })
})
