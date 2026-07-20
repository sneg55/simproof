import { createHash } from 'node:crypto'

export function releaseInputIdentity({
  images,
  lockSha256,
  releaseVersion,
  sourceDateEpoch,
  sourceRevision,
}) {
  const canonical = JSON.stringify({
    releaseVersion,
    sourceRevision,
    sourceDateEpoch,
    lockSha256,
    images,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function createProvenance({
  images,
  inputIdentity,
  lockSha256,
  releaseVersion,
  sourceDateEpoch,
  sourceRevision,
}) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: images.map((image) => ({
      name: image.reference,
      digest: { sha256: image.digest.slice('sha256:'.length) },
    })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'urn:simproof:build:release-evidence:v1',
        externalParameters: {
          releaseVersion,
          sourceRevision,
          sourceDateEpoch,
          lockfileSha256: lockSha256,
          inputIdentity,
        },
        internalParameters: { publishingEnabled: false, signingEnabled: false },
        resolvedDependencies: [
          {
            uri: `urn:simproof:source:${sourceRevision}`,
            digest: { gitCommit: sourceRevision },
          },
          { uri: 'pkg:generic/simproof-lockfile', digest: { sha256: lockSha256 } },
        ],
      },
      runDetails: {
        builder: { id: 'urn:simproof:builder:release-evidence:v1' },
      },
    },
  }
}

export function createSbom({ generatedAt, images, inputIdentity, lock, releaseVersion }) {
  const entries = [
    ...packageEntries(lock, releaseVersion),
    ...images.map((image) => ({
      name: image.reference,
      version: image.digest,
      image,
      comment: `Image identity only; no component inventory: ${image.digest}`,
    })),
  ].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  )
  const packages = entries.map((entry, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    ...(entry.comment === undefined ? {} : { packageComment: entry.comment }),
  }))
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `simproof-${releaseVersion}`,
    documentNamespace: `urn:simproof:spdx:${inputIdentity}`,
    creationInfo: { created: generatedAt, creators: ['Tool: SimProof release evidence generator'] },
    packages,
    relationships: packages.map((item) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: item.SPDXID,
    })),
  }
}

function packageEntries(lock, releaseVersion) {
  const workspace = Object.keys(lock.importers ?? {}).map((path) => ({
    name: path === '.' ? 'simproof' : `@simproof/${path.split('/').at(-1)}`,
    version: path === '.' ? releaseVersion : '0.0.0',
    path,
    comment: `Workspace path: ${path}`,
  }))
  const dependencies = Object.keys(lock.packages ?? {}).map((key) => {
    const withoutPeers = key.split('(')[0]
    const separator = withoutPeers.lastIndexOf('@')
    if (separator < 1) throw new Error(`Unsupported pnpm package key: ${key}`)
    return {
      name: withoutPeers.slice(0, separator),
      version: withoutPeers.slice(separator + 1),
      comment: `Pnpm lock key: ${key}`,
    }
  })
  return [...workspace, ...dependencies]
}
