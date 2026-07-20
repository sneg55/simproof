import type { DatabaseSync } from 'node:sqlite'
import { hasReverificationMarker } from './generation-reverification.js'
import type { CompleteGenerationAttemptInput, GenerationPipelineState } from './generation-types.js'
import { isExactReverificationEvidence } from './reverification-identity.js'
import { err, ok, type Result } from './types.js'

export interface ScientificAttemptEvidence {
  readonly attemptId: string
  readonly outcome: 'verified' | 'rejected'
  readonly verificationRunId: string
  readonly generatedArtifactId: string
  readonly findingsReference: string | null
}

interface LatestScientificRow {
  readonly attempt_id: string
  readonly outcome: string
  readonly verification_run_id: string
  readonly findings_reference: string | null
  readonly generated_artifact_id: string | null
  readonly verdict: string
  readonly verified_artifact_id: string
  readonly simulation_version_id: string
  readonly run_version_id: string
  readonly generation_run_id: string
  readonly artifact_hash: string | null
  readonly report_hash: string
  readonly generation_attempt_id: string
  readonly core_hash: string
}

export function validateAttemptScientificEvidence(
  database: DatabaseSync,
  runId: string,
  input: CompleteGenerationAttemptInput,
): Result<true> {
  if (input.outcome !== 'verified' && input.outcome !== 'rejected') return ok(true)
  if (input.verificationRunId === null || input.generatedArtifactId === null) {
    return err('invalid-input', 'Scientific outcomes require immutable verification evidence.')
  }
  const row = database
    .prepare(`SELECT v.verdict,v.generated_artifact_id,v.simulation_version_id,v.report_hash,
      c.generation_run_id,p.simulation_version_id AS run_version_id,g.generation_attempt_id,
      core.content_hash AS core_hash
      FROM verification_runs v
      JOIN concept_specs c ON c.id=v.concept_spec_id
      JOIN generation_pipeline_runs p ON p.id=?
      JOIN generated_artifacts g ON g.id=v.generated_artifact_id
      JOIN stored_artifacts core ON core.id=g.core_artifact_id
      WHERE v.id=?`)
    .get(runId, input.verificationRunId) as
    | {
        verdict: string
        generated_artifact_id: string
        simulation_version_id: string
        report_hash: string
        generation_run_id: string
        run_version_id: string
        generation_attempt_id: string
        core_hash: string
      }
    | undefined
  const reverifyMarker = hasReverificationMarker(database, runId)
  const normal =
    !reverifyMarker &&
    row !== undefined &&
    row.verdict === input.outcome &&
    row.generated_artifact_id === input.generatedArtifactId &&
    row.simulation_version_id === row.run_version_id &&
    row.generation_run_id === runId
  const reverified =
    reverifyMarker &&
    input.artifactHash !== null &&
    input.findingsReference !== null &&
    isExactReverificationEvidence(database, {
      runId,
      attemptId: input.id,
      generatedArtifactId: input.generatedArtifactId,
      verificationRunId: input.verificationRunId,
      artifactHash: input.artifactHash,
      findingsReference: input.findingsReference,
      outcome: input.outcome,
      requireUnselectedReport: true,
    })
  return normal || reverified
    ? ok(true)
    : err('invalid-input', 'Verification evidence does not match the scientific attempt.')
}

export function latestScientificEvidence(
  database: DatabaseSync,
  runId: string,
): ScientificAttemptEvidence | null {
  const row = database
    .prepare(`SELECT p.id AS attempt_id,p.outcome,p.verification_run_id,p.findings_reference,
      a.generated_artifact_id,v.verdict,v.generated_artifact_id AS verified_artifact_id,
      v.simulation_version_id,r.simulation_version_id AS run_version_id,c.generation_run_id,
      p.artifact_hash,v.report_hash,g.generation_attempt_id,core.content_hash AS core_hash
      FROM generation_pipeline_attempts p
      JOIN generation_attempts a ON a.id=p.id
      JOIN verification_runs v ON v.id=p.verification_run_id
      JOIN concept_specs c ON c.id=v.concept_spec_id
      JOIN generated_artifacts g ON g.id=v.generated_artifact_id
      JOIN stored_artifacts core ON core.id=g.core_artifact_id
      JOIN generation_pipeline_runs r ON r.id=p.run_id
      WHERE p.run_id=? ORDER BY p.attempt_number DESC LIMIT 1`)
    .get(runId) as LatestScientificRow | undefined
  const reverifyMarker = hasReverificationMarker(database, runId)
  const normal = !reverifyMarker && row !== undefined && row.generation_run_id === runId
  const reverified = exactLatestReverificationEvidence(database, runId, row, reverifyMarker)
  if (!latestEvidenceMatches(row, normal || reverified)) return null
  return {
    attemptId: row.attempt_id,
    outcome: row.outcome,
    verificationRunId: row.verification_run_id,
    generatedArtifactId: row.generated_artifact_id,
    findingsReference: row.findings_reference,
  }
}

function exactLatestReverificationEvidence(
  database: DatabaseSync,
  runId: string,
  row: LatestScientificRow | undefined,
  reverifyMarker: boolean,
): boolean {
  if (
    !reverifyMarker ||
    row === undefined ||
    row.generated_artifact_id === null ||
    row.artifact_hash === null ||
    row.findings_reference === null ||
    (row.outcome !== 'verified' && row.outcome !== 'rejected')
  ) {
    return false
  }
  return isExactReverificationEvidence(database, {
    runId,
    attemptId: row.attempt_id,
    generatedArtifactId: row.generated_artifact_id,
    verificationRunId: row.verification_run_id,
    artifactHash: row.artifact_hash,
    findingsReference: row.findings_reference,
    outcome: row.outcome,
    requireUnselectedReport: false,
  })
}

function latestEvidenceMatches(
  row: LatestScientificRow | undefined,
  lineageMatches: boolean,
): row is LatestScientificRow & {
  readonly outcome: 'verified' | 'rejected'
  readonly generated_artifact_id: string
} {
  if (row === undefined) return false
  return [
    row.outcome === 'verified' || row.outcome === 'rejected',
    row.outcome === row.verdict,
    row.generated_artifact_id !== null,
    row.generated_artifact_id === row.verified_artifact_id,
    row.simulation_version_id === row.run_version_id,
    lineageMatches,
  ].every(Boolean)
}

export function validateScientificTransition(
  database: DatabaseSync,
  runId: string,
  to: GenerationPipelineState,
): Result<true> {
  if (!['verified', 'rejected', 'repairing'].includes(to)) return ok(true)
  const evidence = latestScientificEvidence(database, runId)
  const expected = to === 'verified' ? 'verified' : 'rejected'
  if (evidence === null || evidence.outcome !== expected) {
    return err('invalid-state', 'Generation transition lacks matching verification evidence.')
  }
  if (to === 'repairing') return ok(true)
  const version = database
    .prepare(`SELECT state,active_verification_run_id,active_generated_artifact_id
      FROM simulation_versions WHERE id=(
        SELECT simulation_version_id FROM generation_pipeline_runs WHERE id=?
      )`)
    .get(runId) as
    | {
        state: string
        active_verification_run_id: string | null
        active_generated_artifact_id: string | null
      }
    | undefined
  return version !== undefined &&
    version.state === to &&
    version.active_verification_run_id === evidence.verificationRunId &&
    version.active_generated_artifact_id === evidence.generatedArtifactId
    ? ok(true)
    : err('invalid-state', 'Scientific generation terminal requires a settled version.')
}
