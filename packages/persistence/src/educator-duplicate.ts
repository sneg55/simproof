import type { DatabaseSync } from 'node:sqlite'

import {
  artifactBundleSchema,
  type Simulation,
  type SimulationVersion,
  simulationVersionSchema,
} from '@simproof/contracts'
import type { DuplicateDraftInput } from './educator-types.js'

interface DuplicateContentInput {
  readonly source: SimulationVersion
  readonly simulation: Simulation
  readonly destinationVersionId: string
  readonly copiedRecordIds: DuplicateDraftInput['copiedRecordIds']
  readonly createdAt: string
}

export function duplicateEditableContent(
  database: DatabaseSync,
  input: DuplicateContentInput,
): SimulationVersion {
  const concept = sourceConcept(database, input.source.activeConceptSpecId)
  const candidate = sourceCandidate(database, input.source.activeGeneratedArtifactId)
  if (candidate !== null && concept === null)
    throw new TypeError('Candidate has no source concept.')
  const copiedBundle =
    candidate === null
      ? null
      : artifactBundleSchema.parse(JSON.parse(candidate.artifact_bundle_json) as unknown)
  const version = simulationVersionSchema.parse({
    id: input.destinationVersionId,
    simulationId: input.simulation.id,
    versionNumber: 1,
    state: 'draft',
    revision: 0,
    activeConceptSpecId: concept === null ? null : input.copiedRecordIds.conceptSpecId,
    activeGeneratedArtifactId:
      candidate === null ? null : input.copiedRecordIds.generatedArtifactId,
    activeArtifactBundle: copiedBundle,
    activeVerificationRunId: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
  database
    .prepare('INSERT INTO simulations(id,title,created_at,updated_at) VALUES (?,?,?,?)')
    .run(
      input.simulation.id,
      input.simulation.title,
      input.simulation.createdAt,
      input.simulation.updatedAt,
    )
  insertVersion(database, version)
  if (concept !== null) copyGenerationContent(database, input, concept, candidate)
  database
    .prepare(`UPDATE simulation_versions SET active_concept_spec_id=?,
    active_generated_artifact_id=?,active_artifact_bundle_json=? WHERE id=?`)
    .run(
      version.activeConceptSpecId,
      version.activeGeneratedArtifactId,
      version.activeArtifactBundle === null ? null : JSON.stringify(version.activeArtifactBundle),
      version.id,
    )
  database
    .prepare(`INSERT INTO version_lineage(destination_version_id,source_simulation_id,
      source_version_id,source_version_number,source_revision,kind,created_at)
      VALUES (?,?,?,?,?,'duplicate',?)`)
    .run(
      version.id,
      input.source.simulationId,
      input.source.id,
      input.source.versionNumber,
      input.source.revision,
      input.createdAt,
    )
  return version
}

interface ConceptRow {
  readonly schema_version: string
  readonly domain: string
  readonly artifact_id: string
  readonly artifact_hash: string
}

interface CandidateRow {
  readonly artifact_bundle_json: string
  readonly core_artifact_id: string
  readonly renderer_artifact_id: string
  readonly manifest_artifact_id: string
  readonly export_license_json: string
  readonly outcome: string
}

function sourceConcept(database: DatabaseSync, id: string | null): ConceptRow | null {
  if (id === null) return null
  const row = database.prepare('SELECT * FROM concept_specs WHERE id=?').get(id) as
    | ConceptRow
    | undefined
  if (row === undefined) throw new TypeError('Source concept is missing.')
  return row
}

function sourceCandidate(database: DatabaseSync, id: string | null): CandidateRow | null {
  if (id === null) return null
  const row = database
    .prepare(`SELECT g.*,a.outcome FROM generated_artifacts g
    JOIN generation_attempts a ON a.id=g.generation_attempt_id WHERE g.id=?`)
    .get(id) as CandidateRow | undefined
  if (row === undefined) throw new TypeError('Source candidate is missing.')
  return row
}

function copyGenerationContent(
  database: DatabaseSync,
  input: DuplicateContentInput,
  concept: ConceptRow,
  candidate: CandidateRow | null,
): void {
  database
    .prepare(`INSERT INTO generation_runs(
    id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
  ) VALUES (?,?,?,1,NULL,?,?)`)
    .run(
      input.copiedRecordIds.generationRunId,
      input.destinationVersionId,
      'cancelled',
      input.createdAt,
      input.createdAt,
    )
  database
    .prepare(`INSERT INTO concept_specs(
    id,simulation_version_id,generation_run_id,schema_version,domain,artifact_id,artifact_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      input.copiedRecordIds.conceptSpecId,
      input.destinationVersionId,
      input.copiedRecordIds.generationRunId,
      concept.schema_version,
      concept.domain,
      concept.artifact_id,
      concept.artifact_hash,
      input.createdAt,
    )
  if (candidate === null) return
  database
    .prepare(`INSERT INTO generation_attempts(
    id,generation_run_id,attempt_number,outcome,generated_artifact_id,stable_error_id,created_at,completed_at
  ) VALUES (?,?,1,'running',NULL,NULL,?,NULL)`)
    .run(
      input.copiedRecordIds.generationAttemptId,
      input.copiedRecordIds.generationRunId,
      input.createdAt,
    )
  database
    .prepare(`INSERT INTO generated_artifacts(
    id,generation_attempt_id,artifact_bundle_json,core_artifact_id,renderer_artifact_id,
    manifest_artifact_id,export_license_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      input.copiedRecordIds.generatedArtifactId,
      input.copiedRecordIds.generationAttemptId,
      candidate.artifact_bundle_json,
      candidate.core_artifact_id,
      candidate.renderer_artifact_id,
      candidate.manifest_artifact_id,
      candidate.export_license_json,
      input.createdAt,
    )
  database
    .prepare(`UPDATE generation_attempts SET outcome=?,generated_artifact_id=?,completed_at=?
    WHERE id=?`)
    .run(
      'cancelled',
      input.copiedRecordIds.generatedArtifactId,
      input.createdAt,
      input.copiedRecordIds.generationAttemptId,
    )
}

function insertVersion(database: DatabaseSync, version: SimulationVersion): void {
  database
    .prepare(`INSERT INTO simulation_versions(
    id,simulation_id,version_number,state,revision,active_concept_spec_id,
    active_generated_artifact_id,active_artifact_bundle_json,active_verification_run_id,
    created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      version.id,
      version.simulationId,
      version.versionNumber,
      version.state,
      version.revision,
      null,
      null,
      null,
      null,
      version.createdAt,
      version.updatedAt,
    )
}
