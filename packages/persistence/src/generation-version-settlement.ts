import type { DatabaseSync } from 'node:sqlite'
import { hasReverificationMarker, isReverificationRun } from './generation-reverification.js'
import type { GenerationPipelineRun, GenerationPipelineState } from './generation-types.js'
import { err, ok, type Result } from './types.js'

export function settleOperationalVersion(
  database: DatabaseSync,
  run: GenerationPipelineRun,
  terminalState: GenerationPipelineState,
  at: string,
): Result<true> {
  if (terminalState === 'verified' || terminalState === 'rejected') return ok(true)
  const version = database
    .prepare('SELECT state FROM simulation_versions WHERE id=?')
    .get(run.simulationVersionId) as { state: string } | undefined
  if (version === undefined) return err('not-found', 'Simulation version was not found.')
  if (isReverificationRun(database, run.id)) {
    if (version.state === 'stale') return ok(true)
    if (version.state !== 'verifying') {
      return err('invalid-state', 'Operational reverification terminal cannot settle this version.')
    }
    const changed = database
      .prepare(`UPDATE simulation_versions SET state='stale',revision=revision+1,updated_at=?
        WHERE id=? AND state='verifying'`)
      .run(at, run.simulationVersionId)
    return Number(changed.changes) === 1
      ? ok(true)
      : err('conflict', 'Simulation version changed during reverification settlement.')
  }
  if (hasReverificationMarker(database, run.id)) {
    return err('invalid-state', 'Malformed reverification identity cannot settle a version.')
  }
  if (version.state === 'draft') return ok(true)
  if (version.state !== 'generating' && version.state !== 'verifying') {
    return err('invalid-state', 'Operational terminal cannot settle this simulation version.')
  }
  const changed = database
    .prepare(`UPDATE simulation_versions SET state='draft',revision=revision+1,
      active_concept_spec_id=NULL,active_generated_artifact_id=NULL,
      active_artifact_bundle_json=NULL,active_verification_run_id=NULL,updated_at=?
      WHERE id=? AND state=?`)
    .run(at, run.simulationVersionId, version.state)
  return Number(changed.changes) === 1
    ? ok(true)
    : err('conflict', 'Simulation version changed during terminal settlement.')
}
