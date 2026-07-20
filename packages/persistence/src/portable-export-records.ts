import {
  conceptSpecRecordSchema,
  domainPackReferenceSchema,
  duplicateVersionLineageRecordSchema,
  generatedArtifactSchema,
  generationAttemptSchema,
  generationRunSchema,
  publishedArtifactSchema,
  verificationFindingRecordSchema,
  verificationPolicyReferenceSchema,
  verificationRunSchema,
} from '@simproof/contracts'

export const recordQueries = Object.freeze({
  generationRuns: `SELECT r.id,r.simulation_version_id,r.status,r.max_attempts,r.codex_session_id,r.created_at,r.completed_at
    FROM generation_runs r JOIN simulation_versions v ON v.id=r.simulation_version_id WHERE v.simulation_id=?`,
  generationAttempts: `SELECT a.id,a.generation_run_id,a.attempt_number,a.outcome,a.generated_artifact_id,a.stable_error_id,a.created_at,a.completed_at
    FROM generation_attempts a JOIN generation_runs r ON r.id=a.generation_run_id
    JOIN simulation_versions v ON v.id=r.simulation_version_id WHERE v.simulation_id=?`,
  conceptSpecs: `SELECT c.id,c.simulation_version_id,c.generation_run_id,c.schema_version,c.domain,c.artifact_id,c.artifact_hash,c.created_at
    FROM concept_specs c JOIN simulation_versions v ON v.id=c.simulation_version_id WHERE v.simulation_id=?`,
  generatedArtifacts: `SELECT g.id,g.generation_attempt_id,g.artifact_bundle_json,g.export_license_json,g.created_at
    FROM generated_artifacts g JOIN generation_attempts a ON a.id=g.generation_attempt_id
    JOIN generation_runs r ON r.id=a.generation_run_id JOIN simulation_versions v ON v.id=r.simulation_version_id WHERE v.simulation_id=?`,
  verificationRuns: `SELECT q.id,q.simulation_version_id,q.evidence_json,q.verdict,q.created_at FROM verification_runs q
    JOIN simulation_versions v ON v.id=q.simulation_version_id WHERE v.simulation_id=?`,
  findings: `SELECT f.id,f.verification_run_id,f.ordinal,f.finding_json,f.created_at FROM verification_findings f
    JOIN verification_runs q ON q.id=f.verification_run_id JOIN simulation_versions v ON v.id=q.simulation_version_id WHERE v.simulation_id=?`,
  publications: `SELECT p.id,p.simulation_version_id,p.generated_artifact_id,p.artifact_bundle_json,p.verification_run_id,
    p.verification_report_artifact_id,p.verification_report_hash,p.export_license_json,p.published_at
    FROM published_artifacts p JOIN simulation_versions v ON v.id=p.simulation_version_id WHERE v.simulation_id=?`,
  policyReferences: `SELECT DISTINCT p.id,p.policy_id,p.version,p.content_hash,p.created_at FROM verification_policy_references p
    JOIN verification_runs q ON q.policy_reference_id=p.id JOIN simulation_versions v ON v.id=q.simulation_version_id WHERE v.simulation_id=?`,
  domainPackReferences: `SELECT DISTINCT d.id,d.domain_pack_id,d.version,d.content_hash,d.created_at FROM domain_pack_references d
    JOIN verification_runs q ON q.domain_pack_reference_id=d.id JOIN simulation_versions v ON v.id=q.simulation_version_id WHERE v.simulation_id=?`,
  lineages: `SELECT l.destination_version_id AS id,l.source_simulation_id,l.source_version_id,
    l.source_version_number,l.source_revision,l.kind,l.created_at FROM version_lineage l
    JOIN simulation_versions v ON v.id=l.destination_version_id WHERE v.simulation_id=?`,
})

export function portableRecord(
  name: string,
  row: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const json = (value: unknown) => JSON.parse(String(value)) as unknown
  switch (name) {
    case 'generationRuns':
      return generationRunSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        status: row.status,
        maxAttempts: row.max_attempts,
        codexSessionId: row.codex_session_id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })
    case 'generationAttempts':
      return generationAttemptSchema.parse({
        id: row.id,
        generationRunId: row.generation_run_id,
        attemptNumber: row.attempt_number,
        outcome: row.outcome,
        generatedArtifactId: row.generated_artifact_id,
        stableErrorId: row.stable_error_id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })
    case 'conceptSpecs':
      return conceptSpecRecordSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        generationRunId: row.generation_run_id,
        schemaVersion: row.schema_version,
        domain: row.domain,
        artifact: {
          artifactId: row.artifact_id,
          role: 'concept-spec',
          contentHash: row.artifact_hash,
        },
        createdAt: row.created_at,
      })
    case 'generatedArtifacts':
      return generatedArtifactSchema.parse({
        id: row.id,
        generationAttemptId: row.generation_attempt_id,
        artifactBundle: json(row.artifact_bundle_json),
        exportLicense: json(row.export_license_json),
        createdAt: row.created_at,
      })
    case 'lineages':
      return duplicateVersionLineageRecordSchema.parse({
        id: row.id,
        kind: row.kind,
        sourceSimulationId: row.source_simulation_id,
        sourceVersionId: row.source_version_id,
        sourceVersionNumber: row.source_version_number,
        sourceRevision: row.source_revision,
        duplicatedAt: row.created_at,
      })
    case 'verificationRuns':
      return verificationRunSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        ...(json(row.evidence_json) as object),
        verdict: row.verdict,
        createdAt: row.created_at,
      })
    case 'findings':
      return verificationFindingRecordSchema.parse({
        id: row.id,
        verificationRunId: row.verification_run_id,
        ordinal: row.ordinal,
        finding: json(row.finding_json),
        createdAt: row.created_at,
      })
    case 'publications':
      return publishedArtifactSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        generatedArtifactId: row.generated_artifact_id,
        artifactBundle: json(row.artifact_bundle_json),
        verificationRunId: row.verification_run_id,
        verificationReport: {
          artifactId: row.verification_report_artifact_id,
          role: 'verification-report',
          contentHash: row.verification_report_hash,
        },
        exportLicense: json(row.export_license_json),
        publishedAt: row.published_at,
      })
    case 'policyReferences':
      return verificationPolicyReferenceSchema.parse({
        id: row.id,
        policyId: row.policy_id,
        version: row.version,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      })
    case 'domainPackReferences':
      return domainPackReferenceSchema.parse({
        id: row.id,
        domainPackId: row.domain_pack_id,
        version: row.version,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      })
    default:
      throw new TypeError('Export record allowlist is invalid.')
  }
}

export function compareRecordId(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): number {
  return String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0
}
