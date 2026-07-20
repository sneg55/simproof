import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConceptSpec } from '@simproof/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexClientFactory } from './codex-client.js'
import { CodexCodeGenerator } from './codex-code-generator.js'

const roots: string[] = []

const workspace = async () => {
  const path = await mkdtemp(join(tmpdir(), 'simproof-codex-root-'))
  const canonical = await realpath(path)
  roots.push(canonical)
  return canonical
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })),
  )
})

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

const generatorFor = (
  workspaceRoot: string,
  stateRoot: string,
  forbiddenWorkspaceRoots?: readonly string[],
) => {
  const factory = { create: vi.fn() } satisfies CodexClientFactory
  const generator = new CodexCodeGenerator(
    {
      ...meteringPolicy,
      apiKey: 'server-only',
      model: 'codex-test',
      templateVersion: '1.0.0',
      stateRoot,
      workspaceRoot,
      ...(forbiddenWorkspaceRoots === undefined ? {} : { forbiddenWorkspaceRoots }),
    },
    { clientFactory: factory },
  )
  return { factory, generator }
}

describe('Codex workspace root isolation', () => {
  it.each([process.cwd(), '.'])(
    'rejects an unsafe workspace root %s before starting Codex',
    async (workspaceRoot) => {
      const { factory, generator } = generatorFor(workspaceRoot, await workspace())

      await expect(generator.generate({ conceptSpec })).resolves.toMatchObject({
        ok: false,
        kind: 'artifact-scope',
      })
      expect(factory.create).not.toHaveBeenCalled()
    },
  )

  it('rejects a workspace root that contains a protected runtime root', async () => {
    const workspaceRoot = await workspace()
    const protectedRoot = join(workspaceRoot, 'application-data')
    await mkdir(protectedRoot)
    const { factory, generator } = generatorFor(workspaceRoot, await workspace(), [protectedRoot])

    await expect(generator.generate({ conceptSpec })).resolves.toMatchObject({
      ok: false,
      kind: 'artifact-scope',
    })
    expect(factory.create).not.toHaveBeenCalled()
  })

  it('rejects a workspace root nested beneath a protected runtime root', async () => {
    const protectedRoot = await workspace()
    const workspaceRoot = join(protectedRoot, 'codex')
    await mkdir(workspaceRoot)
    const { factory, generator } = generatorFor(workspaceRoot, await workspace(), [protectedRoot])

    await expect(generator.generate({ conceptSpec })).resolves.toMatchObject({
      ok: false,
      kind: 'artifact-scope',
    })
    expect(factory.create).not.toHaveBeenCalled()
  })
})
