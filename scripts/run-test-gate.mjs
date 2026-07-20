import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gateName = process.argv[2]
const mode = process.argv[3]
const validateOnly = mode === '--validate'
const redactionOnly = gateName === 'security' && mode === 'redaction'
const allowedGates = new Set(['deployment', 'diagnostics', 'integration', 'security'])
const packageName = /^[a-z][a-z0-9-]*$/u
const testPath = /^src\/(?:[a-z0-9-]+\/)*[a-z0-9.-]+\.test\.ts$/u
const redactionTestPath = /(?:^|[-/])redaction\.test\.ts$/u

if (gateName === undefined || !allowedGates.has(gateName)) {
  throw new TypeError('Test gate must be deployment, diagnostics, integration, or security.')
}
if (mode !== undefined && !validateOnly && !redactionOnly) {
  throw new TypeError('Unknown test gate option.')
}

const manifestPath = join(root, 'tests', gateName, 'gate.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (
  typeof manifest !== 'object' ||
  manifest === null ||
  manifest.schemaVersion !== '1' ||
  !Array.isArray(manifest.groups) ||
  manifest.groups.length === 0
) {
  throw new TypeError(`Test gate manifest is invalid: ${gateName}`)
}

for (const group of manifest.groups) {
  if (
    typeof group !== 'object' ||
    group === null ||
    typeof group.package !== 'string' ||
    !packageName.test(group.package) ||
    !Array.isArray(group.files) ||
    group.files.length === 0 ||
    group.files.some((file) => typeof file !== 'string' || !testPath.test(file))
  ) {
    throw new TypeError(`Test gate group is invalid: ${gateName}`)
  }
  const packageRoot = packageDirectory(group.package)
  for (const file of group.files) {
    const absolute = resolve(packageRoot, file)
    if (!absolute.startsWith(`${packageRoot}/`) || !statSync(absolute).isFile()) {
      throw new TypeError(`Test gate file is invalid: ${group.package}/${file}`)
    }
  }
  if (validateOnly) continue
  const selectedFiles = redactionOnly
    ? group.files.filter((file) => redactionTestPath.test(file))
    : group.files
  if (selectedFiles.length === 0) continue
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      `@simproof/${group.package}`,
      'exec',
      'vitest',
      'run',
      ...selectedFiles,
      '--maxWorkers=4',
    ],
    { cwd: root, env: sanitizedEnvironment(), stdio: 'inherit' },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function packageDirectory(name) {
  for (const parent of ['apps', 'packages', 'tests']) {
    const candidate = join(root, parent, name)
    try {
      if (statSync(join(candidate, 'package.json')).isFile()) return candidate
    } catch {
      // Continue to the other workspace parent.
    }
  }
  throw new TypeError(`Test gate package is not installed: ${name}`)
}

function sanitizedEnvironment() {
  const environment = { ...process.env, SIMPROOF_TEST_NETWORK: 'disabled' }
  const requirePolicy = `--require=${resolve(root, 'scripts/deny-test-network.cjs')}`
  environment.NODE_OPTIONS =
    environment.NODE_OPTIONS === undefined || environment.NODE_OPTIONS.trim() === ''
      ? requirePolicy
      : `${environment.NODE_OPTIONS} ${requirePolicy}`
  for (const name of Object.keys(environment)) {
    if (/^(?:OPENAI|CODEX)(?:_|$)/u.test(name)) delete environment[name]
  }
  return environment
}
