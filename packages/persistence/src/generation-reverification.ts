import type { DatabaseSync } from 'node:sqlite'

import type { SimulationVersion } from '@simproof/contracts'

import type { BeginReverificationInput, GenerationPipelineRun } from './generation-types.js'
import { hashIdempotencyKey, validId, validTimestamp } from './generation-validation.js'
import {
  isExactReverificationAttempt,
  REVERIFICATION_MODEL,
  REVERIFICATION_PROVIDER,
  REVERIFICATION_TEMPLATE,
} from './reverification-identity.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

export { REVERIFICATION_PROVIDER } from './reverification-identity.js'

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

interface ReverificationDependencies {
  readonly database: DatabaseSync
  readonly canWrite: () => boolean
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly getRun: (id: string) => Result<GenerationPipelineRun>
  readonly findByHash: (hash: string) => Result<GenerationPipelineRun | null>
}

export function beginOrReplayReverification(
  dependencies: ReverificationDependencies,
  input: BeginReverificationInput,
): Result<{
  readonly created: boolean
  readonly version: SimulationVersion
  readonly run: GenerationPipelineRun
}> {
  if (!dependencies.canWrite()) return err('conflict', 'Persistence maintenance is active.')
  if (!validBegin(input)) return err('invalid-input', 'Reverification input is invalid.')
  return transaction<{
    readonly created: boolean
    readonly version: SimulationVersion
    readonly run: GenerationPipelineRun
  }>(dependencies.database, () => {
    const hash = hashIdempotencyKey(input.idempotencyKey)
    const replay = dependencies.findByHash(hash)
    if (!replay.ok) return replay
    if (replay.value !== null) return replayResult(dependencies, replay.value, input.versionId)
    const version = dependencies.getVersion(input.versionId)
    if (!version.ok) return version
    if (version.value.revision !== input.expectedRevision) {
      return err('conflict', 'Simulation version revision changed concurrently.')
    }
    if (!validSource(dependencies.database, version.value)) {
      return err(
        'invalid-state',
        'Only a stale version with complete immutable evidence can be reverified.',
      )
    }
    try {
      insertRun(dependencies.database, input, hash)
      insertAttempt(dependencies.database, input)
      const changed = dependencies.database
        .prepare(`UPDATE simulation_versions SET state='verifying',revision=revision+1,updated_at=?
          WHERE id=? AND revision=? AND state='stale'`)
        .run(input.at, input.versionId, input.expectedRevision)
      if (Number(changed.changes) !== 1) {
        return err('conflict', 'Simulation version revision changed concurrently.')
      }
      const run = dependencies.getRun(input.runId)
      const updated = dependencies.getVersion(input.versionId)
      if (!run.ok) return run
      return updated.ok ? ok({ created: true, version: updated.value, run: run.value }) : updated
    } catch (error) {
      return sqliteFailure(error)
    }
  })
}

export function isReverificationRun(database: DatabaseSync, runId: string): boolean {
  const row = database
    .prepare(`SELECT p.id,a.generated_artifact_id FROM generation_pipeline_attempts p
      JOIN generation_attempts a ON a.id=p.id WHERE p.run_id=?`)
    .get(runId) as { id: string; generated_artifact_id: string | null } | undefined
  if (row?.generated_artifact_id === null || row?.generated_artifact_id === undefined) return false
  return isExactReverificationAttempt(database, {
    runId,
    attemptId: row.id,
    generatedArtifactId: row.generated_artifact_id,
  })
}

export function hasReverificationMarker(database: DatabaseSync, runId: string): boolean {
  return (
    database
      .prepare('SELECT 1 FROM generation_pipeline_attempts WHERE run_id=? AND provider=?')
      .get(runId, REVERIFICATION_PROVIDER) !== undefined
  )
}

function replayResult(
  dependencies: ReverificationDependencies,
  run: GenerationPipelineRun,
  versionId: string,
): Result<{
  readonly created: false
  readonly version: SimulationVersion
  readonly run: GenerationPipelineRun
}> {
  if (
    run.simulationVersionId !== versionId ||
    !isReverificationRun(dependencies.database, run.id)
  ) {
    return err('conflict', 'Idempotency key belongs to another operation.')
  }
  const version = dependencies.getVersion(versionId)
  return version.ok ? ok({ created: false, version: version.value, run }) : version
}

