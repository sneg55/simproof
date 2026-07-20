import {
  type ArtifactBundle,
  type PersistenceEvidenceBindings,
  persistenceEvidenceBindingsSchema,
  type VerificationFinding,
  type VerificationRun,
} from '@simproof/contracts'

import { expectOk, fixture, id, NOW, sha, stored } from './test-helpers.js'
import { err, ok, type TrustedVerificationEnvironment } from './types.js'

export async function verifiedFixture(
  name: string,
  options: { verdict?: 'verified' | 'rejected'; findings?: readonly VerificationFinding[] } = {},
) {
  const verdict = options.verdict ?? 'verified'
  const findingObjects = options.findings ?? []
  let installedEnvironment: TrustedVerificationEnvironment | undefined
  const base = await fixture(name, () =>
    installedEnvironment === undefined
      ? err('invalid-state', 'Installed evidence is not configured.')
      : ok(installedEnvironment),
  )
  const simulationId = id()
  const versionId = id()
  expectOk(
    base.database.createSimulation({
      id: simulationId,
      title: 'Pendulum lab',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  expectOk(
    base.database.createDraftVersion({
      id: versionId,
      simulationId,
      versionNumber: 1,
      state: 'draft',
      revision: 0,
      activeConceptSpecId: null,
      activeGeneratedArtifactId: null,
      activeArtifactBundle: null,
      activeVerificationRunId: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  const generationRunId = id()
  expectOk(
    base.database.beginGeneration({
      versionId,
      expectedRevision: 0,
      updatedAt: NOW,
      run: {
        id: generationRunId,
        simulationVersionId: versionId,
        status: 'running',
        maxAttempts: 3,
        codexSessionId: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
        createdAt: NOW,
        completedAt: null,
      },
    }),
  )
  const attemptId = id()
  expectOk(
    base.database.records.insertGenerationAttempt({
      id: attemptId,
      generationRunId,
      attemptNumber: 1,
      outcome: 'pending',
      generatedArtifactId: null,
      stableErrorId: null,
      createdAt: NOW,
      completedAt: null,
    }),
  )
  const conceptObject = await stored(
    base.database,
    base.store,
    'concept-spec',
    JSON.stringify({
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum lab',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 0, max: 20 } },
      },
      requestedControls: ['length', 'amplitude'],
    }),
  )
  const conceptSpecId = id()
  expectOk(
    base.database.records.insertConceptSpec({
      id: conceptSpecId,
      simulationVersionId: versionId,
      generationRunId,
      schemaVersion: '1',
      domain: 'pendulum',
      artifact: {
        artifactId: conceptObject.id,
        role: 'concept-spec',
        contentHash: conceptObject.contentHash,
      },
      createdAt: NOW,
    }),
  )
  const core = await stored(base.database, base.store, 'core-source', 'export default {}')
  const renderer = await stored(base.database, base.store, 'renderer-data', '{"kind":"pendulum"}')
  const manifest = await stored(base.database, base.store, 'manifest', '{"schemaVersion":"1"}')
  const artifactBundle: ArtifactBundle = {
    core: { artifactId: core.id, role: 'core-source', contentHash: core.contentHash },
    renderer: { artifactId: renderer.id, role: 'renderer-data', contentHash: renderer.contentHash },
    manifest: { artifactId: manifest.id, role: 'manifest', contentHash: manifest.contentHash },
  }
  const generatedArtifactId = id()
  expectOk(
    base.database.records.insertGeneratedArtifact({
      id: generatedArtifactId,
      generationAttemptId: attemptId,
      artifactBundle,
      exportLicense: { kind: 'custom', label: 'Teacher owned', referenceUrl: null },
      createdAt: NOW,
    }),
  )
  expectOk(
    base.database.records.updateGenerationAttempt({
      id: attemptId,
      outcome: verdict === 'rejected' ? 'rejected' : 'verified',
      generatedArtifactId,
      stableErrorId: null,
      completedAt: NOW,
    }),
  )
  expectOk(
    base.database.bindCandidate({
      id: versionId,
      expectedRevision: 1,
      conceptSpecId,
      generatedArtifactId,
      artifactBundle,
      updatedAt: NOW,
    }),
  )
  expectOk(
    base.database.transitionVersion({
      id: versionId,
      expectedRevision: 2,
      to: 'verifying',
      updatedAt: NOW,
    }),
  )
  const policy = {
    id: id(),
    policyId: 'pendulum.small-angle',
    version: '1.0.0',
    contentHash: sha('policy'),
    createdAt: NOW,
  }
  const domainPack = {
    id: id(),
    domainPackId: 'pendulum',
    version: '1.0.0',
    contentHash: sha('pack'),
    createdAt: NOW,
  }
  expectOk(base.database.records.insertPolicyReference(policy))
  expectOk(base.database.records.insertDomainPackReference(domainPack))
  const report = await stored(
    base.database,
    base.store,
    'verification-report',
    JSON.stringify({
      schemaVersion: '1',
      reportId: id(),
      createdAt: NOW,
      conceptSpecHash: conceptObject.contentHash,
      artifact: { hash: core.contentHash },
      policy: { id: policy.policyId, version: policy.version, contentHash: policy.contentHash },
      domainPack: {
        id: domainPack.domainPackId,
        version: domainPack.version,
        contentHash: domainPack.contentHash,
      },
      runner: { version: '1.0.0', protocolVersion: '1' },
      observationHash: sha('observations'),
      verdict,
      checks: [
        {
          id: 'period.matches',
          outcome: verdict === 'rejected' ? 'failed' : 'passed',
          sampleCount: 1,
        },
      ],
      findings: findingObjects,
      testedScope: {
        parameters: [{ parameter: 'lengthM', unit: 'm', min: 0.5, max: 2 }],
        sampleCount: 1,
        samplingGridHash: sha('grid'),
      },
      assumptions: ['Small-angle pendulum.'],
      limitations: ['Verified only over the trusted grid.'],
    }),
  )
  const evidence: PersistenceEvidenceBindings = persistenceEvidenceBindingsSchema.parse({
    conceptSpecId,
    conceptSpecArtifact: {
      artifactId: conceptObject.id,
      role: 'concept-spec',
      contentHash: conceptObject.contentHash,
    },
    generatedArtifactId,
    artifactBundle,
    policyReferenceId: policy.id,
    domainPackReferenceId: domainPack.id,
    policyContentHash: policy.contentHash,
    domainPackContentHash: domainPack.contentHash,
    runnerVersion: '1.0.0',
    runnerProtocolVersion: '1',
    dependencies: { schemaVersion: '1', entries: [], contentHash: sha('dependencies') },
    observationHash: sha('observations'),
    report: { artifactId: report.id, role: 'verification-report', contentHash: report.contentHash },
  })
  const verificationRun: VerificationRun = {
    id: id(),
    simulationVersionId: versionId,
    ...evidence,
    verdict,
    createdAt: NOW,
  }
  const findingRecords = findingObjects.map((finding, ordinal) => ({
    id: id(),
    verificationRunId: verificationRun.id,
    ordinal,
    finding,
    createdAt: NOW,
  }))
  expectOk(await base.database.verification.insert(verificationRun, findingRecords, base.store))
  const environment = {
    policyReferenceId: evidence.policyReferenceId,
    policyContentHash: evidence.policyContentHash,
    domainPackReferenceId: evidence.domainPackReferenceId,
    domainPackContentHash: evidence.domainPackContentHash,
    runnerVersion: evidence.runnerVersion,
    runnerProtocolVersion: evidence.runnerProtocolVersion,
    dependencies: evidence.dependencies,
  }
  installedEnvironment = environment
  expectOk(
    await base.database.verification.finalizeVersion(
      {
        versionId,
        expectedRevision: 3,
        verificationRunId: verificationRun.id,
        updatedAt: NOW,
      },
      base.store,
    ),
  )
  return {
    ...base,
    simulationId,
    versionId,
    generationRunId,
    attemptId,
    conceptSpecId,
    generatedArtifactId,
    artifactBundle,
    evidence,
    environment,
    setInstalledEnvironment(value: TrustedVerificationEnvironment) {
      installedEnvironment = value
    },
    verificationRun,
  }
}

export async function rejectedFixture(name: string, findings: readonly VerificationFinding[]) {
  return await verifiedFixture(name, { verdict: 'rejected', findings })
}
