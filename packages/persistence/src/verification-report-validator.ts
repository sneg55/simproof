import type { DatabaseSync } from 'node:sqlite'

import type { VerificationFinding, VerificationRun } from '@simproof/contracts'
import { verificationReportSchema } from '@simproof/contracts'
import { canonicalJson } from './artifact-codec.js'
import type { ArtifactStore } from './artifact-store.js'
import { err, ok, type Result } from './types.js'

type ReferenceRow = { reference_id: string; version: string; content_hash: string }

export async function validateReportArtifact(
  database: DatabaseSync,
  run: VerificationRun,
  findings: readonly VerificationFinding[],
  store: ArtifactStore,
): Promise<Result<true>> {
  const object = await store.get(run.report.contentHash)
  if (!object.ok) return object
  return validateReportContent(database, run, findings, object.value)
    ? ok(true)
    : err('corrupt-artifact', 'Verification report bindings are invalid.')
}

export function validateReportContent(
  database: DatabaseSync,
  run: VerificationRun,
  findings: readonly VerificationFinding[],
  content: Buffer,
): boolean {
  try {
    const report = verificationReportSchema.parse(JSON.parse(content.toString('utf8')))
    const policy = database
      .prepare(`SELECT policy_id AS reference_id,version,content_hash
        FROM verification_policy_references WHERE id=?`)
      .get(run.policyReferenceId) as ReferenceRow | undefined
    const domainPack = database
      .prepare(`SELECT domain_pack_id AS reference_id,version,content_hash
        FROM domain_pack_references WHERE id=?`)
      .get(run.domainPackReferenceId) as ReferenceRow | undefined
    return [
      policy !== undefined,
      domainPack !== undefined,
      report.verdict === run.verdict,
      report.conceptSpecHash === run.conceptSpecArtifact.contentHash,
      report.artifact.hash === run.artifactBundle.core.contentHash,
      sameReference(report.policy, policy),
      sameReference(report.domainPack, domainPack),
      report.runner.version === run.runnerVersion,
      String(report.runner.protocolVersion) === String(run.runnerProtocolVersion),
      report.observationHash === run.observationHash,
      canonicalJson(report.findings) === canonicalJson(findings),
    ].every(Boolean)
  } catch {
    return false
  }
}

function sameReference(
  report: { id: string; version: string; contentHash: string },
  row: ReferenceRow | undefined,
): boolean {
  return (
    row !== undefined &&
    report.id === row.reference_id &&
    report.version === row.version &&
    report.contentHash === row.content_hash
  )
}
