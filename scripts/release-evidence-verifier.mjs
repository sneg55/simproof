import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  checksums,
  EVIDENCE_FILES,
  JSON_FILES,
  MIGRATION_SOURCE,
  normalizeImages,
  OUTPUT_FILES,
  parseMigrations,
  REVISION_PATTERN,
  sha256,
  VERSION_PATTERN,
} from './release-evidence.mjs'
import { releaseInputIdentity } from './release-metadata.mjs'
import { assertCleanReleaseSource } from './release-source.mjs'

export async function verifyReleaseEvidence(options) {
  const root = resolve(options.root)
  const output = resolve(options.outputDirectory)
  const outputMetadata = await lstat(output)
  const directoryEntries = await readdir(output, { withFileTypes: true })
  const entries = directoryEntries.map((entry) => entry.name).sort()
  if (
    !outputMetadata.isDirectory() ||
    outputMetadata.isSymbolicLink() ||
    directoryEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    entries.join('\n') !== OUTPUT_FILES.join('\n')
  ) {
    throw new Error('Release evidence file set is invalid.')
  }
  const json = Object.fromEntries(
    await Promise.all(
      [...JSON_FILES, 'release-manifest.json'].map(async (name) => [
        name,
        JSON.parse(await readFile(join(output, name), 'utf8')),
      ]),
    ),
  )
  const manifest = json['release-manifest.json']
  const lockSha256 = sha256(await readFile(join(root, 'pnpm-lock.yaml')))
  const sourceIdentity = assertCleanReleaseSource(
    root,
    manifest.sourceRevision,
    manifest.sourceDateEpoch,
  )
  validateManifest(manifest, lockSha256, sourceIdentity)
  const images = normalizeImages(manifest.images)
  const inputIdentity = releaseInputIdentity({
    images,
    lockSha256,
    releaseVersion: manifest.releaseVersion,
    sourceDateEpoch: manifest.sourceDateEpoch,
    sourceRevision: manifest.sourceRevision,
  })
  if (manifest.inputIdentity !== inputIdentity)
    throw new Error('Release input identity is invalid.')
  if (
    (await readFile(join(output, 'release-notes.md'), 'utf8')) !==
    (await readFile(join(root, 'CHANGELOG.md'), 'utf8'))
  ) {
    throw new Error('Release notes do not match the changelog.')
  }
  const expectedArtifacts = await checksums(output, EVIDENCE_FILES)
  if (!same(manifest.artifacts, expectedArtifacts))
    throw new Error('Release manifest digests are invalid.')
  const expectedChecksums = await checksums(
    output,
    [...EVIDENCE_FILES, 'release-manifest.json'].sort(),
  )
  if (
    !same(parseChecksums(await readFile(join(output, 'checksums.txt'), 'utf8')), expectedChecksums)
  ) {
    throw new Error('Release checksums are invalid.')
  }
  validateProvenance(json['provenance.intoto.json'], manifest, images, lockSha256, inputIdentity)
  validateSbom(json['sbom.spdx.json'], manifest, images, inputIdentity)
  await validateMigrations(root, json['migration-notes.json'], manifest)
  return manifest
}

function validateManifest(manifest, lockSha256, sourceIdentity) {
  if (
    manifest.schemaVersion !== '1' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(manifest.generatedAt ?? '') ||
    manifest.lockfile?.path !== 'pnpm-lock.yaml' ||
    manifest.lockfile.sha256 !== lockSha256 ||
    manifest.sourceRevision !== sourceIdentity.revision ||
    manifest.sourceDateEpoch !== sourceIdentity.sourceDateEpoch ||
    manifest.generatedAt !== new Date(sourceIdentity.sourceDateEpoch * 1_000).toISOString() ||
    !REVISION_PATTERN.test(manifest.sourceRevision ?? '') ||
    !VERSION_PATTERN.test(manifest.releaseVersion ?? '')
  )
    throw new Error('Release manifest is invalid.')
}