function validBegin(input: BeginReverificationInput): boolean {
  return (
    validId(input.versionId) &&
    validId(input.runId) &&
    validId(input.attemptId) &&
    Number.isSafeInteger(input.expectedRevision) &&
    input.expectedRevision >= 0 &&
    input.idempotencyKey.length >= 8 &&
    input.idempotencyKey.length <= 200 &&
    KEY_PATTERN.test(input.idempotencyKey) &&
    validTimestamp(input.at)
  )
}

function validSource(database: DatabaseSync, version: SimulationVersion): boolean {
  if (
    version.state !== 'stale' ||
    version.activeConceptSpecId === null ||
    version.activeGeneratedArtifactId === null ||
    version.activeArtifactBundle === null ||
    version.activeVerificationRunId === null
  ) {
    return false
  }
  const row = database
    .prepare(`SELECT 1 FROM concept_specs c
      JOIN generated_artifacts g ON g.id=?
      JOIN generation_attempts a ON a.id=g.generation_attempt_id
      JOIN generation_runs r ON r.id=a.generation_run_id
      JOIN verification_runs v ON v.id=?
      WHERE c.id=? AND c.simulation_version_id=? AND r.simulation_version_id=?
        AND c.generation_run_id=r.id AND g.artifact_bundle_json=?
        AND v.simulation_version_id=? AND v.concept_spec_id=c.id
        AND v.generated_artifact_id=g.id`)
    .get(
      version.activeGeneratedArtifactId,
      version.activeVerificationRunId,
      version.activeConceptSpecId,
      version.id,
      version.id,
      JSON.stringify(version.activeArtifactBundle),
      version.id,
    )
  return row !== undefined
}

function insertRun(database: DatabaseSync, input: BeginReverificationInput, hash: string): void {
  database
    .prepare(`INSERT INTO generation_runs(
      id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
    ) VALUES (?,?,'running',1,NULL,?,NULL)`)
    .run(input.runId, input.versionId, input.at)
  database
    .prepare(`INSERT INTO generation_pipeline_runs(
      id,simulation_version_id,idempotency_key_hash,state,revision,max_attempts,
      max_provider_requests,max_input_tokens,max_output_tokens,max_cost_microusd,max_artifact_bytes,
      used_provider_requests,used_input_tokens,used_output_tokens,used_cost_microusd,used_artifact_bytes,
      created_at,updated_at
    ) VALUES (?,?,?,'executing',0,1,1,1,1,1,1,0,0,0,0,0,?,?)`)
    .run(input.runId, input.versionId, hash, input.at, input.at)
  database
    .prepare(`INSERT INTO generation_pipeline_transitions(
      run_id,sequence,from_state,to_state,transitioned_at
    ) VALUES (?,0,NULL,'executing',?)`)
    .run(input.runId, input.at)
}

function insertAttempt(database: DatabaseSync, input: BeginReverificationInput): void {
  const source = database
    .prepare('SELECT active_generated_artifact_id FROM simulation_versions WHERE id=?')
    .get(input.versionId) as { active_generated_artifact_id: string }
  database
    .prepare(`INSERT INTO generation_attempts(
      id,generation_run_id,attempt_number,outcome,generated_artifact_id,created_at
    ) VALUES (?,?,1,'pending',?,?)`)
    .run(input.attemptId, input.runId, source.active_generated_artifact_id, input.at)
  database
    .prepare(`INSERT INTO generation_pipeline_attempts(
      id,run_id,attempt_number,outcome,provider,model_id,template_version,created_at
    ) VALUES (?,?,1,'pending',?,?,?,?)`)
    .run(
      input.attemptId,
      input.runId,
      REVERIFICATION_PROVIDER,
      REVERIFICATION_MODEL,
      REVERIFICATION_TEMPLATE,
      input.at,
    )
}
