import type { DatabaseSync } from 'node:sqlite'

import type { SimulationVersion } from '@simproof/contracts'

import type { ConceptReview, ConceptReviewSnapshot } from './concept-review-types.js'
import { parseConceptReview, validConceptHash } from './concept-review-validation.js'
import type { GenerationPipelineRun } from './generation-types.js'
import { validId, validTimestamp } from './generation-validation.js'
import { sqliteFailure } from './sqlite.js'
import { err, ok, type Result } from './types.js'

interface ReviewRow {
  id: string
  run_id: string
  simulation_version_id: string
  concept_spec_id: string
  concept_hash: string
  status: ConceptReview['status']
  revision: number
  created_at: string
  updated_at: string
  resolved_at: string | null
}

const INVALID_INPUT = 'invalid-input'

export class ConceptReviewRepository {
  constructor(
    readonly database: DatabaseSync,
    readonly canWrite: () => boolean,
    readonly getRun: (id: string) => Result<GenerationPipelineRun>,
    readonly getVersion: (id: string) => Result<SimulationVersion>,
  ) {}

  create(input: unknown): Result<ConceptReview> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    const review = parseConceptReview(input)
    if (review === null || review.status !== 'pending' || review.revision !== 0) {
      return err(INVALID_INPUT, 'Concept review checkpoint is invalid.')
    }
    const owned = this.database
      .prepare(`SELECT 1 FROM concept_specs c
        JOIN stored_artifacts a ON a.id=c.artifact_id
        JOIN generation_pipeline_runs p ON p.id=c.generation_run_id
        JOIN simulation_versions v ON v.id=c.simulation_version_id
        WHERE c.id=? AND c.simulation_version_id=? AND c.generation_run_id=?
          AND c.artifact_hash=? AND a.role='concept-spec' AND a.content_hash=c.artifact_hash
          AND p.simulation_version_id=c.simulation_version_id AND p.state='compiling'
          AND p.completed_at IS NULL AND v.state='generating'
          AND NOT EXISTS(SELECT 1 FROM generation_pipeline_attempts x WHERE x.run_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM generation_provider_reservations r WHERE r.run_id=p.id AND r.status='pending')`)
      .get(review.conceptSpecId, review.simulationVersionId, review.runId, review.conceptHash)
    if (owned === undefined) return err(INVALID_INPUT, 'Concept review ownership is invalid.')
    try {
      this.database
        .prepare(`INSERT INTO generation_concept_reviews(
          id,run_id,simulation_version_id,concept_spec_id,concept_hash,status,revision,
          created_at,updated_at,resolved_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(
          review.id,
          review.runId,
          review.simulationVersionId,
          review.conceptSpecId,
          review.conceptHash,
          review.status,
          review.revision,
          review.createdAt,
          review.updatedAt,
          review.resolvedAt,
        )
      return ok(review)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  get(id: string): Result<ConceptReview> {
    if (!validId(id)) return err(INVALID_INPUT, 'Concept review ID is invalid.')
    return decode(
      this.database.prepare('SELECT * FROM generation_concept_reviews WHERE id=?').get(id) as
        | ReviewRow
        | undefined,
    )
  }

  forRun(runId: string): Result<ConceptReview> {
    if (!validId(runId)) return err(INVALID_INPUT, 'Generation run ID is invalid.')
    return decode(
      this.database.prepare('SELECT * FROM generation_concept_reviews WHERE run_id=?').get(runId) as
        | ReviewRow
        | undefined,
    )
  }

  snapshot(runId: string): Result<ConceptReviewSnapshot> {
    const review = this.forRun(runId)
    if (!review.ok) return review
    const run = this.getRun(runId)
    if (!run.ok) return run
    const version = this.getVersion(review.value.simulationVersionId)
    if (!version.ok) return version
    if (run.value.simulationVersionId !== version.value.id) {
      return err('database-error', 'Concept review snapshot crosses simulation versions.')
    }
    return ok({ review: review.value, run: run.value, version: version.value })
  }

  confirm(input: {
    readonly id: string
    readonly expectedRevision: number
    readonly expectedConceptHash: string
    readonly resolvedAt: string
  }): Result<ConceptReview> {
    if (!validConceptHash(input.expectedConceptHash))
      return err(INVALID_INPUT, 'Concept hash is invalid.')
    return this.resolve({
      id: input.id,
      expectedRevision: input.expectedRevision,
      resolvedAt: input.resolvedAt,
      status: 'confirmed',
      expectedHash: input.expectedConceptHash,
    })
  }

  cancel(input: {
    readonly id: string
    readonly expectedRevision: number
    readonly resolvedAt: string
  }): Result<ConceptReview> {
    return this.resolve({ ...input, status: 'cancelled', expectedHash: null })
  }

  private resolve(input: {
    readonly id: string
    readonly expectedRevision: number
    readonly resolvedAt: string
    readonly status: 'confirmed' | 'cancelled'
    readonly expectedHash: string | null
  }): Result<ConceptReview> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (
      !validId(input.id) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !validTimestamp(input.resolvedAt)
    )
      return err(INVALID_INPUT, 'Concept review resolution is invalid.')
    try {
      const hashClause = input.expectedHash === null ? '' : ' AND concept_hash=?'
      const parameters =
        input.expectedHash === null
          ? [input.status, input.resolvedAt, input.resolvedAt, input.id, input.expectedRevision]
          : [
              input.status,
              input.resolvedAt,
              input.resolvedAt,
              input.id,
              input.expectedRevision,
              input.expectedHash,
            ]
      const changed = this.database
        .prepare(`UPDATE generation_concept_reviews SET status=?,revision=revision+1,updated_at=?,resolved_at=?
          WHERE id=? AND status='pending' AND revision=?${hashClause}`)
        .run(...parameters)
      return Number(changed.changes) === 1
        ? this.get(input.id)
        : err('conflict', 'Concept review changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }
}

export function validPendingConceptReview(database: DatabaseSync, runId: string): boolean {
  const row = database
    .prepare(`SELECT 1 FROM generation_concept_reviews r
    JOIN generation_pipeline_runs p ON p.id=r.run_id
    JOIN simulation_versions v ON v.id=r.simulation_version_id
    JOIN concept_specs c ON c.id=r.concept_spec_id
    JOIN stored_artifacts a ON a.id=c.artifact_id
    WHERE r.run_id=? AND r.status='pending' AND r.resolved_at IS NULL
      AND p.state='compiling' AND p.completed_at IS NULL AND p.simulation_version_id=r.simulation_version_id
      AND v.state='generating' AND c.simulation_version_id=r.simulation_version_id
      AND c.generation_run_id=r.run_id AND c.artifact_hash=r.concept_hash
      AND a.role='concept-spec' AND a.content_hash=r.concept_hash
      AND NOT EXISTS(SELECT 1 FROM generation_pipeline_attempts x WHERE x.run_id=r.run_id)
      AND NOT EXISTS(SELECT 1 FROM generation_provider_reservations x WHERE x.run_id=r.run_id AND x.status='pending')`)
    .get(runId)
  return row !== undefined
}

export function cancelPendingConceptReview(
  database: DatabaseSync,
  runId: string,
  at: string,
): void {
  database
    .prepare(`UPDATE generation_concept_reviews SET status='cancelled',revision=revision+1,
    updated_at=?,resolved_at=? WHERE run_id=? AND status='pending'`)
    .run(at, at, runId)
}

function decode(row: ReviewRow | undefined): Result<ConceptReview> {
  if (row === undefined) return err('not-found', 'Concept review was not found.')
  const parsed = parseConceptReview({
    id: row.id,
    runId: row.run_id,
    simulationVersionId: row.simulation_version_id,
    conceptSpecId: row.concept_spec_id,
    conceptHash: row.concept_hash,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  })
  return parsed === null ? err('database-error', 'Stored concept review is invalid.') : ok(parsed)
}
