import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConceptSpec } from '@simproof/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexClient, CodexClientFactory } from './codex-client.js'
import {
  ALLOWED_CODEX_ARTIFACT_PATHS,
  CodexCodeGenerator,
  createCodexEnvironment,
} from './codex-code-generator.js'
import { FilesystemCodexStateStore } from './codex-state.js'

const workspaces: string[] = []
const meteringPolicy = {
  generateReservation: {
    inputTokens: 100,
    outputTokens: 10,
    requestCount: 1 as const,
    costMicrousd: 1_000,
  },
  repairReservation: {
    inputTokens: 100,
    outputTokens: 5,
    requestCount: 1 as const,
    costMicrousd: 1_000,
  },
  estimateCostMicrousd: ({
    inputTokens,
    outputTokens,
  }: {
    inputTokens: number
    outputTokens: number
  }) => inputTokens + outputTokens,
  failedCallUsage: { inputTokens: 1, outputTokens: 1, costMicrousd: 1 },
}
const conceptSpec: ConceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Simple pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.2, max: 3 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })),
  )
})

const workspace = async () => {
  const path = await mkdtemp(join(tmpdir(), 'simproof-codex-'))
  const canonical = await realpath(path)
  workspaces.push(canonical)
  return canonical
}

const writeAllowedArtifacts = async (path: string) => {
  await Promise.all([
    writeFile(
      join(path, 'core.mjs'),
      "export default { protocolVersion: '1', sample: input => ({ input, periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.80665) }) }",
    ),
    writeFile(join(path, 'renderer.json'), JSON.stringify({ kind: 'pendulum' })),
    writeFile(
      join(path, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1',
        domain: 'pendulum',
        core: 'core.mjs',
        renderer: 'renderer.json',
        testAdapter: 'test-adapter.json',
      }),
    ),
    writeFile(join(path, 'test-adapter.json'), JSON.stringify({ schemaVersion: '1', cases: [] })),
  ])
}

const clientWriting = (write: (path: string) => Promise<void>) => {
  const run = vi.fn(() =>
    Promise.resolve({
      items: [{ id: 'message_1', type: 'agent_message' as const, text: 'done' }],
      finalResponse: JSON.stringify({ status: 'complete', files: ALLOWED_CODEX_ARTIFACT_PATHS }),
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cached_input_tokens: 0,
        reasoning_output_tokens: 0,
      },
    }),
  )
  const startThread = vi.fn((options: { workingDirectory?: string }) => ({
    id: 'thread_1',
    run: async (...arguments_: Parameters<typeof run>) => {
      await write(options.workingDirectory ?? '')
      return await run(...arguments_)
    },
  }))
  const client = { startThread, resumeThread: vi.fn() } satisfies CodexClient
  const factory = { create: vi.fn(() => client) } satisfies CodexClientFactory
  return { factory, run, startThread }
}

