import type { DatabaseSync } from 'node:sqlite'
import {
  cancelPendingConceptReview,
  validPendingConceptReview,
} from './concept-review-repository.js'
import { hasReverificationMarker, isReverificationRun } from './generation-reverification.js'
import {
  latestScientificEvidence,
  validateScientificTransition,
} from './generation-scientific-evidence.js'
import { completeLegacyGenerationRun } from './generation-terminal.js'
import type {
  GenerationPipelineState,
  GenerationTerminalClassification,
} from './generation-types.js'
import { validTimestamp } from './generation-validation.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INTERRUPTED = 'orchestration.interrupted'
const INVALID_STATE = 'invalid-state'

interface ActiveRunRow {
  readonly id: string
  readonly simulation_version_id: string
  readonly state: GenerationPipelineState
  readonly revision: number
  readonly version_state: string
}

export interface RecoveredGenerationTransition {
  readonly runId: string
  readonly simulationVersionId: string
  readonly from: GenerationPipelineState
  readonly to: GenerationPipelineState
}

export function recoverInterruptedRuns(options: {
  readonly database: DatabaseSync
  readonly canWrite: () => boolean
  readonly at: string
}): Result<{
  readonly runIds: readonly string[]
  readonly transitions: readonly RecoveredGenerationTransition[]
}> {
  if (!options.canWrite()) return err('conflict', 'Persistence maintenance is active.')
  if (!validTimestamp(options.at)) return err('invalid-input', 'Recovery timestamp is invalid.')
  return transaction(options.database, () => {
    const active = options.database
      .prepare(`SELECT p.id,p.simulation_version_id,p.state,p.revision,v.state AS version_state
        FROM generation_pipeline_runs p JOIN simulation_versions v ON v.id=p.simulation_version_id
        WHERE p.completed_at IS NULL ORDER BY p.created_at,p.id`)
      .all() as unknown as ActiveRunRow[]
    const transitions: RecoveredGenerationTransition[] = []
    try {
      for (const run of active) {
        const recovered = recoverActiveAggregate(options.database, run, options.at)
        if (!recovered.ok) return recovered
        if (recovered.value !== undefined) transitions.push(recovered.value)
      }
      return ok({ runIds: active.map(({ id }) => id), transitions })
    } catch (error) {
      return sqliteFailure(error)
    }
  })
}

function recoverActiveAggregate(
  database: DatabaseSync,
  run: ActiveRunRow,
  at: string,
): Result<RecoveredGenerationTransition | undefined> {
  if (validPendingConceptReview(database, run.id)) return ok(undefined)
  if (run.version_state === 'verified' || run.version_state === 'rejected') {
    return recoverScientificSettlement(database, run, at)
  }
  if (!['draft', 'generating', 'verifying'].includes(run.version_state)) {
    return err(INVALID_STATE, 'An active generation aggregate has an unsupported version state.')
  }
  cancelPendingConceptReview(database, run.id, at)
  closePendingAttempts(database, run.id, at)
  const version = resetVersion(database, run, at)
  if (!version.ok) return version
  const terminal = terminalizePipeline(database, run, {
    state: 'invariant_failed',
    classification: 'invariant_failure',
    stableErrorId: INTERRUPTED,
    findingsReference: null,
    at,
  })
  return terminal.ok ? ok(recoveredTransition(run, 'invariant_failed')) : terminal
}

function recoverScientificSettlement(
  database: DatabaseSync,
  run: ActiveRunRow,
  at: string,
): Result<RecoveredGenerationTransition> {
  if (run.version_state !== 'verified' && run.version_state !== 'rejected') {
    return err(INVALID_STATE, 'Scientific recovery requires a terminal version state.')
  }
  if (run.state !== 'verifying') {
    return err(INVALID_STATE, 'A half-settled scientific run is not awaiting verification.')
  }
  const settled = validateScientificTransition(database, run.id, run.version_state)
  if (!settled.ok) return settled
  const evidence = latestScientificEvidence(database, run.id)
  if (evidence === null || evidence.outcome !== run.version_state) {
    return err(INVALID_STATE, 'Half-settled scientific state lacks matching attempt evidence.')
  }
  if (run.version_state === 'rejected' && evidence.findingsReference === null) {
    return err(INVALID_STATE, 'Scientific rejection recovery requires retained findings.')
  }
  const terminal = terminalizePipeline(database, run, {
    state: run.version_state,
    classification: run.version_state === 'verified' ? 'verified' : 'scientific_rejection',
    stableErrorId: null,
    findingsReference: evidence.findingsReference,
    at,
  })
  return terminal.ok ? ok(recoveredTransition(run, run.version_state)) : terminal
}

