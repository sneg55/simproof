import { describe, expect, it } from 'vitest'

import {
  conceptSpecRecordSchema,
  domainPackReferenceSchema,
  generatedArtifactSchema,
  generationAttemptSchema,
  generationRunSchema,
  persistenceEvidenceBindingsSchema,
  portableSimulationExportSchema,
  publishedArtifactSchema,
  simulationLifecycleStateSchema,
  simulationSchema,
  simulationVersionSchema,
  storedArtifactSchema,
  verificationFindingRecordSchema,
  verificationPolicyReferenceSchema,
  verificationRunSchema,
} from '../index.js'
import {
  artifact,
  artifactBundle,
  conceptSpec,
  domainPackReference,
  finding,
  generatedArtifact,
  generationAttempt,
  generationRun,
  hash,
  ids,
  policyReference,
  publication,
  simulation,
  simulationVersion,
  verificationRun,
} from './persistence.fixtures.js'

describe('persistence record contracts', () => {
  it('accepts every required durable record and exact evidence snapshot', () => {
    expect(simulationSchema.safeParse(simulation).success).toBe(true)
    expect(simulationVersionSchema.safeParse(simulationVersion).success).toBe(true)
    expect(generationRunSchema.safeParse(generationRun).success).toBe(true)
    expect(generationAttemptSchema.safeParse(generationAttempt).success).toBe(true)
    expect(conceptSpecRecordSchema.safeParse(conceptSpec).success).toBe(true)
    expect(storedArtifactSchema.safeParse(artifact).success).toBe(true)
    expect(generatedArtifactSchema.safeParse(generatedArtifact).success).toBe(true)
    expect(verificationPolicyReferenceSchema.safeParse(policyReference).success).toBe(true)
    expect(domainPackReferenceSchema.safeParse(domainPackReference).success).toBe(true)
    expect(verificationRunSchema.safeParse(verificationRun).success).toBe(true)
    expect(verificationFindingRecordSchema.safeParse(finding).success).toBe(true)
    expect(publishedArtifactSchema.safeParse(publication).success).toBe(true)

    const {
      createdAt: _createdAt,
      id: _id,
      simulationVersionId: _version,
      verdict: _verdict,
      ...evidence
    } = verificationRun
    expect(persistenceEvidenceBindingsSchema.safeParse(evidence).success).toBe(true)
  })

  it.each([
    'draft',
    'generating',
    'verifying',
    'rejected',
    'verified',
    'stale',
    'published',
    'archived',
  ])('accepts the %s durable lifecycle state', (state) => {
    expect(simulationLifecycleStateSchema.safeParse(state).success).toBe(true)
  })

  it('does not model deletion as a lifecycle state', () => {
    expect(simulationLifecycleStateSchema.safeParse('deleted').success).toBe(false)
  })

  it('requires an exact schema-derived portable simulation export', () => {
    const portableArtifacts = [
      { ...artifact, byteLength: 2, content: '//' },
      {
        id: ids.conceptArtifact,
        role: 'concept-spec',
        contentHash: conceptSpec.artifact.contentHash,
        mediaType: 'application/json',
        byteLength: 2,
        normalizationVersion: 1,
        createdAt: artifact.createdAt,
        content: '{}',
      },
      {
        id: ids.rendererArtifact,
        role: 'renderer-data',
        contentHash: artifactBundle.renderer.contentHash,
        mediaType: 'application/json',
        byteLength: 2,
        normalizationVersion: 1,
        createdAt: artifact.createdAt,
        content: '{}',
      },
      {
        id: ids.manifestArtifact,
        role: 'manifest',
        contentHash: artifactBundle.manifest.contentHash,
        mediaType: 'application/json',
        byteLength: 2,
        normalizationVersion: 1,
        createdAt: artifact.createdAt,
        content: '{}',
      },
      {
        id: ids.reportArtifact,
        role: 'verification-report',
        contentHash: verificationRun.report.contentHash,
        mediaType: 'application/json',
        byteLength: 2,
        normalizationVersion: 1,
        createdAt: artifact.createdAt,
        content: '{}',
      },
    ].sort((left, right) => left.id.localeCompare(right.id))
    const portableExport = {
      schemaVersion: '1',
      simulation,
      versions: [simulationVersion],
      records: {
        generationRuns: [generationRun],
        generationAttempts: [generationAttempt],
        conceptSpecs: [conceptSpec],
        generatedArtifacts: [generatedArtifact],
        verificationRuns: [verificationRun],
        findings: [finding],
        publications: [publication],
        policyReferences: [policyReference],
        domainPackReferences: [domainPackReference],
        lineages: [],
      },
      artifacts: portableArtifacts,
    }
    expect(portableSimulationExportSchema.safeParse(portableExport).success).toBe(true)
    expect(
      portableSimulationExportSchema.safeParse({
        ...portableExport,
        records: {
          ...portableExport.records,
          verificationRuns: [
            {
              id: verificationRun.id,
              simulation_version_id: verificationRun.simulationVersionId,
              evidence_json: JSON.stringify(verificationRun),
            },
          ],
        },
      }).success,
    ).toBe(false)
    expect(
      portableSimulationExportSchema.safeParse({
        ...portableExport,
        records: { ...portableExport.records, credentials: [] },
      }).success,
    ).toBe(false)
    expect(
      portableSimulationExportSchema.safeParse({
        ...portableExport,
        artifacts: [
          { ...portableArtifacts[0], byteLength: portableArtifacts[0]!.byteLength + 1 },
          ...portableArtifacts.slice(1),
        ],
      }).success,
    ).toBe(false)
  })

  it.each([
    ['core-source', 'text/javascript'],
    ['renderer-source', 'text/javascript'],
    ['renderer-data', 'application/json'],
    ['manifest', 'application/json'],
    ['concept-spec', 'application/json'],
    ['verification-report', 'application/json'],
  ])('accepts the %s content-addressed role', (role, mediaType) => {
    expect(storedArtifactSchema.safeParse({ ...artifact, role, mediaType }).success).toBe(true)
  })

  it('accepts a safe custom license reference', () => {
    expect(
      generatedArtifactSchema.safeParse({
        ...generatedArtifact,
        exportLicense: {
          kind: 'custom',
          label: 'Deployment-approved terms',
          referenceUrl: 'https://licenses.example.test/terms/v1',
        },
      }).success,
    ).toBe(true)
  })

  it.each([
    ['unknown simulation property', simulationSchema, { ...simulation, ownerId: 'student-1' }],
    [
      'updated timestamp before creation',
      simulationSchema,
      { ...simulation, updatedAt: '2026-07-15T12:00:00.000Z' },
    ],
    [
      'verified version without current evidence',
      simulationVersionSchema,
      { ...simulationVersion, activeVerificationRunId: null },
    ],
    [
      'draft version with generated content',
      simulationVersionSchema,
      {
        ...simulationVersion,
        state: 'draft',
        activeConceptSpecId: null,
        activeVerificationRunId: null,
      },
    ],
    [
      'version with a generated-artifact ID but no exact bundle',
      simulationVersionSchema,
      { ...simulationVersion, activeArtifactBundle: null },
    ],
    [
      'completed run without completion',
      generationRunSchema,
      { ...generationRun, completedAt: null },
    ],
    ['running run with completion', generationRunSchema, { ...generationRun, status: 'running' }],
    [
      'verified attempt without an artifact',
      generationAttemptSchema,
      { ...generationAttempt, generatedArtifactId: null },
    ],
    [
      'provider failure without a stable error',
      generationAttemptSchema,
      {
        ...generationAttempt,
        outcome: 'provider-failed',
        generatedArtifactId: null,
        stableErrorId: null,
      },
    ],
    [
      'scientific rejection with an operational error',
      generationAttemptSchema,
      { ...generationAttempt, outcome: 'rejected', stableErrorId: 'provider.rate-limit' },
    ],
    ['artifact with a host path', storedArtifactSchema, { ...artifact, path: '/var/lib/core.js' }],
    [
      'artifact with a role-inconsistent media type',
      storedArtifactSchema,
      { ...artifact, role: 'manifest', mediaType: 'text/javascript' },
    ],
    [
      'artifact hash without algorithm prefix',
      storedArtifactSchema,
      { ...artifact, contentHash: 'b'.repeat(64) },
    ],
    [
      'concept spec with only a detached hash',
      conceptSpecRecordSchema,
      { ...conceptSpec, artifact: undefined, contentHash: hash('a') },
    ],
    [
      'bundle with renderer in the manifest slot',
      simulationVersionSchema,
      {
        ...simulationVersion,
        activeArtifactBundle: {
          ...artifactBundle,
          manifest: { ...artifactBundle.manifest, role: 'renderer-data' },
        },
      },
    ],
    [
      'verification without a dependency hash',
      verificationRunSchema,
      {
        ...verificationRun,
        dependencies: { ...verificationRun.dependencies, contentHash: undefined },
      },
    ],
    [
      'verification with unsorted dependencies',
      verificationRunSchema,
      {
        ...verificationRun,
        dependencies: {
          ...verificationRun.dependencies,
          entries: [...verificationRun.dependencies.entries].reverse(),
        },
      },
    ],
    [
      'verification with duplicate dependency IDs',
      verificationRunSchema,
      {
        ...verificationRun,
        dependencies: {
          ...verificationRun.dependencies,
          entries: [
            verificationRun.dependencies.entries[0],
            { ...verificationRun.dependencies.entries[0], contentHash: hash('4') },
          ],
        },
      },
    ],
    [
      'verification with too many dependencies',
      verificationRunSchema,
      {
        ...verificationRun,
        dependencies: {
          ...verificationRun.dependencies,
          entries: Array.from({ length: 65 }, (_, index) => ({
            id: `dependency.${index.toString().padStart(2, '0')}`,
            version: '1.0.0',
            contentHash: hash('5'),
          })),
        },
      },
    ],
    [
      'custom license URL with credentials',
      generatedArtifactSchema,
      {
        ...generatedArtifact,
        exportLicense: {
          kind: 'custom',
          label: 'Unsafe',
          referenceUrl: 'https://user:password@licenses.example.test/terms',
        },
      },
    ],
    [
      'custom license URL with query or fragment',
      generatedArtifactSchema,
      {
        ...generatedArtifact,
        exportLicense: {
          kind: 'custom',
          label: 'Unsafe',
          referenceUrl: 'https://licenses.example.test/terms?token=value#details',
        },
      },
    ],
    [
      'policy reference with mutable arbitrary data',
      verificationPolicyReferenceSchema,
      { ...policyReference, tolerances: { range: 1 } },
    ],
    [
      'verification with a non-versioned runner',
      verificationRunSchema,
      { ...verificationRun, runnerVersion: 'latest' },
    ],
    [
      'finding with a negative ordering position',
      verificationFindingRecordSchema,
      { ...finding, ordinal: -1 },
    ],
    [
      'publication without explicit license metadata',
      publishedArtifactSchema,
      { ...publication, exportLicense: undefined },
    ],
  ])('rejects %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
})
