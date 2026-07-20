import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const filterIndex = args.indexOf('--filter')
const filter = filterIndex === -1 ? undefined : args[filterIndex + 1]

if (filterIndex !== -1 && filter === undefined) {
  console.error('Expected a package name after --filter')
  process.exit(2)
}

const forwarded =
  filterIndex === -1 ? args : args.slice(filterIndex + 2).filter((arg) => arg !== '--')
const namedGates = new Set(['deployment', 'diagnostics', 'integration', 'security'])
if (filter !== undefined && namedGates.has(filter)) {
  const redactionOnly =
    filter === 'security' && forwarded.length === 1 && forwarded[0] === 'redaction'
  if (forwarded.length > 0 && !redactionOnly) {
    console.error('Named test gates do not accept forwarded package arguments')
    process.exit(2)
  }
  const result = spawnSync(
    'node',
    [`scripts/run-test-gate.mjs`, filter, ...(redactionOnly ? ['redaction'] : [])],
    {
      env: isolatedTestEnvironment(),
      stdio: 'inherit',
    },
  )
  process.exit(result.status ?? 1)
}
const pnpmArgs = filter
  ? ['--filter', `@simproof/${filter}`, 'test', '--', ...forwarded]
  : [
      '--recursive',
      '--if-present',
      '--filter',
      '!@simproof/integration',
      '--filter',
      '!@simproof/security',
      '--filter',
      '!@simproof/deployment',
      '--filter',
      '!@simproof/diagnostics',
      'test',
      ...forwarded,
    ]
const result = spawnSync('pnpm', pnpmArgs, { env: isolatedTestEnvironment(), stdio: 'inherit' })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)

function isolatedTestEnvironment() {
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