function validateProvenance(value, manifest, images, lockSha256, inputIdentity) {
  const build = value.predicate?.buildDefinition
  const resolved = build?.resolvedDependencies
  if (
    value._type !== 'https://in-toto.io/Statement/v1' ||
    value.predicateType !== 'https://slsa.dev/provenance/v1' ||
    build?.buildType !== 'urn:simproof:build:release-evidence:v1' ||
    !same(build?.internalParameters, { publishingEnabled: false, signingEnabled: false }) ||
    value.predicate?.runDetails?.builder?.id !== 'urn:simproof:builder:release-evidence:v1' ||
    !same(value.predicate?.runDetails, {
      builder: { id: 'urn:simproof:builder:release-evidence:v1' },
    }) ||
    !same(build?.externalParameters, {
      releaseVersion: manifest.releaseVersion,
      sourceRevision: manifest.sourceRevision,
      sourceDateEpoch: manifest.sourceDateEpoch,
      lockfileSha256: lockSha256,
      inputIdentity,
    }) ||
    !same(value.subject, imageSubjects(images)) ||
    resolved?.[0]?.uri !== `urn:simproof:source:${manifest.sourceRevision}` ||
    resolved?.[0]?.digest?.gitCommit !== manifest.sourceRevision ||
    resolved?.[1]?.uri !== 'pkg:generic/simproof-lockfile' ||
    resolved?.[1]?.digest?.sha256 !== lockSha256
  )
    throw new Error('Provenance does not map to the release inputs.')
}

function validateSbom(value, manifest, images, inputIdentity) {
  if (
    value.spdxVersion !== 'SPDX-2.3' ||
    value.dataLicense !== 'CC0-1.0' ||
    value.SPDXID !== 'SPDXRef-DOCUMENT' ||
    value.name !== `simproof-${manifest.releaseVersion}` ||
    value.documentNamespace !== `urn:simproof:spdx:${inputIdentity}` ||
    value.creationInfo?.created !== manifest.generatedAt ||
    !same(value.creationInfo?.creators, ['Tool: SimProof release evidence generator']) ||
    !Array.isArray(value.packages)
  )
    throw new Error('SBOM identity is invalid.')
  const expectedRelationships = value.packages.map((item) => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: item.SPDXID,
  }))
  if (
    value.packages.some(
      (item) =>
        item.licenseConcluded !== 'NOASSERTION' ||
        item.licenseDeclared !== 'NOASSERTION' ||
        item.copyrightText !== 'NOASSERTION',
    ) ||
    images.some(
      (image) =>
        !value.packages.some(
          (item) =>
            item.name === image.reference &&
            item.packageComment === `Image identity only; no component inventory: ${image.digest}`,
        ),
    ) ||
    new Set(value.packages.map((item) => item.SPDXID)).size !== value.packages.length ||
    new Set(
      value.packages.map(
        (item) => `${item.name}\0${item.versionInfo}\0${item.packageComment ?? ''}`,
      ),
    ).size !== value.packages.length ||
    !same(value.relationships, expectedRelationships)
  )
    throw new Error('SBOM package records are incomplete.')
}

async function validateMigrations(root, value, manifest) {
  if (value.migrationSource !== MIGRATION_SOURCE) throw new Error('Migration source is invalid.')
  const source = await readFile(join(root, MIGRATION_SOURCE), 'utf8')
  const migrations = parseMigrations(source)
  if (
    value.schemaVersion !== '1' ||
    value.sourceSha256 !== sha256(source) ||
    value.latestVersion !== manifest.migrationLatestVersion ||
    value.latestVersion !== migrations.at(-1)?.version ||
    !same(value.migrations, migrations)
  ) {
    throw new Error('Migration evidence is invalid.')
  }
}

function imageSubjects(images) {
  return images.map((image) => ({
    name: image.reference,
    digest: { sha256: image.digest.slice(7) },
  }))
}

function parseChecksums(source) {
  return source
    .trimEnd()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64})\x20{2}([a-z0-9.-]+)$/u.exec(line)
      if (match === null) throw new Error('Checksum file is invalid.')
      return { path: match[2], sha256: match[1] }
    })
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
