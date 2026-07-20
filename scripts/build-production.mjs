import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projects = [
  'apps/web',
  'apps/orchestrator',
  'apps/runner',
  'packages/contracts',
  'packages/domain-pack-sdk',
  'packages/persistence',
  'packages/providers',
  'packages/sim-runtime',
  'packages/verifier',
]

for (const project of projects)
  rmSync(resolve(root, project, 'dist'), { force: true, recursive: true })

run('tsc', ['--build', 'tsconfig.production.json', '--pretty', 'false', '--force'])
run('pnpm', ['--filter', '@simproof/web', 'build'])

const packageEntries = [
  ['@simproof/contracts', 'packages/contracts/package.json'],
  ['@simproof/domain-pack-sdk', 'packages/domain-pack-sdk/package.json'],
  ['@simproof/persistence', 'packages/persistence/package.json'],
  ['@simproof/providers', 'packages/providers/package.json'],
  ['@simproof/runner', 'apps/runner/package.json'],
  ['@simproof/verifier', 'packages/verifier/package.json'],
]

for (const [packageName, packageManifest] of packageEntries) {
  const entry = createRequire(resolve(root, packageManifest)).resolve(packageName)
  if (!entry.endsWith('/dist/index.js')) {
    throw new Error(`Production export for ${packageName} did not resolve to dist/index.js.`)
  }
  await import(pathToFileURL(entry).href)
}

await import(pathToFileURL(resolve(root, 'packages/sim-runtime/dist/index.js')).href)
await import(pathToFileURL(resolve(root, 'apps/orchestrator/dist/application.js')).href)
run(process.execPath, ['--check', 'apps/runner/runtime/entrypoint.mjs'])

const forbiddenOutputs = projects.flatMap((project) =>
  filesBelow(resolve(root, project, 'dist')).filter((path) =>
    /(?:^|\/)(?:[^/]+\.)?(?:integration\.)?test\.(?:d\.ts|js)(?:\.map)?$/u.test(path),
  ),
)
if (forbiddenOutputs.length > 0) {
  throw new Error(`Production build emitted test files:\n${forbiddenOutputs.join('\n')}`)
}

function filesBelow(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)))
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
