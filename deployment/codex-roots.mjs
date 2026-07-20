import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const DEFAULT_ROOT = '/tmp/simproof-codex'
const ROOT_NAMES = ['state', 'workspaces']
const EXPECTED_ROOTS = {
  SIMPROOF_CODEX_STATE_ROOT: `${DEFAULT_ROOT}/state`,
  SIMPROOF_CODEX_WORKSPACE_ROOT: `${DEFAULT_ROOT}/workspaces`,
}

export function validateConfiguredCodexRoots(environment = process.env) {
  for (const [name, expected] of Object.entries(EXPECTED_ROOTS)) {
    const configured = environment[name]
    if (configured !== undefined && configured !== expected) {
      throw new Error('Codex temporary root configuration is unsupported.')
    }
  }
}

export async function prepareCodexRoots(root = DEFAULT_ROOT) {
  const expectedRoot = resolve(root)
  const canonicalRoot = await validateDirectory(expectedRoot)
  if (canonicalRoot !== expectedRoot) throw new Error('Codex temporary root is unsafe.')
  for (const name of ROOT_NAMES) {
    const path = join(expectedRoot, name)
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error
    })
    if ((await validateDirectory(path)) !== path) {
      throw new Error('Codex temporary root is unsafe.')
    }
  }
  const entries = (await readdir(expectedRoot)).sort()
  if (
    entries.length !== ROOT_NAMES.length ||
    entries.some((entry, index) => entry !== ROOT_NAMES[index])
  ) {
    throw new Error('Codex temporary root is unsafe.')
  }
}

async function validateDirectory(path) {
  const metadata = await lstat(path)
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.getuid?.() ||
    metadata.gid !== process.getgid?.()
  ) {
    throw new Error('Codex temporary root is unsafe.')
  }
  return await realpath(path)
}
