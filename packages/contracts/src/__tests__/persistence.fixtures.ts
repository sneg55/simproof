export const ids = {
  simulation: 'f373686a-ea6f-45d5-a2a4-c9ae673fc031',
  version: 'd27764dd-46b8-44de-b8bb-35bb077ada2e',
  generationRun: 'e6cf7a56-8600-4715-a905-f2ce401d69df',
  generationAttempt: '936cc2a0-968b-42ac-ad39-02c611b9a966',
  conceptSpec: '9e1a8a19-8e44-4d2f-a74b-459b6c4f49ec',
  conceptArtifact: '5aa3e00a-dcca-449f-a759-d550752bfecd',
  generatedArtifact: 'f37b0d3b-b1e2-4f63-a080-c60526423e84',
  coreArtifact: '2ba6bb78-40c2-494f-9bf6-2c805630a74c',
  rendererArtifact: '9613defb-428d-4776-acf7-73599eaf9774',
  manifestArtifact: '51bf8d38-4887-473f-8fb1-a39e7fc22e8d',
  reportArtifact: '5e27b319-cec1-4728-bc40-a7a313c8f4cc',
  policy: '9be6d18b-1f7d-4f4e-809e-09024a2b6bc7',
  domainPack: 'dc0c1ca4-65fd-4ba6-9043-f6da2bc89ab3',
  verificationRun: 'f3300322-936b-422f-9cc9-f98a98eb3800',
  finding: '626bd4be-0824-4226-bf39-81e1f8220d85',
  publication: 'e2feef34-1d05-4dc0-a9d7-f76adb63ebaa',
} as const

export const hash = (value: string) => `sha256:${value.repeat(64)}`
const createdAt = '2026-07-16T12:00:00.000Z'
const completedAt = '2026-07-16T12:01:00.000Z'

export const artifactBundle = {
  core: { artifactId: ids.coreArtifact, role: 'core-source', contentHash: hash('b') },
  renderer: {
    artifactId: ids.rendererArtifact,
    role: 'renderer-data',
    contentHash: hash('c'),
  },
  manifest: { artifactId: ids.manifestArtifact, role: 'manifest', contentHash: hash('d') },
}

export const simulation = {
  id: ids.simulation,
  title: 'Projectile range explorer',
  createdAt,
  updatedAt: createdAt,
}

export const simulationVersion = {
  id: ids.version,
  simulationId: ids.simulation,
  versionNumber: 1,
  state: 'verified',
  revision: 4,
  activeConceptSpecId: ids.conceptSpec,
  activeGeneratedArtifactId: ids.generatedArtifact,
  activeArtifactBundle: artifactBundle,
  activeVerificationRunId: ids.verificationRun,
  createdAt,
  updatedAt: completedAt,
}

export const generationRun = {
  id: ids.generationRun,
  simulationVersionId: ids.version,
  status: 'succeeded',
  maxAttempts: 3,
  codexSessionId: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
  createdAt,
  completedAt,
}

export const generationAttempt = {
  id: ids.generationAttempt,
  generationRunId: ids.generationRun,
  attemptNumber: 1,
  outcome: 'verified',
  generatedArtifactId: ids.generatedArtifact,
  stableErrorId: null,
  createdAt,
  completedAt,
}

export const conceptSpec = {
  id: ids.conceptSpec,
  simulationVersionId: ids.version,
  generationRunId: ids.generationRun,
  schemaVersion: '1',
  domain: 'projectile',
  artifact: {
    artifactId: ids.conceptArtifact,
    role: 'concept-spec',
    contentHash: hash('a'),
  },
  createdAt,
}

export const artifact = {
  id: ids.coreArtifact,
  role: 'core-source',
  contentHash: hash('b'),
  mediaType: 'text/javascript',
  byteLength: 42_000,
  normalizationVersion: 1,
  createdAt,
}

export const generatedArtifact = {
  id: ids.generatedArtifact,
  generationAttemptId: ids.generationAttempt,
  artifactBundle,
  exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
  createdAt,
}

export const policyReference = {
  id: ids.policy,
  policyId: 'projectile.standard',
  version: '1.0.0',
  contentHash: hash('c'),
  createdAt,
}

export const domainPackReference = {
  id: ids.domainPack,
  domainPackId: 'projectile',
  version: '1.0.0',
  contentHash: hash('d'),
  createdAt,
}

export const verificationRun = {
  id: ids.verificationRun,
  simulationVersionId: ids.version,
  conceptSpecId: ids.conceptSpec,
  conceptSpecArtifact: conceptSpec.artifact,
  generatedArtifactId: ids.generatedArtifact,
  artifactBundle,
  policyReferenceId: ids.policy,
  domainPackReferenceId: ids.domainPack,
  policyContentHash: hash('c'),
  domainPackContentHash: hash('d'),
  runnerVersion: '1.0.0',
  runnerProtocolVersion: '1',
  dependencies: {
    schemaVersion: '1',
    entries: [
      { id: 'domain.runtime', version: '1.0.0', contentHash: hash('e') },
      { id: 'math.kernel', version: '2.1.0', contentHash: hash('f') },
    ],
    contentHash: hash('1'),
  },
  observationHash: hash('2'),
  report: {
    artifactId: ids.reportArtifact,
    role: 'verification-report',
    contentHash: hash('3'),
  },
  verdict: 'verified',
  createdAt: completedAt,
}

export const finding = {
  id: ids.finding,
  verificationRunId: ids.verificationRun,
  ordinal: 0,
  finding: {
    id: 'projectile.range.relative-error',
    category: 'mismatch',
    severity: 'error',
    checkId: 'projectile.range',
    quantity: 'rangeM',
    inputs: { initialSpeed: { value: 30, unit: 'm/s' } },
    expected: { value: 91.74, unit: 'm' },
    actual: { value: 60, unit: 'm' },
    tolerance: { mode: 'relative', relative: 0.01 },
    error: { mode: 'relative', value: 0.346 },
    explanation: 'The sampled range exceeds the accepted relative error.',
  },
  createdAt: completedAt,
}

export const publication = {
  id: ids.publication,
  simulationVersionId: ids.version,
  generatedArtifactId: ids.generatedArtifact,
  artifactBundle,
  verificationRunId: ids.verificationRun,
  verificationReport: verificationRun.report,
  exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
  publishedAt: completedAt,
}
