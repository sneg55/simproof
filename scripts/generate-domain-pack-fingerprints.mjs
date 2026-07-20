import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const fingerprintOutputPath = resolve(
  repositoryRoot,
  'packages/verifier/src/generated/domain-pack-fingerprints.ts',
)
const reviewBindingOutputPath = resolve(
  repositoryRoot,
  'packages/verifier/src/generated/domain-pack-review-bindings.ts',
)
const domains = ['pendulum', 'projectile']
const baseRevision = '34255b495c2e01b66c44942b3ec9568c12f6de9b'
const reviewMetadata = {
  pendulum: {
    reviewArtifactId: 'pendulum.review.1-0-0',
    packVersion: '1.0.0',
    policies: [{ id: 'pendulum.small-angle', version: '1.0.0' }],
    auditIds: [
      'pendulum.audit.scientific.1-0-0',
      'pendulum.audit.pedagogical.1-0-0',
      'pendulum.audit.accessibility.1-0-0',
      'pendulum.audit.maintainer.1-0-0',
    ],
  },
  projectile: {
    reviewArtifactId: 'projectile.review.1-1-0',
    packVersion: '1.1.0',
    policies: [{ id: 'projectile-vacuum-level-earth', version: '1.1.0' }],
    auditIds: [
      'projectile.audit.scientific.1-1-0',
      'projectile.audit.pedagogical.1-1-0',
      'projectile.audit.accessibility.1-1-0',
      'projectile.audit.maintainer.1-1-0',
    ],
  },
}

const inventoryPath = (domain) =>
  resolve(repositoryRoot, `packages/verifier/src/domains/${domain}/inventory.json`)

function assertNoSymlinkSegments(root, absolute, inventoryEntry) {
  const repositoryRelative = relative(root, absolute)
  if (repositoryRelative === '' || repositoryRelative.startsWith(`..${sep}`)) {
    throw new TypeError(`The inventory entry escapes the repository: ${inventoryEntry}`)
  }
  let current = root
  for (const segment of repositoryRelative.split(sep)) {
    current = join(current, segment)
    if (lstatSync(current).isSymbolicLink()) {
      throw new TypeError(`The inventory entry crosses a symbolic link: ${inventoryEntry}`)
    }
  }
}

function readInventory(domain) {
  const parsed = JSON.parse(readFileSync(inventoryPath(domain), 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(parsed.paths) ||
    parsed.paths.some((path) => typeof path !== 'string')
  ) {
    throw new TypeError(`The ${domain} inventory must contain a paths string array.`)
  }
  const paths = parsed.paths
  if (paths.length === 0 || new Set(paths).size !== paths.length) {
    throw new TypeError(`The ${domain} inventory must be nonempty and unique.`)
  }
  if (paths.some((path, index) => index > 0 && paths[index - 1].localeCompare(path) >= 0)) {
    throw new TypeError(`The ${domain} inventory must be sorted canonically.`)
  }
  for (const path of paths) {
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      posix.normalize(path) !== path ||
      path === '..' ||
      path.startsWith('../')
    ) {
      throw new TypeError(`The ${domain} inventory contains a noncanonical path: ${path}`)
    }
    const absolute = resolve(repositoryRoot, path)
    assertNoSymlinkSegments(repositoryRoot, absolute, path)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new TypeError(`The ${domain} inventory entry must be a regular file: ${path}`)
    }
    const canonical = realpathSync(absolute)
    if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}${sep}`)) {
      throw new TypeError(`The ${domain} inventory entry escapes the repository: ${path}`)
    }
  }
  assertDomainInventoryComplete(domain, paths)
  return paths
}

function assertDomainInventoryComplete(domain, paths) {
  const domainPrefix = `packages/verifier/src/domains/${domain}/`
  const declaredDomainFiles = paths.filter((path) => path.startsWith(domainPrefix)).sort()
  const actualDomainFiles = readdirSync(resolve(repositoryRoot, domainPrefix), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.json') ||
          (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))),
    )
    .map((entry) => `${domainPrefix}${entry.name}`)
    .sort()
  if (JSON.stringify(declaredDomainFiles) !== JSON.stringify(actualDomainFiles)) {
    throw new TypeError(`The ${domain} inventory does not exactly cover domain-owned source.`)
  }
  const declaredFixtures = paths.filter((path) => path.startsWith('tests/fixtures/')).sort()
  const actualFixtures = ['correct', 'negative-controls']
    .flatMap((fixtureClass) =>
      readdirSync(resolve(repositoryRoot, `tests/fixtures/${fixtureClass}`), {
        withFileTypes: true,
      })
        .filter(
          (entry) =>
            entry.isFile() && entry.name.startsWith(`${domain}-`) && entry.name.endsWith('.json'),
        )
        .map((entry) => `tests/fixtures/${fixtureClass}/${entry.name}`),
    )
    .sort()
  if (JSON.stringify(declaredFixtures) !== JSON.stringify(actualFixtures)) {
    throw new TypeError(`The ${domain} inventory does not exactly cover control fixtures.`)
  }
}

function normalizedBytes(path) {
  const contents = readFileSync(path)
  const extension = path.split('.').at(-1)
  if (!['json', 'md', 'mjs', 'ts'].includes(extension)) return contents
  const source = contents.toString('utf8')
  const withoutBom = source.startsWith('\uFEFF') ? source.slice(1) : source
  return Buffer.from(withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8')
}

function fingerprintFor(domain) {
  const hash = createHash('sha256')
  hash.update('simproof-domain-pack-v2\0', 'utf8')
  for (const path of readInventory(domain)) {
    const absolute = resolve(repositoryRoot, path)
    const contents = path.startsWith('tests/fixtures/')
      ? readFileSync(absolute)
      : normalizedBytes(absolute)
    hash.update(`${path}\0${contents.byteLength}\0`, 'utf8')
    hash.update(contents)
    hash.update('\0', 'utf8')
  }
  return `sha256:${hash.digest('hex')}`
}

function generatedSource() {
  const entries = domains.map((domain) => `  ${domain}: '${fingerprintFor(domain)}',`).join('\n')
  return `// Generated by scripts/generate-domain-pack-fingerprints.mjs. Do not edit by hand.\nimport type { Sha256 } from '@simproof/contracts'\n\nexport const DOMAIN_PACK_FINGERPRINTS = Object.freeze({\n${entries}\n}) satisfies Readonly<Record<'pendulum' | 'projectile', Sha256>>\n`
}