describe('Codex SDK code generator', () => {
  it('locks every SDK security option and returns only the allowlisted inventory', async () => {
    const root = await workspace()
    const stateRoot = await workspace()
    const { factory, run, startThread } = clientWriting(writeAllowedArtifacts)
    const generator = new CodexCodeGenerator(
      {
        ...meteringPolicy,
        apiKey: 'server-only',
        model: 'codex-test',
        templateVersion: '1.0.0',
        stateRoot,
        workspaceRoot: root,
      },
      { clientFactory: factory },
    )

    const result = await generator.generate({ conceptSpec })

    expect(startThread).toHaveBeenCalledWith({
      additionalDirectories: [],
      approvalPolicy: 'never',
      model: 'codex-test',
      networkAccessEnabled: false,
      sandboxMode: 'danger-full-access',
      skipGitRepoCheck: true,
      webSearchMode: 'disabled',
      workingDirectory: expect.stringMatching(/^\/.*simproof-codex-.*\/artifact-/u),
    })
    // The turn must not be forced into a structured-output object: an
    // outputSchema made the model emit the completion JSON instead of writing
    // the artifact files, leaving the workspace empty. With no abort signal the
    // options object carries nothing at all.
    expect(run).toHaveBeenCalledWith(expect.any(String), {})
    expect(factory.create).toHaveBeenCalledWith({
      CODEX_HOME: expect.stringContaining(`${stateRoot}/pending-`),
      HOME: expect.stringContaining(`${stateRoot}/pending-`),
      TMPDIR: expect.stringContaining('/temp-'),
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        threadId: 'thread_1',
        provenance: {
          provider: 'codex-sdk',
          threadId: 'thread_1',
          usage: { outputTokens: 20 },
        },
      },
    })
    expect(generator.generateReservation.outputTokens).toBe(10)
    expect(Object.isFrozen(generator.generateReservation)).toBe(true)
    if (result.ok) {
      expect([
        result.value.artifacts.core.path,
        result.value.artifacts.renderer.path,
        result.value.artifacts.manifest.path,
        result.value.artifacts.testAdapter.path,
      ]).toEqual(ALLOWED_CODEX_ARTIFACT_PATHS)
    }
    expect(await readdir(root)).toEqual([])
    expect(await readdir(stateRoot)).toHaveLength(1)
    expect(await generator.disposeThread('thread_1')).toBe(true)
    expect(await readdir(stateRoot)).toEqual([])
  })

  it('rejects unexpected files even when Codex declares only allowed files', async () => {
    const root = await workspace()
    const stateRoot = await workspace()
    const { factory } = clientWriting(async (directory) => {
      await writeAllowedArtifacts(directory)
      await writeFile(join(directory, 'verifier-policy.ts'), 'forbidden')
    })
    const generator = new CodexCodeGenerator(
      {
        ...meteringPolicy,
        apiKey: 'server-only',
        model: 'codex-test',
        templateVersion: '1.0.0',
        stateRoot,
        workspaceRoot: root,
      },
      { clientFactory: factory },
    )

    const result = await generator.generate({ conceptSpec })
    expect(result).toMatchObject({
      ok: false,
      kind: 'artifact-scope',
      error: { category: 'invariant' },
    })
    expect(await readdir(root)).toEqual([])
    expect(await readdir(stateRoot)).toEqual([])
  })

  it('resumes the generation thread for repair and forwards cancellation', async () => {
    const root = await workspace()
    const stateRoot = await workspace()
    const previousRoot = await workspace()
    await writeAllowedArtifacts(previousRoot)
    const run = vi.fn(() =>
      Promise.resolve({
        items: [{ id: 'message_2', type: 'agent_message' as const, text: 'repaired' }],
        finalResponse: JSON.stringify({ status: 'complete', files: ALLOWED_CODEX_ARTIFACT_PATHS }),
        usage: {
          input_tokens: 8,
          output_tokens: 12,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    )
    const resumeThread = vi.fn(() => ({ id: 'thread_1', run }))
    const client = { startThread: vi.fn(), resumeThread } satisfies CodexClient
    const factory = { create: vi.fn(() => client) } satisfies CodexClientFactory
    const stateStore = new FilesystemCodexStateStore(stateRoot)
    const pendingState = await stateStore.begin()
    expect(pendingState.ok).toBe(true)
    if (!pendingState.ok) return
    expect(await pendingState.value.adopt('thread_1')).toBe(true)
    const generator = new CodexCodeGenerator(
      {
        ...meteringPolicy,
        apiKey: 'server-only',
        model: 'codex-test',
        templateVersion: '1.0.0',
        stateRoot,
        workspaceRoot: root,
      },
      { clientFactory: factory, stateStore },
    )
    const controller = new AbortController()

    const previousArtifacts = {
      core: {
        path: 'core.mjs' as const,
        content: await readFile(join(previousRoot, 'core.mjs'), 'utf8'),
      },
      renderer: {
        path: 'renderer.json' as const,
        content: await readFile(join(previousRoot, 'renderer.json'), 'utf8'),
      },
      manifest: {
        path: 'manifest.json' as const,
        content: await readFile(join(previousRoot, 'manifest.json'), 'utf8'),
      },
      testAdapter: {
        path: 'test-adapter.json' as const,
        content: await readFile(join(previousRoot, 'test-adapter.json'), 'utf8'),
      },
    }

    const result = await generator.repair(
      {
        conceptSpec,
        previousArtifacts,
        findings: [],
        diagnostics: [],
        threadId: 'thread_1',
      },
      { signal: controller.signal },
    )

    expect(resumeThread).toHaveBeenCalledWith(
      'thread_1',
      expect.objectContaining({ workingDirectory: expect.stringContaining(`${root}/artifact-`) }),
    )
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(result).toMatchObject({
      ok: true,
      value: { provenance: { usage: { outputTokens: 12 } } },
    })
    expect(generator.repairReservation.outputTokens).toBe(5)
    expect(await generator.disposeThread('thread_1')).toBe(true)
    expect(await readdir(stateRoot)).toEqual([])
  })

  it('passes only explicitly allowlisted non-secret environment values', () => {
    expect(
      createCodexEnvironment(
        {
          PATH: '/bin',
          TMPDIR: '/host/tmp',
          OPENAI_API_KEY: 'must-not-pass',
          OTHER_SECRET: 'must-not-pass',
        },
        '/trusted/temp',
        '/trusted/state',
      ),
    ).toEqual({
      CODEX_HOME: '/trusted/state',
      HOME: '/trusted/state',
      PATH: '/bin',
      TMPDIR: '/trusted/temp',
    })
  })

  it('cleans the workspace and meters a failed Codex request', async () => {
    const root = await workspace()
    const stateRoot = await workspace()
    const run = vi.fn(() =>
      Promise.reject(Object.assign(new Error('unavailable'), { status: 503 })),
    )
    const client = {
      startThread: vi.fn(() => ({ id: 'thread_failed', run })),
      resumeThread: vi.fn(),
    } satisfies CodexClient
    const factory = { create: vi.fn(() => client) } satisfies CodexClientFactory
    const generator = new CodexCodeGenerator(
      {
        ...meteringPolicy,
        apiKey: 'server-only',
        model: 'codex-test',
        templateVersion: '1.0.0',
        stateRoot,
        workspaceRoot: root,
      },
      { clientFactory: factory },
    )

    const result = await generator.generate({ conceptSpec })

    expect(result).toMatchObject({
      ok: false,
      error: { category: 'transient' },
      metering: {
        usage: { inputTokens: 1, outputTokens: 1, requestCount: 1, costMicrousd: 1 },
      },
    })
    expect(await readdir(root)).toEqual([])
    expect(await readdir(stateRoot)).toEqual([])
  })

  it('does not charge a request when client setup fails before thread dispatch', async () => {
    const root = await workspace()
    const stateRoot = await workspace()
    const factory = {
      create: vi.fn(() => {
        throw Object.assign(new Error('client setup failed'), { status: 503 })
      }),
    } satisfies CodexClientFactory
    const generator = new CodexCodeGenerator(
      {
        ...meteringPolicy,
        apiKey: 'server-only',
        model: 'codex-test',
        templateVersion: '1.0.0',
        stateRoot,
        workspaceRoot: root,
      },
      { clientFactory: factory },
    )

    const result = await generator.generate({ conceptSpec })

    expect(result).toMatchObject({
      ok: false,
      error: { category: 'transient' },
      metering: {
        usage: { inputTokens: 0, outputTokens: 0, requestCount: 0, costMicrousd: 0 },
      },
    })
    expect(await readdir(root)).toEqual([])
    expect(await readdir(stateRoot)).toEqual([])
  })
})
