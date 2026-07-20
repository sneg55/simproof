import type { DatabaseSync } from 'node:sqlite'

export const REVERIFICATION_PROVIDER = 'simproof-reverify'
export const REVERIFICATION_MODEL = 'installed-authority'
export const REVERIFICATION_TEMPLATE = '1.0.0'

interface AttemptIdentity {
  readonly runId: string
  readonly attemptId: string
  readonly generatedArtifactId: string
}

export function isExactReverificationAttempt(
  database: DatabaseSync,
  input: AttemptIdentity,
): boolean {
  return (
    database
      .prepare(`SELECT 1 FROM generation_pipeline_attempts p
        JOIN generation_pipeline_runs current_run ON current_run.id=p.run_id
        JOIN generation_runs current_legacy ON current_legacy.id=current_run.id
        JOIN generation_pipeline_transitions initial
          ON initial.run_id=current_run.id AND initial.sequence=0
        JOIN generation_attempts current_attempt
          ON current_attempt.id=p.id AND current_attempt.generation_run_id=current_run.id
        JOIN simulation_versions version ON version.id=current_run.simulation_version_id
        JOIN generated_artifacts artifact ON artifact.id=current_attempt.generated_artifact_id
        JOIN generation_attempts source_attempt ON source_attempt.id=artifact.generation_attempt_id
        JOIN generation_runs source_run ON source_run.id=source_attempt.generation_run_id
        JOIN concept_specs concept ON concept.id=version.active_concept_spec_id
        WHERE current_run.id=? AND p.id=? AND current_attempt.generated_artifact_id=?
          AND p.attempt_number=1 AND current_attempt.attempt_number=1
          AND p.provider=? AND p.model_id=? AND p.template_version=?
          AND p.provider_request_id IS NULL AND p.codex_thread_id IS NULL
          AND current_run.max_attempts=1 AND current_run.max_provider_requests=1
          AND current_run.max_input_tokens=1 AND current_run.max_output_tokens=1
          AND current_run.max_cost_microusd=1 AND current_run.max_artifact_bytes=1
          AND current_run.used_provider_requests=0 AND current_run.used_input_tokens=0
          AND current_run.used_output_tokens=0 AND current_run.used_cost_microusd=0
          AND current_run.used_artifact_bytes=0
          AND initial.from_state IS NULL AND initial.to_state='executing'
          AND NOT EXISTS(
            SELECT 1 FROM generation_external_calls external WHERE external.run_id=current_run.id
          )
          AND NOT EXISTS(
            SELECT 1 FROM generation_provider_reservations reserved
            WHERE reserved.run_id=current_run.id
          )
          AND current_legacy.max_attempts=1 AND current_legacy.codex_session_id IS NULL
          AND current_legacy.created_at=current_run.created_at
          AND p.created_at=current_run.created_at AND current_attempt.created_at=current_run.created_at
          AND version.active_generated_artifact_id=current_attempt.generated_artifact_id
          AND version.active_artifact_bundle_json=artifact.artifact_bundle_json
          AND source_run.simulation_version_id=current_run.simulation_version_id
          AND concept.simulation_version_id=current_run.simulation_version_id
          AND concept.generation_run_id=source_run.id`)
      .get(
        input.runId,
        input.attemptId,
        input.generatedArtifactId,
        REVERIFICATION_PROVIDER,
        REVERIFICATION_MODEL,
        REVERIFICATION_TEMPLATE,
      ) !== undefined
  )
}

interface ScientificIdentity extends AttemptIdentity {
  readonly verificationRunId: string
  readonly artifactHash: string
  readonly findingsReference: string
  readonly outcome: 'verified' | 'rejected'
  readonly requireUnselectedReport: boolean
}

export function isExactReverificationEvidence(
  database: DatabaseSync,
  input: ScientificIdentity,
): boolean {
  if (!isExactReverificationAttempt(database, input)) return false
  const row = database
    .prepare(`SELECT report.id AS verification_run_id,report.report_hash,
      report.verdict,report.generated_artifact_id,report.concept_spec_id,
      report.artifact_bundle_json,version.active_verification_run_id,core.content_hash
      FROM generation_pipeline_runs current_run
      JOIN simulation_versions version ON version.id=current_run.simulation_version_id
      JOIN verification_runs report ON report.id=?
      JOIN generated_artifacts artifact ON artifact.id=version.active_generated_artifact_id
      JOIN stored_artifacts core ON core.id=artifact.core_artifact_id
      WHERE current_run.id=? AND report.simulation_version_id=version.id
        AND report.concept_spec_id=version.active_concept_spec_id
        AND report.generated_artifact_id=version.active_generated_artifact_id
        AND report.artifact_bundle_json=version.active_artifact_bundle_json`)
    .get(input.verificationRunId, input.runId) as
    | {
        verification_run_id: string
        report_hash: string
        verdict: string
        generated_artifact_id: string
        concept_spec_id: string
        artifact_bundle_json: string
        active_verification_run_id: string | null
        content_hash: string
      }
    | undefined
  return (
    row !== undefined &&
    row.verdict === input.outcome &&
    row.generated_artifact_id === input.generatedArtifactId &&
    row.content_hash === input.artifactHash &&
    row.report_hash === input.findingsReference &&
    (!input.requireUnselectedReport || row.active_verification_run_id !== row.verification_run_id)
  )
}
