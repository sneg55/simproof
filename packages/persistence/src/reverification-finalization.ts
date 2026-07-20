import type { DatabaseSync } from 'node:sqlite'

import type { SimulationVersion } from '@simproof/contracts'
import { completeLegacyGenerationRun } from './generation-terminal.js'
import type { GenerationPipelineRun } from './generation-types.js'
import { validId, validOpaque, validTimestamp } from './generation-validation.js'
import { isExactReverificationEvidence } from './reverification-identity.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

export interface FinalizeReverificationInput {
  readonly versionId: string
  readonly expectedVersionRevision: number
  readonly runId: string
  readonly expectedRunRevision: number
  readonly attemptId: string
  readonly verificationRunId: string
  readonly artifactHash: string
  readonly findingsReference: string
  readonly outcome: 'verified' | 'rejected'
  readonly at: string
}

export function finalizeReverificationAggregate(options: {
  readonly database: DatabaseSync
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly getRun: (id: string) => Result<GenerationPipelineRun>
  readonly input: FinalizeReverificationInput
}): Result<{ readonly version: SimulationVersion; readonly run: GenerationPipelineRun }> {
  if (!validInput(options.input))
    return err('invalid-input', 'Reverification finalization is invalid.')
  return transaction(options.database, () => finalizeTransaction(options))
}

function finalizeTransaction(options: {
  readonly database: DatabaseSync
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly getRun: (id: string) => Result<GenerationPipelineRun>
  readonly input: FinalizeReverificationInput
}): Result<{ readonly version: SimulationVersion; readonly run: GenerationPipelineRun }> {
  const { database, input } = options
  const version = options.getVersion(input.versionId)
  const run = options.getRun(input.runId)
  if (!version.ok) return version
  if (!run.ok) return run
  if (!aggregateMatches(version.value, run.value, input)) {
    return err('conflict', 'Reverification aggregate changed concurrently.')
  }
  if (!exactEvidence(database, version.value, input)) {
    return err('invalid-state', 'Reverification evidence differs from the bound version snapshot.')
  }
  const changed = applyFinalization(database, input)
  if (!changed.ok) return changed
  const nextVersion = options.getVersion(input.versionId)
  const nextRun = options.getRun(input.runId)
  if (!nextVersion.ok) return nextVersion
  return nextRun.ok ? ok({ version: nextVersion.value, run: nextRun.value }) : nextRun
}

function exactEvidence(
  database: DatabaseSync,
  version: SimulationVersion,
  input: FinalizeReverificationInput,
): boolean {
  return isExactReverificationEvidence(database, {
    runId: input.runId,
    attemptId: input.attemptId,
    generatedArtifactId: version.activeGeneratedArtifactId ?? '',
    verificationRunId: input.verificationRunId,
    artifactHash: input.artifactHash,
    findingsReference: input.findingsReference,
    outcome: input.outcome,
    requireUnselectedReport: true,
  })
}

function applyFinalization(
  database: DatabaseSync,
  input: FinalizeReverificationInput,
): Result<true> {
  try {
    const pipelineAttempt = database
      .prepare(`UPDATE generation_pipeline_attempts SET outcome=?,artifact_hash=?,
        verification_run_id=?,findings_reference=?,completed_at=?
        WHERE id=? AND run_id=? AND outcome='pending'`)
      .run(
        input.outcome,
        input.artifactHash,
        input.verificationRunId,
        input.findingsReference,
        input.at,
        input.attemptId,
        input.runId,
      )
    const legacyAttempt = database
      .prepare(`UPDATE generation_attempts SET outcome=?,completed_at=?
        WHERE id=? AND generation_run_id=? AND outcome IN ('pending','running')`)
      .run(input.outcome, input.at, input.attemptId, input.runId)
    if (Number(pipelineAttempt.changes) !== 1 || Number(legacyAttempt.changes) !== 1) {
      return err('conflict', 'Reverification attempt changed concurrently.')
    }
    const versionChanged = database
      .prepare(`UPDATE simulation_versions SET state=?,active_verification_run_id=?,
        revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state='verifying'`)
      .run(
        input.outcome,
        input.verificationRunId,
        input.at,
        input.versionId,
        input.expectedVersionRevision,
      )
    if (Number(versionChanged.changes) !== 1) {
      return err('conflict', 'Reverification version changed concurrently.')
    }
    const runChanged = database
      .prepare(`UPDATE generation_pipeline_runs SET state=?,revision=revision+1,
        terminal_classification=?,findings_reference=?,updated_at=?,completed_at=?
        WHERE id=? AND revision=? AND state='verifying' AND completed_at IS NULL`)
      .run(
        input.outcome,
        input.outcome === 'verified' ? 'verified' : 'scientific_rejection',
        input.outcome === 'rejected' ? input.findingsReference : null,
        input.at,
        input.at,
        input.runId,
        input.expectedRunRevision,
      )
    if (Number(runChanged.changes) !== 1) {
      return err('conflict', 'Reverification run changed concurrently.')
    }
    database
      .prepare(`INSERT INTO generation_pipeline_transitions(
        run_id,sequence,from_state,to_state,transitioned_at
      ) VALUES (?,?,?,?,?)`)
      .run(input.runId, input.expectedRunRevision + 1, 'verifying', input.outcome, input.at)
    const legacy = completeLegacyGenerationRun(database, input.runId, input.outcome, input.at)
    return legacy.ok ? ok(true) : legacy
  } catch (error) {
    return sqliteFailure(error)
  }
}

function aggregateMatches(
  version: SimulationVersion,
  run: GenerationPipelineRun,
  input: FinalizeReverificationInput,
): boolean {
  return (
    version.revision === input.expectedVersionRevision &&
    version.state === 'verifying' &&
    run.revision === input.expectedRunRevision &&
    run.state === 'verifying' &&
    run.simulationVersionId === version.id
  )
}

function validInput(input: FinalizeReverificationInput): boolean {
  return (
    [input.versionId, input.runId, input.attemptId, input.verificationRunId].every(validId) &&
    Number.isSafeInteger(input.expectedVersionRevision) &&
    input.expectedVersionRevision >= 0 &&
    Number.isSafeInteger(input.expectedRunRevision) &&
    input.expectedRunRevision >= 0 &&
    /^sha256:[0-9a-f]{64}$/u.test(input.artifactHash) &&
    validOpaque(input.findingsReference) &&
    validTimestamp(input.at)
  )
}