function generatedReviewBindingsSource() {
  const entries = domains
    .map((domain) => {
      const metadata = reviewMetadata[domain]
      const policies = metadata.policies
        .map(({ id, version }) => `{ id: '${id}', version: '${version}' }`)
        .join(', ')
      const auditIds = metadata.auditIds.map((id) => `      '${id}',`).join('\n')
      return `  ${domain}: domainPackReviewBindingSchema.parse({
    schemaVersion: '1',
    reviewArtifactId: '${metadata.reviewArtifactId}',
    pack: {
      id: '${domain}',
      version: '${metadata.packVersion}',
      contentHash: '${fingerprintFor(domain)}',
    },
    policies: [${policies}],
    baseRevision: {
      kind: 'git-commit',
      reference: '${baseRevision}',
    },
    auditIds: [
${auditIds}
    ],
  }),`
    })
    .join('\n')
  return `// Generated by scripts/generate-domain-pack-fingerprints.mjs. Do not edit by hand.\nimport { domainPackReviewBindingSchema } from '@simproof/domain-pack-sdk'\n\nexport const DOMAIN_PACK_REVIEW_BINDINGS = Object.freeze({\n${entries}\n})\n`
}

function run(args) {
  if (args[0] === '--print' && domains.includes(args[1]) && args.length === 2) {
    process.stdout.write(`${fingerprintFor(args[1])}\n`)
    return
  }
  if (
    args.some((argument) => argument !== '--check') ||
    args.filter((arg) => arg === '--check').length > 1
  ) {
    console.error(
      'Usage: node scripts/generate-domain-pack-fingerprints.mjs [--check | --print <domain>]',
    )
    process.exitCode = 2
    return
  }
  const expectedFingerprintSource = generatedSource()
  const expectedReviewBindingSource = generatedReviewBindingsSource()
  if (args.includes('--check')) {
    let actualFingerprintSource
    let actualReviewBindingSource
    try {
      actualFingerprintSource = readFileSync(fingerprintOutputPath, 'utf8')
      actualReviewBindingSource = readFileSync(reviewBindingOutputPath, 'utf8')
    } catch {
      console.error(
        'Domain-pack fingerprints or review bindings are missing. Run pnpm generate:domain-pack-fingerprints.',
      )
      process.exitCode = 1
      return
    }
    if (
      actualFingerprintSource !== expectedFingerprintSource ||
      actualReviewBindingSource !== expectedReviewBindingSource
    ) {
      console.error(
        'Domain-pack fingerprints or review bindings are stale. Run pnpm generate:domain-pack-fingerprints and commit the result.',
      )
      process.exitCode = 1
    }
    return
  }
  mkdirSync(dirname(fingerprintOutputPath), { recursive: true })
  writeFileSync(fingerprintOutputPath, expectedFingerprintSource, 'utf8')
  writeFileSync(reviewBindingOutputPath, expectedReviewBindingSource, 'utf8')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2))
}

export { assertNoSymlinkSegments, fingerprintFor, readInventory }
