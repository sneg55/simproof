// LOC-EXEMPT: One container lifecycle keeps the adversarial matrix and cleanup assertions auditable together.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { type RunnerLimits, type RunnerRequest, runnerResponseSchema } from '@simproof/contracts'
import { hashCanonicalJson, PENDULUM_POLICY } from '@simproof/verifier'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RUNNER_IMAGE_LABEL_KEY,
  RUNNER_OWNER_LABEL,
  reconcileDockerContainers,
} from './docker-container-lifecycle.js'
import { buildDockerInvocation, launchDockerContainer } from './docker-launcher.js'
import { createRunnerService } from './runner-service.js'

const root = resolve(import.meta.dirname, '../../..')
const tag = 'simproof-runner:security-test'
const architectureTags = ['simproof-runner:amd64-test', 'simproof-runner:arm64-test'] as const
const safeEnvironment = {
  HOME: homedir(),
  PATH: '/usr/local/bin:/usr/bin:/bin',
}
const limits: RunnerLimits = {
  memoryBytes: 134_217_728,
  timeoutMs: 2_000,
  maxOutputBytes: 65_536,
  maxSamples: 10,
}
let imageId = ''

interface ImageInspection {
  readonly Config: {
    readonly Entrypoint: readonly string[]
    readonly Env: readonly string[]
    readonly User: string
  }
}

interface ContainerInspection {
  readonly Config: { readonly User: string }
  readonly HostConfig: {
    readonly Binds: readonly string[] | null
    readonly CapDrop: readonly string[]
    readonly Memory: number
    readonly MemorySwap: number
    readonly NanoCpus: number
    readonly NetworkMode: string
    readonly PidsLimit: number
    readonly ReadonlyRootfs: boolean
    readonly SecurityOpt: readonly string[]
    readonly Tmpfs: Readonly<Record<string, string>>
  }
}

function docker(arguments_: readonly string[], input?: string) {
  return spawnSync('docker', arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: safeEnvironment,
    input,
    maxBuffer: 4_194_304,
  })
}

function requestFor(source: string, overrides: Partial<RunnerLimits> = {}): RunnerRequest {
  const hash = `sha256:${createHash('sha256').update(source).digest('hex')}` as const
  return {
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
    limits: { ...limits, ...overrides },
  }
}

async function launch(source: string, requestLimits: Partial<RunnerLimits> = {}) {
  const request = requestFor(source, requestLimits)
  return await launchDockerContainer(imageId, request.limits, JSON.stringify(request), {
    containerName: `simproof-runner-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`,
  })
}