function recoveredTransition(
  run: ActiveRunRow,
  to: GenerationPipelineState,
): RecoveredGenerationTransition {
  return {
    runId: run.id,
    simulationVersionId: run.simulation_version_id,
    from: run.state,
    to,
  }
}

function closePendingAttempts(database: DatabaseSync, runId: string, at: string): void {
  database
    .prepare(`UPDATE generation_pipeline_attempts
      SET outcome='invariant_failed',stable_error_id=?,completed_at=?
      WHERE run_id=? AND outcome='pending'`)
    .run(INTERRUPTED, at, runId)
  database
    .prepare(`UPDATE generation_attempts SET outcome='invalid-output',stable_error_id=?,completed_at=?
      WHERE generation_run_id=? AND outcome IN ('pending','running')`)
    .run(INTERRUPTED, at, runId)
}

function resetVersion(database: DatabaseSync, run: ActiveRunRow, at: string): Result<true> {
  if (run.version_state === 'draft') return ok(true)
  if (isReverificationRun(database, run.id)) {
    if (run.version_state === 'stale') return ok(true)
    if (run.version_state !== 'verifying') {
      return err(INVALID_STATE, 'Interrupted reverification has an unsupported version state.')
    }
    const changed = database
      .prepare(`UPDATE simulation_versions SET state='stale',revision=revision+1,updated_at=?
        WHERE id=? AND state='verifying'`)
      .run(at, run.simulation_version_id)
    return Number(changed.changes) === 1
      ? ok(true)
      : err('conflict', 'Interrupted reverification version changed during recovery.')
  }
  if (hasReverificationMarker(database, run.id)) {
    return err(INVALID_STATE, 'Malformed reverification identity cannot be recovered.')
  }
  const changed = database
    .prepare(`UPDATE simulation_versions SET state='draft',revision=revision+1,
      active_concept_spec_id=NULL,active_generated_artifact_id=NULL,
      active_artifact_bundle_json=NULL,active_verification_run_id=NULL,updated_at=?
      WHERE id=? AND state=?`)
    .run(at, run.simulation_version_id, run.version_state)
  return Number(changed.changes) === 1
    ? ok(true)
    : err('conflict', 'Interrupted simulation version changed during recovery.')
}

function terminalizePipeline(
  database: DatabaseSync,
  run: ActiveRunRow,
  terminal: {
    readonly state: GenerationPipelineState
    readonly classification: GenerationTerminalClassification
    readonly stableErrorId: string | null
    readonly findingsReference: string | null
    readonly at: string
  },
): Result<true> {
  const changed = database
    .prepare(`UPDATE generation_pipeline_runs SET state=?,revision=revision+1,
      terminal_classification=?,stable_error_id=?,findings_reference=?,updated_at=?,completed_at=?
      WHERE id=? AND completed_at IS NULL`)
    .run(
      terminal.state,
      terminal.classification,
      terminal.stableErrorId,
      terminal.findingsReference,
      terminal.at,
      terminal.at,
      run.id,
    )
  if (Number(changed.changes) !== 1) {
    return err('conflict', 'Interrupted generation run changed during recovery.')
  }
  database
    .prepare(`INSERT INTO generation_pipeline_transitions(
      run_id,sequence,from_state,to_state,transitioned_at
    ) VALUES (?,?,?,?,?)`)
    .run(run.id, run.revision + 1, run.state, terminal.state, terminal.at)
  return completeLegacyGenerationRun(database, run.id, terminal.state, terminal.at)
}
