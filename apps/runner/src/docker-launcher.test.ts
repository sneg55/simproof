import type { RunnerLimits } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { buildDockerInvocation } from './docker-launcher.js'

const limits: RunnerLimits = {
  memoryBytes: 134_217_728,
  timeoutMs: 2_000,
  maxOutputBytes: 65_536,
  maxSamples: 100,
}
const image = `sha256:${'a'.repeat(64)}`

describe('Docker isolation invocation', () => {
  it('uses a fresh locked-down container without host mounts', () => {
    const invocation = buildDockerInvocation(image, limits, 'simproof-runner-abc123')

    expect(invocation.command).toBe('docker')
    expect(invocation.args).toEqual([
      'run',
      '--rm',
      '--interactive',
      '--name',
      'simproof-runner-abc123',
      '--pull',
      'never',
      '--label',
      'com.simproof.runner.owner=simproof-launcher-v1',
      '--label',
      `com.simproof.runner.image=${image}`,
      '--user',
      '65532:65532',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges=true',
      '--pids-limit',
      '32',
      '--memory',
      '134217728b',
      '--memory-swap',
      '134217728b',
      '--cpus',
      '0.5',
      '--ulimit',
      'nofile=64:64',
      '--tmpfs',
      '/work:rw,noexec,nosuid,nodev,size=16777216,mode=0700,uid=65532,gid=65532',
      '--env',
      'RUNNER_MAX_OUTPUT_BYTES=65536',
      '--workdir',
      '/work',
      image,
    ])
    expect(invocation.args).not.toContain('--privileged')
    expect(invocation.args).not.toContain('--volume')
    expect(invocation.args).not.toContain('--mount')
  })

  it('rejects mutable image tags and malformed container names', () => {
    expect(() => buildDockerInvocation('simproof-runner:latest', limits)).toThrow(
      'RUNNER_IMAGE_NOT_PINNED',
    )
    expect(() => buildDockerInvocation(image, limits, '../escape')).toThrow('RUNNER_NAME_INVALID')
    expect(() => buildDockerInvocation(`simproof-runner@sha256:${'a'.repeat(64)}`, limits)).toThrow(
      'RUNNER_IMAGE_NOT_PINNED',
    )
    expect(() => buildDockerInvocation(`--privileged@sha256:${'a'.repeat(64)}`, limits)).toThrow(
      'RUNNER_IMAGE_NOT_PINNED',
    )
  })
})