function containerNameFor(source: string): string {
  return `simproof-runner-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
}

function expectRuntimeFailure(result: Awaited<ReturnType<typeof launch>>): void {
  expect(result.kind).toBe('exited')
  if (result.kind !== 'exited') return
  expect(result.exitCode).toBe(0)
  const response = runnerResponseSchema.parse(JSON.parse(result.stdout))
  expect(response.exit).toEqual({
    classification: 'runtime-error',
    errorId: 'runner.runtime.crash',
  })
  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(limits.maxOutputBytes)
  expect(JSON.stringify(response)).not.toMatch(/\/etc\/passwd|OPENAI|CODEX|TOKEN|SECRET/iu)
}

async function executeThroughService(source: string) {
  const service = createRunnerService({
    launch: async (serializedRequest, requestLimits, signal) =>
      await launchDockerContainer(imageId, requestLimits, serializedRequest, {
        containerName: containerNameFor(source),
        ...(signal === undefined ? {} : { signal }),
      }),
  })
  return await service.execute(requestFor(source))
}

beforeAll(() => {
  const build = docker(['build', '-f', 'apps/runner/Dockerfile', '-t', tag, '.'])
  expect(build.status, build.stderr).toBe(0)
  const inspect = docker(['image', 'inspect', tag, '--format', '{{.Id}}'])
  expect(inspect.status, inspect.stderr).toBe(0)
  imageId = inspect.stdout.trim()
  expect(imageId).toMatch(/^sha256:[a-f\d]{64}$/u)
}, 30_000)

afterAll(() => {
  docker(['image', 'rm', '--force', tag])
  for (const architectureTag of architectureTags) {
    docker(['image', 'rm', '--force', architectureTag])
  }
})

describe('runner container security boundary', () => {
  it('builds and runs the scratch image for AMD64 and ARM64', () => {
    for (const [platform, architectureTag, architecture] of [
      ['linux/amd64', architectureTags[0], 'amd64'],
      ['linux/arm64', architectureTags[1], 'arm64'],
    ] as const) {
      const build = docker([
        'build',
        '--platform',
        platform,
        '-f',
        'apps/runner/Dockerfile',
        '-t',
        architectureTag,
        '.',
      ])
      expect(build.status, build.stderr).toBe(0)
      const inspect = docker(['image', 'inspect', architectureTag, '--format', '{{.Architecture}}'])
      expect(inspect.status, inspect.stderr).toBe(0)
      expect(inspect.stdout.trim()).toBe(architecture)
      const run = docker([
        'run',
        '--rm',
        '--platform',
        platform,
        '--entrypoint',
        '/usr/local/bin/node',
        architectureTag,
        '--version',
      ])
      expect(run.status, run.stderr).toBe(0)
    }
  }, 60_000)

  it('has an immutable non-root, secret-free image configuration', () => {
    const inspected = docker(['image', 'inspect', imageId])
    expect(inspected.status, inspected.stderr).toBe(0)
    const image = (JSON.parse(inspected.stdout) as ImageInspection[]).at(0)
    expect(image).toBeDefined()
    if (image === undefined) throw new TypeError('Docker image inspection was empty.')
    expect(image.Config.User).toBe('65532:65532')
    expect(image.Config.Entrypoint).toContain('--permission')
    expect(image.Config.Entrypoint).toContain('--disallow-code-generation-from-strings')
    expect(image.Config.Entrypoint).toContain('/runner/entrypoint.mjs')
    expect(image.Config.Env.join('\n')).not.toMatch(/OPENAI|CODEX|SESSION|DATABASE|TOKEN|SECRET/iu)
    for (const executable of [
      '/bin/sh',
      '/usr/bin/apt-get',
      '/usr/bin/dpkg',
      '/usr/bin/perl',
      '/usr/bin/git',
      '/usr/bin/gcc',
      '/usr/bin/curl',
      '/usr/bin/wget',
    ]) {
      const result = docker(['run', '--rm', '--entrypoint', executable, imageId, '--version'])
      expect(result.status, executable).not.toBe(0)
    }
  })

  it('creates containers with the required host isolation controls', () => {
    const name = 'simproof-runner-c0ffee'
    const invocation = buildDockerInvocation(imageId, limits, name)
    const createArguments = invocation.args.filter((argument) => argument !== '--rm')
    createArguments[0] = 'create'
    const created = docker(createArguments)
    expect(created.status, created.stderr).toBe(0)
    try {
      const inspected = docker(['container', 'inspect', name])
      expect(inspected.status, inspected.stderr).toBe(0)
      const container = (JSON.parse(inspected.stdout) as ContainerInspection[]).at(0)
      expect(container).toBeDefined()
      if (container === undefined) throw new TypeError('Docker container inspection was empty.')
      expect(container.Config.User).toBe('65532:65532')
      expect(container.HostConfig.NetworkMode).toBe('none')
      expect(container.HostConfig.ReadonlyRootfs).toBe(true)
      expect(container.HostConfig.CapDrop).toEqual(['ALL'])
      expect(container.HostConfig.SecurityOpt).toContain('no-new-privileges=true')
      expect(container.HostConfig.PidsLimit).toBe(32)
      expect(container.HostConfig.Memory).toBe(limits.memoryBytes)
      expect(container.HostConfig.MemorySwap).toBe(limits.memoryBytes)
      expect(container.HostConfig.NanoCpus).toBe(500_000_000)
      expect(container.HostConfig.Binds).toBeNull()
      const workTmpfs = Object.entries(container.HostConfig.Tmpfs).find(
        ([path]) => path === '/work',
      )
      expect(workTmpfs?.[1]).toContain('noexec')
      expect(JSON.stringify(container)).not.toContain('/var/run/docker.sock')
      expect(JSON.stringify(container)).not.toContain(root)
    } finally {
      docker(['container', 'rm', '--force', name])
    }
  })

  it('reconciles exact-image launcher orphans and rejects mismatched ownership claims', async () => {
    const orphan = 'simproof-runner-0ddba11'
    const created = docker([
      'create',
      '--name',
      orphan,
      '--label',
      RUNNER_OWNER_LABEL,
      '--label',
      `${RUNNER_IMAGE_LABEL_KEY}=${imageId}`,
      imageId,
    ])
    expect(created.status, created.stderr).toBe(0)
    await expect(reconcileDockerContainers(imageId)).resolves.toBe(true)
    expect(docker(['container', 'inspect', orphan]).status).not.toBe(0)

    const mismatched = 'simproof-runner-bad1abe1'
    const mismatchCreated = docker([
      'create',
      '--name',
      mismatched,
      '--label',
      RUNNER_OWNER_LABEL,
      '--label',
      `${RUNNER_IMAGE_LABEL_KEY}=sha256:${'b'.repeat(64)}`,
      imageId,
    ])
    expect(mismatchCreated.status, mismatchCreated.stderr).toBe(0)
    try {
      await expect(reconcileDockerContainers(imageId)).resolves.toBe(false)
      expect(docker(['container', 'inspect', mismatched]).status).toBe(0)
    } finally {
      docker(['container', 'rm', '--force', mismatched])
    }
  })

  it('executes a pure deterministic core and returns normalized samples', async () => {
    const result = await launch(
      "export default { protocolVersion: '1', sample: input => ({ periodS: 2 * input.lengthM }) }",
    )
    expect(result.kind).toBe('exited')
    if (result.kind !== 'exited') return
    expect(result.exitCode, result.stderr).toBe(0)
    const response = runnerResponseSchema.parse(JSON.parse(result.stdout))
    expect(response.exit).toEqual({ classification: 'success', errorId: null })
    expect(response.samples[0]).toEqual({
      sampleId: 'baseline',
      observation: { input: { lengthM: 1, amplitudeDeg: 10 }, periodS: 2 },
    })
  })

  it('blocks obfuscated function construction inside the container', async () => {
    const result = await launch(`export default { protocolVersion: '1', sample(input) {
      const host = ({})['con' + 'structor']['con' + 'structor']('return process')()
      host.stdout.write('forged')
      return { periodS: input.lengthM * 2 }
    } }`)
    expectRuntimeFailure(result)
  })

  it('freezes generated-code inputs and retains the trusted request value', async () => {
    const result = await launch(`export default { protocolVersion: '1', sample(input) {
      input.lengthM = 999
      return { periodS: input.lengthM * 2 }
    } }`)
    expectRuntimeFailure(result)
  })

  it('contains filesystem and network attempts without host side effects', async () => {
    const filesystem = await launch(`
      export default { protocolVersion: '1', async sample(input) {
        const filesystem = await import('node:fs/promises')
        await filesystem.writeFile('/runner/escaped', 'owned')
        return { periodS: input.lengthM * 2 }
      } }`)
    expect(filesystem.kind).toBe('exited')
    if (filesystem.kind === 'exited') {
      const response = runnerResponseSchema.parse(JSON.parse(filesystem.stdout))
      expect(response.exit).toEqual({
        classification: 'runtime-error',
        errorId: 'runner.runtime.crash',
      })
    }
    const network = await launch(`
      export default { protocolVersion: '1', async sample(input) {
        await fetch('http://198.51.100.1/')
        return { periodS: input.lengthM * 2 }
      } }`)
    expectRuntimeFailure(network)
    const escaped = docker([
      'run',
      '--rm',
      '--entrypoint',
      'node',
      imageId,
      '-e',
      "require('fs').accessSync('/runner/escaped')",
    ])
    expect(escaped.status).not.toBe(0)
  })

  it.each([
    [
      'filesystem read and traversal',
      `const fs = await import('node:fs/promises'); await fs.readFile('/etc/passwd')`,
    ],
    [
      'subprocess',
      `const child = await import('node:child_process'); child.execFileSync('/usr/local/bin/node', ['--version'])`,
    ],
    [
      'worker',
      `const threads = await import('node:worker_threads'); await new Promise((resolve, reject) => { const worker = new threads.Worker(''); worker.once('online', resolve); worker.once('error', reject) })`,
    ],
    ['WASI', `const wasi = await import('node:wasi'); new wasi.WASI({ version: 'preview1' })`],
    ['inspector', `const inspector = await import('node:inspector'); inspector.open()`],
    [
      'native .node addon',
      `const host = ({}).constructor.constructor('return process')(); host.dlopen({}, '/work/fake.node')`,
    ],
    [
      'loader hook',
      `const modules = await import('node:module'); modules.register('file:///work/loader.mjs')`,
    ],
    [
      'PID pressure',
      `const child = await import('node:child_process'); for (let index = 0; index < 64; index += 1) child.spawn('/usr/local/bin/node')`,
    ],
  ])('contains %s attempts and removes the container', async (_name, attempt) => {
    const source = `export default { protocolVersion: '1', async sample(input) {
      ${attempt}
      return { periodS: input.lengthM * 2 }
    } }`
    const result = await launch(source)
    expectRuntimeFailure(result)
    expect(docker(['container', 'inspect', containerNameFor(source)]).status).not.toBe(0)
  })

  it.each([
    ['DNS', `const dns = await import('node:dns/promises'); await dns.lookup('example.test')`],
    [
      'TCP',
      `const net = await import('node:net'); await new Promise((resolve, reject) => { const socket = net.connect(80, '198.51.100.1'); socket.once('connect', resolve); socket.once('error', reject) })`,
    ],
    [
      'UDP',
      `const dgram = await import('node:dgram'); await new Promise((resolve, reject) => { const socket = dgram.createSocket('udp4'); socket.send('x', 9, '198.51.100.1', error => error ? reject(error) : resolve()); socket.unref() })`,
    ],
  ])('contains %s network attempts and removes the container', async (_name, attempt) => {
    const source = `export default { protocolVersion: '1', async sample(input) {
      ${attempt}
      return { periodS: input.lengthM * 2 }
    } }`
    const result = await launch(source)
    expectRuntimeFailure(result)
    expect(docker(['container', 'inspect', containerNameFor(source)]).status).not.toBe(0)
  })

  it('does not inherit host secrets and removes containers after limits or cancellation', async () => {
    const environment = await launch(`
      export default { protocolVersion: '1', sample() {
        const exposed = Object.keys(process.env).some(key => /OPENAI|CODEX|TOKEN|SECRET/i.test(key))
        return { periodS: exposed ? 1 : 2 }
      } }`)
    expect(environment.kind).toBe('exited')
    if (environment.kind === 'exited') {
      const response = runnerResponseSchema.parse(JSON.parse(environment.stdout))
      expect(response.samples[0]?.observation).toMatchObject({ periodS: 2 })
    }

    const infiniteSource = "export default { protocolVersion: '1', sample() { while (true) {} } }"
    const infiniteName = `simproof-runner-${createHash('sha256').update(infiniteSource).digest('hex').slice(0, 12)}`
    await expect(launch(infiniteSource, { timeoutMs: 250 })).resolves.toEqual({ kind: 'timeout' })
    expect(docker(['container', 'inspect', infiniteName]).status).not.toBe(0)

    const controller = new AbortController()
    const cancellationName = 'simproof-runner-cace11ed'
    const cancellation = launchDockerContainer(
      imageId,
      limits,
      JSON.stringify(requestFor(infiniteSource)),
      { signal: controller.signal, containerName: cancellationName },
    )
    await new Promise((resolveCancellationSetup) => setTimeout(resolveCancellationSetup, 100))
    controller.abort()
    await expect(cancellation).resolves.toEqual({ kind: 'cancelled' })
    expect(docker(['container', 'inspect', cancellationName]).status).not.toBe(0)
  })

  it('caps hostile stdout and removes the disposable container', async () => {
    const source = `export default { protocolVersion: '1', sample(input) {
      process.stdout.write('x'.repeat(200000))
      return { periodS: input.lengthM * 2 }
    } }`
    const name = `simproof-runner-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
    await expect(launch(source, { maxOutputBytes: 4_096 })).resolves.toEqual({
      kind: 'output-limit',
    })
    expect(docker(['container', 'inspect', name]).status).not.toBe(0)
  })

  it('classifies malformed input, signals, and memory pressure without residue', async () => {
    const malformedName = 'simproof-runner-badf00d'
    const malformed = await launchDockerContainer(imageId, limits, '{', {
      containerName: malformedName,
    })
    expect(malformed.kind).toBe('exited')
    if (malformed.kind === 'exited') expect(malformed.exitCode).not.toBe(0)
    expect(docker(['container', 'inspect', malformedName]).status).not.toBe(0)

    const signalSource = `export default { protocolVersion: '1', sample() {
      process.kill(process.pid, 'SIGKILL')
    } }`
    const signalled = await launch(signalSource)
    expectRuntimeFailure(signalled)
    expect(docker(['container', 'inspect', containerNameFor(signalSource)]).status).not.toBe(0)

    const memorySource = `export default { protocolVersion: '1', sample() {
      const values = []; while (true) values.push(Buffer.alloc(4000000))
    } }`
    const pressured = await launch(memorySource, { memoryBytes: 67_108_864, timeoutMs: 1_000 })
    expect(pressured).toEqual({ kind: 'timeout' })
    expect(docker(['container', 'inspect', containerNameFor(memorySource)]).status).not.toBe(0)
  })

  it('uses disposable workspaces for sequential and concurrent sentinels', async () => {
    const writeSource = `export default { protocolVersion: '1', async sample(input) {
      const fs = await import('node:fs/promises'); await fs.writeFile('/work/stale', '7')
      return { periodS: input.lengthM * 2 }
    } }`
    const written = await launch(writeSource)
    expect(written.kind).toBe('exited')
    if (written.kind === 'exited') {
      const response = runnerResponseSchema.parse(JSON.parse(written.stdout))
      expect(response.exit.classification).toBe('success')
    }
    const readSource = `export default { protocolVersion: '1', async sample(input) {
      const fs = await import('node:fs/promises'); await fs.readFile('/work/stale')
      return { periodS: input.lengthM * 2 }
    } }`
    expectRuntimeFailure(await launch(readSource))

    const concurrentSource = (
      sentinel: number,
    ) => `export default { protocolVersion: '1', async sample(input) {
      const fs = await import('node:fs/promises'); await fs.writeFile('/work/shared', '${sentinel}')
      const value = Number(await fs.readFile('/work/shared', 'utf8'))
      return { periodS: value }
    } }`
    const [left, right] = await Promise.all([
      launch(concurrentSource(3)),
      launch(concurrentSource(5)),
    ])
    for (const [result, expected] of [
      [left, 3],
      [right, 5],
    ] as const) {
      expect(result.kind).toBe('exited')
      if (result.kind !== 'exited') continue
      const response = runnerResponseSchema.parse(JSON.parse(result.stdout))
      expect(response.samples[0]?.observation).toMatchObject({ periodS: expected })
    }
    for (const source of [writeSource, readSource, concurrentSource(3), concurrentSource(5)]) {
      expect(docker(['container', 'inspect', containerNameFor(source)]).status).not.toBe(0)
    }
  })

  it('rejects a direct constructor escape before it can forge protocol output', async () => {
    const source = `export default { protocolVersion: '1', sample(input) {
      const host = ({}).constructor.constructor('return process')()
      host.stdout.write('malformed-prefix')
      return { periodS: input.lengthM * 2 }
    } }`
    const response = await executeThroughService(source)
    expect(response.exit).toEqual({
      classification: 'policy-denied',
      errorId: 'runner.denied.dynamic-code',
    })
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(limits.maxOutputBytes)
    expect(JSON.stringify(response)).not.toContain('malformed-prefix')
    expect(docker(['container', 'inspect', containerNameFor(source)]).status).not.toBe(0)
  })
})
