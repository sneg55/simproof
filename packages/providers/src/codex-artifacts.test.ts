import { mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validatedTurnArtifacts } from './codex-artifacts.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'simproof-artifacts-'))
  roots.push(path)
  return path
}

const writeArtifacts = async (workspace: string) => {
  await Promise.all([
    writeFile(join(workspace, 'core.mjs'), 'export default Object.freeze({ value: 1 })'),
    writeFile(join(workspace, 'renderer.json'), JSON.stringify({ kind: 'pendulum' })),
    writeFile(
      join(workspace, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1',
        domain: 'pendulum',
        core: 'core.mjs',
        renderer: 'renderer.json',
        testAdapter: 'test-adapter.json',
      }),
    ),
    writeFile(join(workspace, 'test-adapter.json'), JSON.stringify({ cases: [] })),
  ])
}

const completedTurn = {
  finalResponse: JSON.stringify({
    status: 'complete',
    files: ['core.mjs', 'renderer.json', 'manifest.json', 'test-adapter.json'],
  }),
  items: [],
}

describe('Codex artifact handle validation', () => {
  it('accepts an unchanged exact four-file inventory', async () => {
    const workspace = await temporaryDirectory()
    await writeArtifacts(workspace)

    const result = await validatedTurnArtifacts(workspace, completedTurn, 'pendulum')

    expect(result?.core.content).toContain('Object.freeze')
  })

  it('accepts artifacts even when the final response is not a completion object', async () => {
    // The model is not forced into a structured-output object, so its final
    // message is free-form prose. What matters is the four validated files it
    // actually wrote, not what it says it did.
    const workspace = await temporaryDirectory()
    await writeArtifacts(workspace)

    const freeformTurn = { finalResponse: 'Created and verified all four files.', items: [] }
    const result = await validatedTurnArtifacts(workspace, freeformTurn, 'pendulum')

    expect(result?.core.content).toContain('Object.freeze')
  })

  it('rejects a turn that reports writing outside the artifact allowlist', async () => {
    const workspace = await temporaryDirectory()
    await writeArtifacts(workspace)

    const escapingTurn = {
      finalResponse: 'done',
      items: [{ type: 'file_change', changes: [{ path: '/etc/passwd' }] }],
    }
    const result = await validatedTurnArtifacts(workspace, escapingTurn, 'pendulum')

    expect(result).toBeUndefined()
  })

  it('rejects a link replacement between lstat and no-follow open', async () => {
    const workspace = await temporaryDirectory()
    const external = await temporaryDirectory()
    const externalCore = join(external, 'external-core.mjs')
    await Promise.all([writeArtifacts(workspace), writeFile(externalCore, 'export default {}')])

    const result = await validatedTurnArtifacts(workspace, completedTurn, 'pendulum', {
      afterLstat: async (name, path) => {
        if (name !== 'core.mjs') return
        await rm(path)
        await symlink(externalCore, path, 'file')
      },
    })

    expect(result).toBeUndefined()
  })

  it('rejects a link replacement after opening the original file handle', async () => {
    const workspace = await temporaryDirectory()
    const external = await temporaryDirectory()
    const externalCore = join(external, 'external-core.mjs')
    await Promise.all([writeArtifacts(workspace), writeFile(externalCore, 'export default {}')])

    const result = await validatedTurnArtifacts(workspace, completedTurn, 'pendulum', {
      afterOpen: async (name, path) => {
        if (name !== 'core.mjs') return
        const displaced = join(external, 'displaced-core.mjs')
        await rename(path, displaced)
        await symlink(externalCore, path, 'file')
        await rm(displaced)
      },
    })

    expect(result).toBeUndefined()
  })

  it('bounds a file that grows after its opened-handle metadata check', async () => {
    const workspace = await temporaryDirectory()
    await writeArtifacts(workspace)

    const result = await validatedTurnArtifacts(workspace, completedTurn, 'pendulum', {
      afterOpen: async (name, path) => {
        if (name === 'core.mjs') await writeFile(path, 'x'.repeat(262_145))
      },
    })

    expect(result).toBeUndefined()
  })

  it('rejects an undeclared entry added immediately before the final inventory', async () => {
    const workspace = await temporaryDirectory()
    await writeArtifacts(workspace)

    const result = await validatedTurnArtifacts(workspace, completedTurn, 'pendulum', {
      beforeFinalInventory: async (path) => {
        await writeFile(join(path, '.tmp'), 'undeclared')
      },
    })

    expect(result).toBeUndefined()
  })
})
