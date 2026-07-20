import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  checkDeploymentPreparation,
  prepareDeployment,
  probeSocketGroup,
} from '../../../scripts/prepare-deployment.mjs'

const imageId = `sha256:${'a'.repeat(64)}`

describe('immutable deployment preparation', () => {
  it('builds the runner and writes only non-secret derived values to a private fragment', async () => {
    const root = await fixture()
    const docker = vi.fn((args: readonly string[]) => {
      if (args[0] === 'build') return ''
      if (args[0] === 'image') return imageId
      if (args[0] === 'context') return 'unix:///var/run/docker.sock'
      throw new Error('unexpected Docker command')
    })

    const output = await prepareDeployment({
      root,
      docker,
      socketGroup: () => 991,
    })

    expect(docker).toHaveBeenNthCalledWith(1, [
      'build',
      '--file',
      'apps/runner/Dockerfile',
      '--tag',
      'simproof-runner:local',
      '.',
    ])
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    const content = await readFile(output, 'utf8')
    expect(content).toContain(`SIMPROOF_RUNNER_IMAGE=${imageId}\n`)
    expect(content).toContain('SIMPROOF_DOCKER_SOCKET=/var/run/docker.sock\n')
    expect(content).toContain('SIMPROOF_DOCKER_GID=991\n')
    expect(content).toMatch(/SIMPROOF_RUNNER_SOURCE_SHA256=[a-f0-9]{64}\n/u)
    expect(content).not.toMatch(/(?:TOKEN|SECRET|OPENAI|CODEX)/u)
  })

  it('derives the supplemental group from the socket as mounted inside a container', async () => {
    const root = await fixture()
    const docker = vi.fn((args: readonly string[]) => {
      if (args[0] === 'build') return ''
      if (args[0] === 'image') return imageId
      if (args[0] === 'context') return 'unix:///host/docker.sock'
      if (args[0] === 'run') return '0'
      throw new Error('unexpected Docker command')
    })

    const output = await prepareDeployment({ root, docker })

    expect(docker).toHaveBeenCalledWith([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges=true',
      '--pids-limit',
      '16',
      '--memory',
      '64m',
      '--memory-swap',
      '64m',
      '--cpus',
      '0.25',
      '--user',
      '65532:65532',
      '--entrypoint',
      '/usr/local/bin/node',
      '--volume',
      '/host/docker.sock:/socket:ro',
      imageId,
      '-e',
      "process.stdout.write(String(require('node:fs').statSync('/socket').gid))",
    ])
    expect(await readFile(output, 'utf8')).toContain('SIMPROOF_DOCKER_GID=0\n')
  })

  it('refuses to probe with anything except the exact raw runner image ID', () => {
    expect(() =>
      probeSocketGroup(vi.fn(), '/var/run/docker.sock', 'simproof-runner:local'),
    ).toThrow('Runner image identity is invalid')
  })

  it('accepts the exact current image/source pair and rejects a rebuilt or stale pair', async () => {
    const root = await fixture()
    const docker = vi.fn((args: readonly string[]) => {
      if (args[0] === 'build') return ''
      if (args[0] === 'image') return imageId
      if (args[0] === 'context') return 'unix:///var/run/docker.sock'
      throw new Error('unexpected Docker command')
    })
    await prepareDeployment({ root, docker, socketGroup: () => 991 })
    await expect(
      checkDeploymentPreparation({ root, docker, socketGroup: () => 991 }),
    ).resolves.toBe(true)

    const rebuilt = vi.fn((args: readonly string[]) =>
      args[0] === 'image' ? `sha256:${'b'.repeat(64)}` : 'unix:///var/run/docker.sock',
    )
    await expect(
      checkDeploymentPreparation({ root, docker: rebuilt, socketGroup: () => 991 }),
    ).resolves.toBe(false)

    await writeFile(join(root, 'apps/runner/runtime/entrypoint.mjs'), '// changed\n')
    await expect(
      checkDeploymentPreparation({ root, docker, socketGroup: () => 991 }),
    ).resolves.toBe(false)
  })

  it('rejects a fragment with unsafe permissions or extra fields', async () => {
    const root = await fixture()
    const docker = vi.fn((args: readonly string[]) =>
      args[0] === 'image' ? imageId : args[0] === 'context' ? 'unix:///var/run/docker.sock' : '',
    )
    const output = await prepareDeployment({ root, docker, socketGroup: () => 991 })
    await chmod(output, 0o644)
    await expect(
      checkDeploymentPreparation({ root, docker, socketGroup: () => 991 }),
    ).resolves.toBe(false)
    await chmod(output, 0o600)
    await writeFile(output, `${await readFile(output, 'utf8')}SIMPROOF_SESSION_SECRET=forbidden\n`)
    await expect(
      checkDeploymentPreparation({ root, docker, socketGroup: () => 991 }),
    ).resolves.toBe(false)
  })

  it('rejects a changed socket context or GID and refuses a symlinked output parent', async () => {
    const root = await fixture()
    const docker = vi.fn((args: readonly string[]) =>
      args[0] === 'image' ? imageId : args[0] === 'context' ? 'unix:///socket-a' : '',
    )
    await prepareDeployment({ root, docker, socketGroup: () => 991 })
    await expect(
      checkDeploymentPreparation({ root, docker, socketGroup: () => 992 }),
    ).resolves.toBe(false)
    const changedContext = vi.fn((args: readonly string[]) =>
      args[0] === 'image' ? imageId : args[0] === 'context' ? 'tcp://docker.invalid:2376' : '',
    )
    await expect(
      checkDeploymentPreparation({ root, docker: changedContext, socketGroup: () => 991 }),
    ).resolves.toBe(false)

    const linkedRoot = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'simproof-prepare-outside-'))
    await symlink(outside, join(linkedRoot, '.simproof'))
    await expect(
      prepareDeployment({ root: linkedRoot, docker, socketGroup: () => 991 }),
    ).rejects.toThrow('Output directory is unsafe')
  })

  it.each(['unix:///var/run/docker.sock\nSIMPROOF_RUNNER_IMAGE=sha256:bad', 'unix:///socket=bad'])(
    'rejects an unsafe local socket value',
    async (socket) => {
      const root = await fixture()
      const docker = vi.fn((args: readonly string[]) =>
        args[0] === 'image' ? imageId : args[0] === 'context' ? socket : '',
      )
      await expect(prepareDeployment({ root, docker, socketGroup: () => 991 })).rejects.toThrow(
        'Docker context is not local',
      )
    },
  )
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'simproof-prepare-'))
  await mkdir(join(root, 'apps/runner/runtime'), { recursive: true })
  await writeFile(join(root, 'apps/runner/Dockerfile'), 'FROM scratch\n')
  await writeFile(join(root, 'apps/runner/runtime/entrypoint.mjs'), 'process.exit(0)\n')
  return root
}
