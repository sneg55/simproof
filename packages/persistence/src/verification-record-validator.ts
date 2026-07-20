import type { DatabaseSync } from 'node:sqlite'

import {
  domainPackReferenceSchema,
  publishedArtifactSchema,
  verificationFindingRecordSchema,
  verificationPolicyReferenceSchema,
  verificationReportSchema,
  verificationRunSchema,
} from '@simproof/contracts'

import { canonicalJson } from './artifact-codec.js'
import type { StoredObject } from './record-validator.js'

type Row = Record<string, unknown>
type Run = ReturnType<typeof verificationRunSchema.parse>
type PolicyRow = { policy_id: string; version: string; content_hash: string }
type DomainPackRow = { domain_pack_id: string; version: string; content_hash: string }

function json(value: unknown): unknown {
  return JSON.parse(String(value)) as unknown
}

function rows(database: DatabaseSync, statement: string): Row[] {
  return database.prepare(statement).all()
}

function validateTrustedReferences(database: DatabaseSync): void {
  for (const row of rows(database, 'SELECT * FROM verification_policy_references')) {
    verificationPolicyReferenceSchema.parse({
      id: row.id,
      policyId: row.policy_id,
      version: row.version,
      contentHash: row.content_hash,
      createdAt: row.created_at,
    })
  }
  for (const row of rows(database, 'SELECT * FROM domain_pack_references')) {
    domainPackReferenceSchema.parse({
      id: row.id,
      domainPackId: row.domain_pack_id,
      version: row.version,
      contentHash: row.content_hash,
      createdAt: row.created_at,
    })
  }
}

function validateRunColumns(row: Row, run: Run): void {
  const evidenceMatches = [
    run.conceptSpecId === row.concept_spec_id &&
      run.generatedArtifactId === row.generated_artifact_id,
    JSON.stringify(run.conceptSpecArtifact) === row.concept_artifact_json,
    JSON.stringify(run.artifactBundle) === row.artifact_bundle_json,
    run.policyReferenceId === row.policy_reference_id,
    run.domainPackReferenceId === row.domain_pack_reference_id,
    run.policyContentHash === row.policy_content_hash,
    run.domainPackContentHash === row.domain_pack_content_hash,
    run.runnerVersion === row.runner_version,
    run.runnerProtocolVersion === row.runner_protocol_version,
    JSON.stringify(run.dependencies) === row.dependencies_json,
    run.dependencies.contentHash === row.dependencies_hash,
    run.observationHash === row.observation_hash,
    run.report.artifactId === row.report_artifact_id,
    run.report.contentHash === row.report_hash,
  ].every(Boolean)
  if (!evidenceMatches) throw new TypeError('Verification evidence columns mismatch.')
}

function referenceRows(database: DatabaseSync, run: Run): [PolicyRow, DomainPackRow] {
  const policy = database
    .prepare('SELECT policy_id,version,content_hash FROM verification_policy_references WHERE id=?')
    .get(run.policyReferenceId) as PolicyRow | undefined
  const domainPack = database
    .prepare('SELECT domain_pack_id,version,content_hash FROM domain_pack_references WHERE id=?')
    .get(run.domainPackReferenceId) as DomainPackRow | undefined
  if (
    policy === undefined ||
    domainPack === undefined ||
    policy.content_hash !== run.policyContentHash ||
    domainPack.content_hash !== run.domainPackContentHash
  ) {
    throw new TypeError('Trusted reference hash mismatch.')
  }
  return [policy, domainPack]
}

function validateReport(
  database: DatabaseSync,
  run: Run,
  artifacts: ReadonlyMap<string, StoredObject>,
): void {
  const [policy, domainPack] = referenceRows(database, run)
  const reportObject = artifacts.get(run.report.artifactId)
  if (
    reportObject?.metadata.role !== 'verification-report' ||
    reportObject.metadata.contentHash !== run.report.contentHash
  ) {
    throw new TypeError('Verification report object mismatch.')
  }
  const report = verificationReportSchema.parse(JSON.parse(reportObject.content.toString('utf8')))
  const bindingsMatch = [
    report.verdict === run.verdict,
    report.conceptSpecHash === run.conceptSpecArtifact.contentHash,
    report.artifact.hash === run.artifactBundle.core.contentHash,
    report.policy.id === policy.policy_id,
    report.policy.version === policy.version,
    report.policy.contentHash === run.policyContentHash,
    report.domainPack.id === domainPack.domain_pack_id,
    report.domainPack.version === domainPack.version,
    report.domainPack.contentHash === run.domainPackContentHash,
    report.runner.version === run.runnerVersion,
    report.observationHash === run.observationHash,
  ].every(Boolean)
  if (!bindingsMatch) throw new TypeError('Verification report bindings mismatch.')
  const findingRows = database
    .prepare(
      'SELECT finding_json FROM verification_findings WHERE verification_run_id=? ORDER BY ordinal',
    )
    .all(run.id) as unknown as Row[]
  if (
    canonicalJson(report.findings) !==
    canonicalJson(findingRows.map(({ finding_json }) => json(finding_json)))
  ) {
    throw new TypeError('Verification report findings mismatch.')
  }
}

