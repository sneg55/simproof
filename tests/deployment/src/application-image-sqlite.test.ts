import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inspectDeploymentArchitectures } from './environment.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const platforms = ['linux/amd64', 'linux/arm64'] as const

describe.runIf(inspectDeploymentArchitectures)(
  'orchestrator image SQLite architecture support',
  () => {
    for (const platform of platforms) {
      it(`${platform} supports hardened SQLite backup and restore`, () => {
        const architecture = platform.slice('linux/'.length)
        const image = `simproof-orchestrator:sqlite-${architecture}`
        execFileSync(
          'docker',
          [
            'build',
            '--platform',
            platform,
            '--file',
            'Dockerfile.orchestrator',
            '--tag',
            image,
            '.',
          ],
          { cwd: root, stdio: 'inherit' },
        )
        const output = execFileSync(
          'docker',
          [
            'run',
            '--rm',
            '--platform',
            platform,
            '--read-only',
            '--tmpfs',
            '/tmp:rw,noexec,nosuid,nodev,size=16m',
            '--entrypoint',
            'node',
            image,
            '--input-type=module',
            '--eval',
            sqliteProbe,
          ],
          { encoding: 'utf8' },
        )
        expect(JSON.parse(output)).toEqual({
          architecture,
          foreignKeys: 1,
          restored: 'persisted',
          defensiveModeEnforced: true,
          extensionDenied: true,
        })
      }, 120_000)
    }
  },
)

const sqliteProbe = String.raw`
  import { arch } from 'node:process'
  import { backup, DatabaseSync } from 'node:sqlite'

  const source = new DatabaseSync('/tmp/source.sqlite', {
    allowExtension: false,
    enableForeignKeyConstraints: true,
  })
  source.enableDefensive(true)
  source.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id)); INSERT INTO parent VALUES (1);')
  let foreignKeyDenied = false
  try {
    source.exec('INSERT INTO child VALUES (2)')
  } catch {
    foreignKeyDenied = true
  }
  if (!foreignKeyDenied) throw new Error('foreign keys are not enforced')
  source.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('persisted')")
  let defensiveModeEnforced = false
  try {
    source.exec("PRAGMA writable_schema=ON; DELETE FROM sqlite_schema WHERE name = 'proof'")
  } catch {
    defensiveModeEnforced = true
  }
  if (!defensiveModeEnforced) throw new Error('defensive mode was not enforced')
  let extensionDenied = false
  try {
    source.loadExtension('/tmp/forbidden-extension')
  } catch {
    extensionDenied = true
  }
  if (!extensionDenied) throw new Error('extension loading was not denied')
  await backup(source, '/tmp/restored.sqlite')
  source.close()

  const restored = new DatabaseSync('/tmp/restored.sqlite', { readOnly: true })
  const row = restored.prepare('SELECT value FROM proof').get()
  const foreignKeys = restored.prepare('PRAGMA foreign_keys').get().foreign_keys
  restored.close()
  process.stdout.write(JSON.stringify({
    architecture: arch === 'x64' ? 'amd64' : arch,
    foreignKeys,
    restored: row.value,
    defensiveModeEnforced,
    extensionDenied,
  }))
`
