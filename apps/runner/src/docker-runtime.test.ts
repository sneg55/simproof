import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDockerLauncherRuntime } from './docker-runtime.js'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  )
})

describe('Docker launcher runtime', () => {
  it('reconciles before readiness and drains active execution through bounded cleanup', async () => {
    const fixture = await dockerFixture()
    const image = `sha256:${'a'.repeat(64)}`
    const runtime = createDockerLauncherRuntime(image, fixture.command)
    await expect(runtime.initialize()).resolves.toBe(true)
    await expect(runtime.readiness()).resolves.toBe(true)

    const running = runtime.launch('{}', {
      memoryBytes: 16_777_216,
      timeoutMs: 30_000,
      maxOutputBytes: 1_024,
      maxSamples: 1,
    })
    await vi.waitFor(async () => {
      expect(await readFile(fixture.log, 'utf8')).toContain('run')
    })
    await expect(runtime.close()).resolves.toBe(true)

    await expect(running).resolves.toEqual({ kind: 'cancelled' })
    const calls = (await readFile(fixture.log, 'utf8')).trim().split('\n')
    expect(calls.filter((call) => call.startsWith('container rm --force'))).toHaveLength(1)
    await expect(runtime.readiness()).resolves.toBe(false)
    expect(calls.filter((call) => call.startsWith('container ls'))).toHaveLength(4)
  })
})

async function dockerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'simproof-docker-runtime-'))
  roots.push(root)
  const command = join(root, 'docker.mjs')
  const log = join(root, 'calls')
  await writeFile(
    command,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n')
if (args[0] === 'run') setInterval(() => undefined, 1000)
else if (args[0] === 'container' && args[1] === 'ls') process.exit(0)
else if (args[0] === 'container' && args[1] === 'rm') process.exit(0)
else if (args[0] === 'image' && args[1] === 'inspect') process.exit(0)
else process.exit(1)
`,
  )
  await chmod(command, 0o700)
  return { command, log }
}
