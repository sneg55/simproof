import type { DatabaseSync } from 'node:sqlite'

import { duplicateVersionLineageRecordSchema } from '@simproof/contracts'

import { validPendingConceptReview } from './concept-review-repository.js'
import { parseConceptReview } from './concept-review-validation.js'
import { validTimestamp } from './generation-validation.js'

const SHA256 = /^sha256:[0-9a-f]{64}$/u

// eslint-disable-next-line complexity -- Fail-closed validation checks every persisted metadata field before a backup or restore is accepted.
export function validateEducatorRecords(database: DatabaseSync): void {
  validateDuplicateLineages(database)
  for (const row of database.prepare('SELECT * FROM bundled_examples').all()) {
    if (
      typeof row.example_id !== 'string' ||
      row.example_id.length < 1 ||
      row.example_id.length > 100 ||
      typeof row.example_version !== 'string' ||
      row.example_version.length < 1 ||
      row.example_version.length > 100 ||
      typeof row.catalog_hash !== 'string' ||
      !SHA256.test(row.catalog_hash) ||
      !['projectile', 'pendulum'].includes(String(row.domain)) ||
      row.license_id !== 'CC-BY-4.0' ||
      typeof row.attribution !== 'string' ||
      row.attribution.length < 1 ||
      row.attribution.length > 500 ||
      !validTimestamp(row.installed_at)
    ) {
      throw new TypeError('Stored bundled example metadata is invalid.')
    }
  }
  for (const row of database.prepare('SELECT * FROM generation_concept_reviews').all()) {
    const review = parseConceptReview({
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
    if (
      review === null ||
      Date.parse(review.updatedAt) < Date.parse(review.createdAt) ||
      (review.resolvedAt !== null && Date.parse(review.resolvedAt) < Date.parse(review.createdAt))
    ) {
      throw new TypeError('Stored concept review is invalid.')
    }
    if (review.status === 'pending' && !validPendingConceptReview(database, review.runId)) {
      throw new TypeError('Pending concept review is structurally invalid.')
    }
    const owned = database
      .prepare(`SELECT 1 FROM concept_specs c JOIN stored_artifacts a ON a.id=c.artifact_id
        WHERE c.id=? AND c.simulation_version_id=? AND c.generation_run_id=?
          AND c.artifact_hash=? AND a.role='concept-spec' AND a.content_hash=c.artifact_hash`)
      .get(review.conceptSpecId, review.simulationVersionId, review.runId, review.conceptHash)
    if (owned === undefined) throw new TypeError('Concept review ownership is invalid.')
  }
}

function validateDuplicateLineages(database: DatabaseSync): void {
  for (const row of database.prepare('SELECT * FROM version_lineage').all()) {
    const lineage = duplicateVersionLineageRecordSchema.safeParse({
      id: row.destination_version_id,
      kind: row.kind,
      sourceSimulationId: row.source_simulation_id,
      sourceVersionId: row.source_version_id,
      sourceVersionNumber: row.source_version_number,
      sourceRevision: row.source_revision,
      duplicatedAt: row.created_at,
    })
    if (!lineage.success) throw new TypeError('Stored duplicate lineage is invalid.')
    const destination = database
      .prepare('SELECT simulation_id,version_number,created_at FROM simulation_versions WHERE id=?')
      .get(lineage.data.id) as
      | { simulation_id: string; version_number: number; created_at: string }
      | undefined
    if (
      destination === undefined ||
      destination.simulation_id === lineage.data.sourceSimulationId ||
      destination.version_number !== 1 ||
      destination.created_at !== lineage.data.duplicatedAt
    ) {
      throw new TypeError('Stored duplicate lineage is invalid.')
    }
    const source = database
      .prepare(
        'SELECT simulation_id,version_number,revision,created_at FROM simulation_versions WHERE id=?',
      )
      .get(lineage.data.sourceVersionId) as
      | { simulation_id: string; version_number: number; revision: number; created_at: string }
      | undefined
    if (
      source !== undefined &&
      (source.simulation_id !== lineage.data.sourceSimulationId ||
        source.version_number !== lineage.data.sourceVersionNumber ||
        source.revision < lineage.data.sourceRevision ||
        Date.parse(source.created_at) > Date.parse(lineage.data.duplicatedAt))
    ) {
      throw new TypeError('Stored duplicate lineage is invalid.')
    }
  }
}
