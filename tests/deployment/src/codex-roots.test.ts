import { chmod, lstat, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  prepareCodexRoots,
  validateConfiguredCodexRoots,
} from '../../../deployment/codex-roots.mjs'

describe('production Codex temporary roots', () => {
  it('prepares exact private roots on an empty owned tmpfs', async () => {
    const root = await privateRoot('empty')

    await prepareCodexRoots(root)

    for (const name of ['state', 'workspaces']) {
      const metadata = await lstat(join(root, name))
      expect(metadata.isDirectory()).toBe(true)
      expect(metadata.isSymbolicLink()).toBe(false)
      expect(metadata.mode & 0o777).toBe(0o700)
      expect(metadata.uid).toBe(process.getuid?.())
      expect(metadata.gid).toBe(process.getgid?.())
    }
  })

  it('fails closed for links, unexpected entries, or permissive roots', async () => {
    const linked = await privateRoot('linked')
    const target = await privateRoot('target')
    await symlink(target, join(linked, 'state'))
    await expect(prepareCodexRoots(linked)).rejects.toThrow('Codex temporary root is unsafe')

    const unexpected = await privateRoot('unexpected')
    await writeFile(join(unexpected, 'foreign'), 'unsafe')
    await expect(prepareCodexRoots(unexpected)).rejects.toThrow('Codex temporary root is unsafe')

    const permissive = await privateRoot('permissive')
    await chmod(permissive, 0o755)
    await expect(prepareCodexRoots(permissive)).rejects.toThrow('Codex temporary root is unsafe')
  })

  it('rejects configured roots outside the canonical owned tmpfs', () => {
    expect(() =>
      validateConfiguredCodexRoots({
        SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/state',
        SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/custom-workspaces',
      }),
    ).toThrow('Codex temporary root configuration is unsupported')
    expect(() =>
      validateConfiguredCodexRoots({
        SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/state',
        SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-codex/workspaces',
      }),
    ).not.toThrow()
  })
})

async function privateRoot(label: string) {
  const parent = await mkdtemp(join(tmpdir(), `simproof-codex-${label}-`))
  const root = join(parent, 'codex')
  await mkdir(root, { mode: 0o700 })
  return await realpath(root)
}
