import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imageName = 'simproof-runner:local'
const imagePattern = /^sha256:[a-f0-9]{64}$/u
const sourcePattern = /^[a-f0-9]{64}$/u
const socketPattern = /^\/[^=\n]{1,4095}$/u
const fragmentName = '.simproof/deployment.generated.env'

export async function prepareDeployment(options = {}) {
  const root = resolve(options.root ?? scriptRoot)
  const docker = options.docker ?? runDocker
  docker(['build', '--file', 'apps/runner/Dockerfile', '--tag', imageName, '.'])
  const image = inspectImage(docker)
  const socket = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  const socketPath = localSocketPath(socket)
  if (socketPath === undefined) throw new Error('The active Docker context is not local.')
  const group = (options.socketGroup ?? ((path) => probeSocketGroup(docker, path, image)))(
    socketPath,
  )
  if (!Number.isSafeInteger(group) || group < 0) throw new Error('Docker socket group is invalid.')
  const source = sourceFingerprint(root)
  const output = join(root, fragmentName)
  await writeFragment(output, image, socketPath, group, source)
  return output
}

export async function checkDeploymentPreparation(options = {}) {
  const root = resolve(options.root ?? scriptRoot)
  const docker = options.docker ?? runDocker
  const output = join(root, fragmentName)
  try {
    const parent = lstatSync(dirname(output), { throwIfNoEntry: false })
    const metadata = lstatSync(output, { throwIfNoEntry: false })
    if (
      parent === undefined ||
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      metadata === undefined ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o600
    )
      return false
    const values = parseFragment(await readFile(output, 'utf8'))
    if (values === undefined) return false
    const socket = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    const socketPath = localSocketPath(socket)
    if (socketPath === undefined) return false
    const image = inspectImage(docker)
    const group = (options.socketGroup ?? ((path) => probeSocketGroup(docker, path, image)))(
      socketPath,
    )
    return (
      values.SIMPROOF_RUNNER_IMAGE === image &&
      values.SIMPROOF_DOCKER_SOCKET === socketPath &&
      values.SIMPROOF_RUNNER_SOURCE_SHA256 === sourceFingerprint(root) &&
      values.SIMPROOF_DOCKER_GID === String(group)
    )
  } catch {
    return false
  }
}

function inspectImage(docker) {
  const image = docker(['image', 'inspect', '--format', '{{.Id}}', imageName])
  if (!imagePattern.test(image)) throw new Error('Runner image identity is invalid.')
  return image
}

function sourceFingerprint(root) {
  const hash = createHash('sha256')
  for (const path of ['apps/runner/Dockerfile', 'apps/runner/runtime/entrypoint.mjs']) {
    hash.update(path)
    hash.update('\0')
    hash.update(readFileSync(join(root, path)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function writeFragment(path, image, socket, group, source) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const parent = lstatSync(dirname(path), { throwIfNoEntry: false })
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error('Output directory is unsafe.')
  const existing = lstatSync(path, { throwIfNoEntry: false })
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('Output file is unsafe.')
  }
  const temporary = `${path}.tmp-${process.pid}`
  const content =
    `SIMPROOF_RUNNER_IMAGE=${image}\n` +
    `SIMPROOF_DOCKER_SOCKET=${socket}\n` +
    `SIMPROOF_DOCKER_GID=${group}\n` +
    `SIMPROOF_RUNNER_SOURCE_SHA256=${source}\n`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } finally {
    await rm(temporary, { force: true })
  }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function parseFragment(content) {
  const lines = content.trimEnd().split('\n')
  if (lines.length !== 4) return undefined
  const entries = lines.map((line) => {
    const separator = line.indexOf('=')
    return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : []
  })
  if (entries.some((entry) => entry.length !== 2)) return undefined
  const values = Object.fromEntries(entries)
  if (
    Object.keys(values).sort().join(',') !==
    'SIMPROOF_DOCKER_GID,SIMPROOF_DOCKER_SOCKET,SIMPROOF_RUNNER_IMAGE,SIMPROOF_RUNNER_SOURCE_SHA256'
  ) {
    return undefined
  }
  return imagePattern.test(values.SIMPROOF_RUNNER_IMAGE ?? '') &&
    validSocketPath(values.SIMPROOF_DOCKER_SOCKET ?? '') &&
    /^\d{1,10}$/u.test(values.SIMPROOF_DOCKER_GID ?? '') &&
    sourcePattern.test(values.SIMPROOF_RUNNER_SOURCE_SHA256 ?? '')
    ? values
    : undefined
}

function localSocketPath(value) {
  if (!value.startsWith('unix://')) return undefined
  const path = value.slice('unix://'.length)
  return validSocketPath(path) ? path : undefined
}

function validSocketPath(value) {
  return (
    socketPattern.test(value) &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
  )
}

export function probeSocketGroup(docker, socket, image) {
  if (!imagePattern.test(image)) throw new Error('Runner image identity is invalid.')
  const output = docker([
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
    `${socket}:/socket:ro`,
    image,
    '-e',
    "process.stdout.write(String(require('node:fs').statSync('/socket').gid))",
  ])
  return /^\d{1,10}$/u.test(output) ? Number(output) : Number.NaN
}

function runDocker(args) {
  return execFileSync('docker', args, { cwd: scriptRoot, encoding: 'utf8' }).trim()
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  const checkOnly = process.argv.length === 3 && process.argv[2] === '--check'
  if (process.argv.length > (checkOnly ? 3 : 2)) {
    process.stderr.write('Usage: node scripts/prepare-deployment.mjs [--check]\n')
    process.exitCode = 2
  } else {
    try {
      if (checkOnly) {
        const current = await checkDeploymentPreparation()
        process.stdout.write(
          current ? 'Deployment preparation is current.\n' : 'Deployment preparation is stale.\n',
        )
        process.exitCode = current ? 0 : 1
      } else {
        await prepareDeployment()
        process.stdout.write('Immutable runner deployment fragment created.\n')
      }
    } catch {
      process.stderr.write('Deployment preparation failed.\n')
      process.exitCode = 1
    }
  }
}
