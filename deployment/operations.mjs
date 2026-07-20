import { constants, rmSync } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { prepareCodexRoots, validateConfiguredCodexRoots } from './codex-roots.mjs'
import { deploymentCheck } from './deployment-check.mjs'
import { activateRestore, rollbackRestore, withExclusiveLease } from './recovery.mjs'
import { importRuntimePackage } from './runtime-import.mjs'

export { deploymentCheck } from './deployment-check.mjs'
export {
  activateRestore,
  rollbackRestore,
  validateRestoreCandidate,
  withExclusiveLease,
} from './recovery.mjs'

const DEFAULT_ROOT = '/var/lib/simproof'
const NAME = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
const USAGE = `Usage:
  serve
  check
  backup --name NAME
  migrate [--backup NAME] --confirm-stopped
  restore-validate --backup NAME --name NAME
  restore-activate --name NAME --rollback NAME --confirm-stopped
  rollback --name NAME --failed NAME --confirm-stopped
  maintenance-unlock --confirm-stopped
  diagnostics --name simproof-diagnostics-NAME.json [--include-logs]
`

export function parseOperation(argv) {
  const command = argv[0]
  if (command === 'serve' && argv.length === 1) return { command }
  if (command === 'check' && argv.length === 1) return { command }
  if (
    command === 'maintenance-unlock' &&
    argv.join(' ') === 'maintenance-unlock --confirm-stopped'
  ) {
    return { command, confirmStopped: true }
  }
  if (command === 'backup') {
    const options = optionMap(argv.slice(1), new Set(['--name']))
    return named(command, options)
  }
  if (command === 'migrate') {
    const options = optionMap(
      argv.slice(1),
      new Set(['--backup', '--confirm-stopped']),
      '--confirm-stopped',
    )
    const backup = options?.get('--backup')
    if (!options?.has('--confirm-stopped')) return undefined
    return backup === undefined || validName(backup)
      ? { command, ...(backup === undefined ? {} : { backup }), confirmStopped: true }
      : undefined
  }
  if (command === 'restore-validate') {
    const options = optionMap(argv.slice(1), new Set(['--backup', '--name']))
    const backup = options?.get('--backup')
    const name = options?.get('--name')
    return validName(backup) && validName(name) ? { command, backup, name } : undefined
  }
  if (command === 'restore-activate') {
    const options = optionMap(
      argv.slice(1),
      new Set(['--name', '--rollback', '--confirm-stopped']),
      '--confirm-stopped',
    )
    const name = options?.get('--name')
    const rollback = options?.get('--rollback')
    return validName(name) && validName(rollback) && options?.has('--confirm-stopped')
      ? { command, name, rollback, confirmStopped: true }
      : undefined
  }
  if (command === 'rollback') {
    const options = optionMap(
      argv.slice(1),
      new Set(['--name', '--failed', '--confirm-stopped']),
      '--confirm-stopped',
    )
    const name = options?.get('--name')
    const failed = options?.get('--failed')
    return validName(name) && validName(failed) && options?.has('--confirm-stopped')
      ? { command, name, failed, confirmStopped: true }
      : undefined
  }
  if (command === 'diagnostics') {
    const options = optionMap(
      argv.slice(1),
      new Set(['--name', '--include-logs']),
      '--include-logs',
    )
    const name = options?.get('--name')
    return typeof name === 'string' && /^simproof-diagnostics[a-zA-Z0-9._-]*\.json$/u.test(name)
      ? { command, name, includeLogs: options?.has('--include-logs') }
      : undefined
  }
  return undefined
}

function named(command, options) {
  const name = options?.get('--name')
  return validName(name) ? { command, name } : undefined
}

function validName(value) {
  return typeof value === 'string' && NAME.test(value)
}

function optionMap(argv, allowed, booleanOption) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!allowed.has(flag) || result.has(flag)) return undefined
    if (flag === booleanOption) {
      result.set(flag, 'true')
      index -= 1
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) return undefined
    result.set(flag, value)
  }
  return result
}

