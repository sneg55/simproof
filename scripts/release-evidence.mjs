import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parse } from 'yaml'

import { createProvenance, createSbom, releaseInputIdentity } from './release-metadata.mjs'

export const JSON_FILES = Object.freeze([
  'migration-notes.json',
  'provenance.intoto.json',
  'sbom.spdx.json',
])
export const EVIDENCE_FILES = Object.freeze([...JSON_FILES, 'release-notes.md'].sort())
export const OUTPUT_FILES = Object.freeze(
  [...EVIDENCE_FILES, 'release-manifest.json', 'checksums.txt'].sort(),
)
export const REVISION_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u
export const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const IMAGE_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}:[A-Za-z0-9._-]{1,128}$/u
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u
const EXPECTED_IMAGE_REFERENCES = Object.freeze([
  'simproof-launcher:local',
  'simproof-orchestrator:local',
  'simproof-runner:local',
  'simproof-web:local',
])
export const MIGRATION_SOURCE = 'packages/persistence/src/migrations.ts'

export async function generateReleaseEvidence(options) {
  const root = resolve(options.root)
  const output = resolve(options.outputDirectory)
  const sourceRevision = requireMatch(options.sourceRevision, REVISION_PATTERN, 'source revision')
  const releaseVersion = requireMatch(options.releaseVersion, VERSION_PATTERN, 'release version')
  const sourceDateEpoch = requireEpoch(options.sourceDateEpoch)
  const images = normalizeImages(options.images)
  const generatedAt = new Date(sourceDateEpoch * 1_000).toISOString()
  await createEmptyOutput(output)

  const lockPath = join(root, 'pnpm-lock.yaml')
  const changelogPath = join(root, 'CHANGELOG.md')
  const migrationPath = join(root, MIGRATION_SOURCE)
  const [lockSource, changelog, migrationSource] = await Promise.all([
    readFile(lockPath, 'utf8'),
    readFile(changelogPath, 'utf8'),
    readFile(migrationPath, 'utf8'),
  ])
  const lockSha256 = sha256(lockSource)
  const inputIdentity = releaseInputIdentity({
    images,
    lockSha256,
    releaseVersion,
    sourceDateEpoch,
    sourceRevision,
  })
  const migrations = parseMigrations(migrationSource)
  const lock = parse(lockSource)

  const migrationNotes = {
    schemaVersion: '1',
    migrationSource: MIGRATION_SOURCE,
    sourceSha256: sha256(migrationSource),
    latestVersion: migrations.at(-1)?.version ?? 0,
    migrations,
  }
  const provenance = createProvenance({
    lockSha256,
    releaseVersion,
    sourceDateEpoch,
    sourceRevision,
    images,
    inputIdentity,
  })
  const sbom = createSbom({
    generatedAt,
    lock,
    releaseVersion,
    images,
    inputIdentity,
  })

  await Promise.all([
    writeJson(join(output, 'migration-notes.json'), migrationNotes),
    writeJson(join(output, 'provenance.intoto.json'), provenance),
    writeJson(join(output, 'sbom.spdx.json'), sbom),
    writeFile(join(output, 'release-notes.md'), changelog, { encoding: 'utf8', flag: 'wx' }),
  ])

  const artifacts = await checksums(output, EVIDENCE_FILES)
  const manifest = {
    schemaVersion: '1',
    releaseVersion,
    generatedAt,
    sourceRevision,
    sourceDateEpoch,
    images,
    inputIdentity,
    lockfile: { path: 'pnpm-lock.yaml', sha256: lockSha256 },
    migrationLatestVersion: migrationNotes.latestVersion,
    artifacts,
  }
  await writeJson(join(output, 'release-manifest.json'), manifest)
  const allChecksums = await checksums(output, [...EVIDENCE_FILES, 'release-manifest.json'].sort())
  const checksumSource = allChecksums
    .map(({ path, sha256: digest }) => `${digest}  ${path}\n`)
    .join('')
  await writeFile(join(output, 'checksums.txt'), checksumSource, { encoding: 'utf8', flag: 'wx' })
  return manifest
}

export function normalizeImages(value) {
  if (!Array.isArray(value)) throw new TypeError('The exact release image set is required.')
  const images = value.map((image) => {
    if (
      typeof image !== 'object' ||
      image === null ||
      !IMAGE_REFERENCE_PATTERN.test(image.reference ?? '') ||
      !IMAGE_DIGEST_PATTERN.test(image.digest ?? '')
    ) {
      throw new TypeError('Invalid image reference or digest.')
    }
    return { reference: image.reference, digest: image.digest }
  })
  images.sort((left, right) => left.reference.localeCompare(right.reference))
  if (
    images.length !== EXPECTED_IMAGE_REFERENCES.length ||
    images.some((image, index) => image.reference !== EXPECTED_IMAGE_REFERENCES[index])
  ) {
    throw new TypeError('The exact four Compose image references are required.')
  }
  return images
}

export function parseMigrations(source) {
  const migrations = [...source.matchAll(/version:\s*(\d+),\s*\n\s*name:\s*'([a-z0-9_]+)'/gu)].map(
    (match) => ({ version: Number(match[1]), name: match[2] }),
  )
  if (migrations.length === 0 || migrations.some((item, index) => item.version !== index + 1)) {
    throw new Error('Migration declarations are missing or non-contiguous.')
  }
  return migrations
}

async function createEmptyOutput(output) {
  await mkdir(output, { mode: 0o755 })
  const metadata = await lstat(output)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Release output is unsafe.')
}

export async function checksums(directory, names) {
  return Promise.all(
    names.map(async (path) => ({ path, sha256: sha256(await readFile(join(directory, path))) })),
  )
}

function requireMatch(value, pattern, name) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`Invalid ${name}.`)
  return value
}

function requireEpoch(value) {
  const epoch = typeof value === 'string' && /^\d{1,12}$/u.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError('Invalid source date epoch.')
  return epoch
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}
