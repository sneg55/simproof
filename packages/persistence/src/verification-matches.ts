import type {
  PublishedArtifact,
  ReportValidity,
  SimulationVersion,
  VerificationRun,
} from '@simproof/contracts'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function finalizationMatches(
  version: SimulationVersion,
  run: VerificationRun,
  input: { versionId: string; expectedRevision: number },
): boolean {
  return [
    version.state === 'verifying',
    version.revision === input.expectedRevision,
    run.simulationVersionId === input.versionId,
    run.conceptSpecId === version.activeConceptSpecId,
    run.generatedArtifactId === version.activeGeneratedArtifactId,
    same(run.artifactBundle, version.activeArtifactBundle),
  ].every(Boolean)
}

export function publicationMatches(input: {
  publication: PublishedArtifact
  version: SimulationVersion
  run: VerificationRun
  expectedRevision: number
  validity: ReportValidity
}): boolean {
  const { publication, version, run, expectedRevision, validity } = input
  return [
    version.state === 'verified',
    version.revision === expectedRevision,
    version.activeVerificationRunId === publication.verificationRunId,
    validity.status === 'current',
    publication.generatedArtifactId === version.activeGeneratedArtifactId,
    same(publication.artifactBundle, version.activeArtifactBundle),
    publication.generatedArtifactId === run.generatedArtifactId,
    same(publication.artifactBundle, run.artifactBundle),
    same(publication.verificationReport, run.report),
  ].every(Boolean)
}