async function run(operation, root = deploymentRoot()) {
  if (operation.command === 'serve' || operation.command === 'check') {
    validateConfiguredCodexRoots()
    await prepareCodexRoots()
  }
  if (operation.command === 'serve') return await serve(root)
  if (operation.command === 'maintenance-unlock') {
    await rm(join(root, '.application-running'), { recursive: true })
    return 0
  }
  if (operation.command === 'restore-activate') {
    await activateRestore({ root, name: operation.name, rollback: operation.rollback })
    return 0
  }
  if (operation.command === 'rollback') {
    await rollbackRestore({ root, name: operation.name, failed: operation.failed })
    return 0
  }
  if (operation.command === 'diagnostics') return await diagnostics(operation)

  const persistence = await importRuntimePackage('@simproof/persistence')
  const environment = await import('../dist/config/environment.js')
  const config = environment.parseProcessEnvironment()
  if (operation.command === 'check') {
    const checked = await deploymentCheck(config)
    process.stdout.write(`${JSON.stringify(checked.report)}\n`)
    return checked.ready ? 0 : 1
  }
  if (operation.command === 'restore-validate') {
    const result = await persistence.restorePersistence({
      backup: join(root, 'backups', operation.backup),
      destination: join(root, 'restores', operation.name),
      operationRoot: root,
    })
    return result.ok ? 0 : 1
  }

  if (operation.command === 'backup') {
    const database = persistence.createPersistence(config.databasePath)
    const artifacts = new persistence.ArtifactStore(config.artifactRoot)
    try {
      return resultCode(
        await persistence.backupPersistence({
          database,
          artifacts,
          destination: join(root, 'backups', operation.name),
          createdAt: new Date().toISOString(),
          operationRoot: root,
        }),
      )
    } finally {
      database.close()
    }
  }
  return await withExclusiveLease(root, async () => {
    const databaseExists = await exists(config.databasePath)
    const database = persistence.createPersistence(config.databasePath)
    const artifacts = new persistence.ArtifactStore(config.artifactRoot)
    try {
      if (databaseExists && operation.backup === undefined) return 1
      if (databaseExists) {
        const backup = await persistence.backupPersistence({
          database,
          artifacts,
          destination: join(root, 'backups', operation.backup),
          createdAt: new Date().toISOString(),
          operationRoot: root,
        })
        if (!backup.ok) return 1
      }
      return resultCode(database.migrate())
    } finally {
      database.close()
    }
  })
}

async function serve(root) {
  const marker = join(root, '.application-running')
  await mkdir(marker)
  try {
    await syncDirectory(root)
  } catch (error) {
    await rm(marker, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  process.once('exit', () => {
    rmSync(marker, { recursive: true, force: true })
  })
  try {
    await import('../dist/start.js')
  } catch (error) {
    await rm(marker, { recursive: true, force: true }).catch(() => undefined)
    await syncDirectory(root).catch(() => undefined)
    throw error
  }
  return 0
}

async function diagnostics(operation) {
  const { runDiagnosticCli } = await import('../dist/operations/diagnostics-cli.js')
  const output = join('/var/log/simproof', operation.name)
  const argv = ['create', '--output', output]
  if (operation.includeLogs) argv.push('--include', 'logs')
  return await runDiagnosticCli({ argv })
}

function deploymentRoot() {
  const configured = process.env.SIMPROOF_OPERATION_ROOT ?? DEFAULT_ROOT
  const resolved = resolve(configured)
  if (resolved !== configured || resolved === '/') throw new Error('Operation root is invalid.')
  return resolved
}

async function exists(path) {
  return await lstat(path).then(
    () => true,
    (error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    },
  )
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function resultCode(result) {
  return result.ok ? 0 : 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  const operation = parseOperation(process.argv.slice(2))
  if (operation === undefined) {
    process.stderr.write(USAGE)
    process.exitCode = 2
  } else {
    try {
      process.exitCode = await run(operation)
    } catch {
      process.stderr.write('Deployment operation failed.\n')
      process.exitCode = 1
    }
  }
}