function validateRuns(database: DatabaseSync, artifacts: ReadonlyMap<string, StoredObject>): void {
  for (const row of rows(database, 'SELECT * FROM verification_runs')) {
    const run = verificationRunSchema.parse({
      id: row.id,
      simulationVersionId: row.simulation_version_id,
      ...(json(row.evidence_json) as object),
      verdict: row.verdict,
      createdAt: row.created_at,
    })
    validateRunColumns(row, run)
    validateRunOwnership(database, run)
    validateReport(database, run, artifacts)
  }
}

function validateRunOwnership(database: DatabaseSync, run: Run): void {
  const source = database
    .prepare(`SELECT c.generation_run_id AS concept_generation_run_id,
      c.artifact_id AS concept_artifact_id,c.artifact_hash AS concept_artifact_hash,
      a.generation_run_id AS artifact_generation_run_id,g.artifact_bundle_json
      FROM concept_specs c
      JOIN generated_artifacts g ON g.id=?
      JOIN generation_attempts a ON a.id=g.generation_attempt_id
      JOIN generation_runs gr ON gr.id=a.generation_run_id
      WHERE c.id=? AND c.simulation_version_id=? AND gr.simulation_version_id=?`)
    .get(
      run.generatedArtifactId,
      run.conceptSpecId,
      run.simulationVersionId,
      run.simulationVersionId,
    ) as
    | {
        concept_generation_run_id: string
        concept_artifact_id: string
        concept_artifact_hash: string
        artifact_generation_run_id: string
        artifact_bundle_json: string
      }
    | undefined
  if (
    source === undefined ||
    source.concept_generation_run_id !== source.artifact_generation_run_id ||
    source.concept_artifact_id !== run.conceptSpecArtifact.artifactId ||
    source.concept_artifact_hash !== run.conceptSpecArtifact.contentHash ||
    source.artifact_bundle_json !== JSON.stringify(run.artifactBundle)
  ) {
    throw new TypeError('Verification run source provenance mismatch.')
  }
}

function validateFindings(database: DatabaseSync): void {
  for (const row of rows(database, 'SELECT * FROM verification_findings')) {
    verificationFindingRecordSchema.parse({
      id: row.id,
      verificationRunId: row.verification_run_id,
      ordinal: row.ordinal,
      finding: json(row.finding_json),
      createdAt: row.created_at,
    })
  }
}

function validatePublications(database: DatabaseSync): void {
  for (const row of rows(database, 'SELECT * FROM published_artifacts')) {
    const publication = publishedArtifactSchema.parse({
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
    const verification = database
      .prepare(`SELECT simulation_version_id,generated_artifact_id,artifact_bundle_json,
        report_artifact_id,report_hash,verdict FROM verification_runs WHERE id=?`)
      .get(publication.verificationRunId) as Row | undefined
    if (
      verification === undefined ||
      verification.verdict !== 'verified' ||
      verification.simulation_version_id !== publication.simulationVersionId ||
      verification.generated_artifact_id !== publication.generatedArtifactId ||
      verification.artifact_bundle_json !== JSON.stringify(publication.artifactBundle) ||
      verification.report_artifact_id !== publication.verificationReport.artifactId ||
      verification.report_hash !== publication.verificationReport.contentHash
    ) {
      throw new TypeError('Publication snapshot mismatch.')
    }
  }
}

export function validateVerificationRecords(
  database: DatabaseSync,
  artifacts: ReadonlyMap<string, StoredObject>,
): void {
  validateTrustedReferences(database)
  validateRuns(database, artifacts)
  validateFindings(database)
  validatePublications(database)
}
