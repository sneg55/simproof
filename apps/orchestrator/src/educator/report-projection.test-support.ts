import type {
  ArtifactBundle,
  PortableSimulationExport,
  SimulationVersion,
  VerificationReportDisplay,
} from '@simproof/contracts'
import type { VerificationRun } from '@simproof/persistence'
import { getDomainPack, hashCanonicalJson } from '@simproof/verifier'

export const UUIDS = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
] as const

export function versionFor(input: {
  readonly versionId: string
  readonly runId: string
  readonly coreHash: `sha256:${string}`
  readonly state: SimulationVersion['state']
  readonly revision: number
}): SimulationVersion {
  const { coreHash, revision, runId, state, versionId } = input
  return {
    id: versionId,
    simulationId: UUIDS[0],
    versionNumber: 1,
    state,
    revision,
    activeConceptSpecId: UUIDS[1],
    activeGeneratedArtifactId: UUIDS[2],
    activeArtifactBundle: bundle(coreHash),
    activeVerificationRunId: runId,
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  }
}

export function runFor(
  version: SimulationVersion,
  source: VerificationReportDisplay,
  domainPackHash: `sha256:${string}`,
): VerificationRun {
  if (version.activeArtifactBundle === null) throw new TypeError('bundle unavailable')
  return {
    id: source.report.reportId,
    simulationVersionId: version.id,
    conceptSpecId: UUIDS[1],
    conceptSpecArtifact: {
      artifactId: UUIDS[3],
      role: 'concept-spec',
      contentHash: source.report.conceptSpecHash,
    },
    generatedArtifactId: UUIDS[2],
    artifactBundle: version.activeArtifactBundle,
    policyReferenceId: UUIDS[4],
    domainPackReferenceId: UUIDS[5],
    policyContentHash: hashCanonicalJson(getDomainPack('projectile').policy),
    domainPackContentHash: domainPackHash,
    runnerVersion: source.report.runner.version,
    runnerProtocolVersion: source.report.runner.protocolVersion,
    dependencies: {
      schemaVersion: '1',
      entries: [],
      contentHash: `sha256:${'d'.repeat(64)}`,
    },
    observationHash: source.report.observationHash,
    report: {
      artifactId: UUIDS[5],
      role: 'verification-report',
      contentHash: hashCanonicalJson(source.report),
    },
    verdict: source.report.verdict,
    createdAt: source.report.createdAt,
  }
}

export function bundle(coreHash: `sha256:${string}`): ArtifactBundle {
  return {
    core: { artifactId: UUIDS[3], role: 'core-source' as const, contentHash: coreHash },
    renderer: {
      artifactId: UUIDS[4],
      role: 'renderer-data' as const,
      contentHash: `sha256:${'b'.repeat(64)}`,
    },
    manifest: {
      artifactId: UUIDS[5],
      role: 'manifest' as const,
      contentHash: `sha256:${'c'.repeat(64)}`,
    },
  }
}

export function portableExport(_versionId: string): PortableSimulationExport {
  return {
    records: { publications: [] },
  } as unknown as PortableSimulationExport
}
