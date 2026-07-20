import {
  artifactBundleSchema,
  type SimulationLifecycleState,
  type SimulationVersion,
  simulationVersionSchema,
} from '@simproof/contracts'

import { err, ok, type Result } from './types.js'

export interface VersionRow {
  id: string
  simulation_id: string
  version_number: number
  state: SimulationLifecycleState
  revision: number
  active_concept_spec_id: string | null
  active_generated_artifact_id: string | null
  active_artifact_bundle_json: string | null
  active_verification_run_id: string | null
  created_at: string
  updated_at: string
}

export function decodeVersion(row: VersionRow): Result<SimulationVersion> {
  let decoded: unknown
  try {
    decoded =
      row.active_artifact_bundle_json === null ? null : JSON.parse(row.active_artifact_bundle_json)
  } catch {
    return err('database-error', 'Stored simulation artifact bundle is malformed.')
  }
  const bundle = decoded === null ? null : artifactBundleSchema.safeParse(decoded)
  if (bundle !== null && !bundle.success) {
    return err('database-error', 'Stored simulation artifact bundle is invalid.')
  }
  const parsed = simulationVersionSchema.safeParse({
    id: row.id,
    simulationId: row.simulation_id,
    versionNumber: row.version_number,
    state: row.state,
    revision: row.revision,
    activeConceptSpecId: row.active_concept_spec_id,
    activeGeneratedArtifactId: row.active_generated_artifact_id,
    activeArtifactBundle: bundle === null ? null : bundle.data,
    activeVerificationRunId: row.active_verification_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  return parsed.success
    ? ok(parsed.data)
    : err('database-error', 'Stored simulation version is invalid.')
}
