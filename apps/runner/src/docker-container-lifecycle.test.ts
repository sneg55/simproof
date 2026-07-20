import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { reconcileDockerContainers, removeDockerContainer } from './docker-container-lifecycle.js'

const roots: string[] = []
const image = `sha256:${'a'.repeat(64)}`

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  )
})

describe('bounded Docker container lifecycle', () => {
  it('uses a bounded serialized remove/inspect fallback', async () => {
    const fixture = await commandFixture(['rm:1', 'inspect:1'])
    await expect(removeDockerContainer('simproof-runner-c0ffee', fixture.command)).resolves.toBe(
      true,
    )
    expect((await readFile(fixture.log, 'utf8')).trim().split('\n')).toEqual([
      'container rm --force simproof-runner-c0ffee',
      'container inspect simproof-runner-c0ffee',
    ])
  })

  it('fails cleanup when the container remains inspectable', async () => {
    const fixture = await commandFixture(['rm:1', 'inspect:0'])
    await expect(removeDockerContainer('simproof-runner-c0ffee', fixture.command)).resolves.toBe(
      false,
    )
    expect((await readFile(fixture.log, 'utf8')).trim().split('\n')).toHaveLength(2)
  })

  it('removes only exact-image owned orphans and verifies the final inventory', async () => {
    const id = 'a'.repeat(64)
    const fixture = await commandFixture([
      `ls:0:${id}`,
      `inspect-format:0:${image}|${image}`,
      'rm:0',
      'ls:0:',
    ])
    await expect(reconcileDockerContainers(image, fixture.command)).resolves.toBe(true)
    expect((await readFile(fixture.log, 'utf8')).trim().split('\n')).toHaveLength(4)
  })

  it('fails closed without removing an orphan whose configured image binding differs', async () => {
    const id = 'b'.repeat(64)
    const fixture = await commandFixture([
      `ls:0:${id}`,
      `inspect-format:0:${image}|sha256:${'c'.repeat(64)}`,
    ])
    await expect(reconcileDockerContainers(image, fixture.command)).resolves.toBe(false)
    expect(await readFile(fixture.log, 'utf8')).not.toContain('rm --force')
  })
})

async function commandFixture(outcomes: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-docker-command-'))
  roots.push(root)
  const command = join(root, 'docker')
  const log = join(root, 'calls')
  const queue = join(root, 'queue')
  await writeFile(queue, `${outcomes.join('\n')}\n`)
  await writeFile(
    command,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> '${log}'
line=$(sed -n '1p' '${queue}')
sed -n '2,$p' '${queue}' > '${queue}.next'
mv '${queue}.next' '${queue}'
kind=$(printf '%s' "$line" | cut -d: -f1)
code=$(printf '%s' "$line" | cut -d: -f2)
value=$(printf '%s' "$line" | cut -d: -f3-)
if [ "$kind" = inspect-format ] || [ "$kind" = ls ]; then printf '%s\\n' "$value"; fi
exit "$code"
`,
    { mode: 0o700 },
  )
  return { command, log }
}
