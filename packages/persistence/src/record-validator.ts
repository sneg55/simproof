import type { DatabaseSync } from 'node:sqlite'

import {
  conceptSpecRecordSchema,
  conceptSpecSchema,
  generatedArtifactSchema,
  generationAttemptSchema,
  generationRunSchema,
  simulationSchema,
  simulationVersionSchema,
  storedArtifactSchema,
} from '@simproof/contracts'

import type { ArtifactStore } from './artifact-store.js'
import { validateAuthAndPrivacyRecords } from './auth-privacy-record-validator.js'
import { validateEducatorRecords } from './educator-record-validator.js'
import { isExactReverificationAttempt } from './reverification-identity.js'
import { err, ok, type Result } from './types.js'
import { validateVerificationRecords } from './verification-record-validator.js'

type Row = Record<string, unknown>
export type StoredObject = {
  metadata: ReturnType<typeof storedArtifactSchema.parse>
  content: Buffer
}

function json(value: unknown): unknown {
  return JSON.parse(String(value)) as unknown
}

function requiresSelectedVerification(state: string): boolean {
  return state === 'verified' || state === 'published' || state === 'rejected'
}

function selectedVerdictMatches(state: string, verdict: unknown): boolean {
  if (state === 'rejected') return verdict === 'rejected'
  if (state === 'verified' || state === 'published') return verdict === 'verified'
  return true
}

export class RecordValidator {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  async validate(store: ArtifactStore): Promise<Result<true>> {
    try {
      this.#validateSimulations()
      const artifactResult = await this.#validateArtifacts(store)
      if (!artifactResult.ok) return artifactResult
      const artifacts = artifactResult.value
      this.#validateVersions()
      this.#validateGenerationRecords()
      this.#validateConcepts(artifacts)
      this.#validateGeneratedArtifacts(artifacts)
      validateVerificationRecords(this.#database, artifacts)
      validateAuthAndPrivacyRecords(this.#database)
      validateEducatorRecords(this.#database)
      return ok(true)
    } catch {
      return err('database-error', 'Persisted records failed runtime schema validation.')
    }
  }

  #validateSimulations(): void {
    for (const row of this.#rows('SELECT * FROM simulations')) {
      simulationSchema.parse({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    }
  }

  async #validateArtifacts(store: ArtifactStore): Promise<Result<Map<string, StoredObject>>> {
    const artifacts = new Map<string, StoredObject>()
    for (const row of this.#rows('SELECT * FROM stored_artifacts')) {
      const artifact = storedArtifactSchema.parse({
        id: row.id,
        role: row.role,
        contentHash: row.content_hash,
        mediaType: row.media_type,
        byteLength: row.byte_length,
        normalizationVersion: row.normalization_version,
        createdAt: row.created_at,
      })
      const expectedMedia =
        artifact.role === 'core-source' || artifact.role === 'renderer-source'
          ? 'text/javascript'
          : 'application/json'
      if (artifact.normalizationVersion !== 1 || artifact.mediaType !== expectedMedia) {
        throw new TypeError('Stored artifact normalization metadata is unsupported.')
      }
      const content = await store.get(artifact.contentHash)
      if (!content.ok || content.value.byteLength !== artifact.byteLength) {
        return err('corrupt-artifact', 'Stored artifact bytes do not match metadata.')
      }
      const normalized = await store.verifyMetadata(artifact)
      if (!normalized.ok) return normalized
      artifacts.set(artifact.id, { metadata: artifact, content: content.value })
    }
    return ok(artifacts)
  }

  #validateVersions(): void {
    for (const row of this.#rows('SELECT * FROM simulation_versions')) {
      const version = simulationVersionSchema.parse({
        id: row.id,
        simulationId: row.simulation_id,
        versionNumber: row.version_number,
        state: row.state,
        revision: row.revision,
        activeConceptSpecId: row.active_concept_spec_id,
        activeGeneratedArtifactId: row.active_generated_artifact_id,
        activeArtifactBundle:
          row.active_artifact_bundle_json === null ? null : json(row.active_artifact_bundle_json),
        activeVerificationRunId: row.active_verification_run_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      this.#validateVersionOwnership(version)
    }
  }

  #validateVersionOwnership(version: ReturnType<typeof simulationVersionSchema.parse>): void {
    if (
      version.activeConceptSpecId !== null &&
      this.#database
        .prepare('SELECT 1 FROM concept_specs WHERE id=? AND simulation_version_id=?')
        .get(version.activeConceptSpecId, version.id) === undefined
    ) {
      throw new TypeError('Active concept ownership mismatch.')
    }
    if (
      version.activeGeneratedArtifactId !== null &&
      this.#database
        .prepare(`SELECT 1 FROM generated_artifacts g
          JOIN generation_attempts a ON a.id=g.generation_attempt_id JOIN generation_runs r ON r.id=a.generation_run_id
          WHERE g.id=? AND r.simulation_version_id=?`)
        .get(version.activeGeneratedArtifactId, version.id) === undefined
    ) {
      throw new TypeError('Active generated artifact ownership mismatch.')
    }
    if (requiresSelectedVerification(version.state) && version.activeVerificationRunId === null) {
      throw new TypeError('Terminal verification state has no selected evidence.')
    }
    if (version.activeVerificationRunId !== null) {
      const selected = this.#database
        .prepare(`SELECT concept_spec_id,generated_artifact_id,artifact_bundle_json,verdict
          FROM verification_runs WHERE id=? AND simulation_version_id=?`)
        .get(version.activeVerificationRunId, version.id) as
        | {
            concept_spec_id: string
            generated_artifact_id: string
            artifact_bundle_json: string
            verdict: string
          }
        | undefined
      if (
        selected === undefined ||
        selected.concept_spec_id !== version.activeConceptSpecId ||
        selected.generated_artifact_id !== version.activeGeneratedArtifactId ||
        selected.artifact_bundle_json !== JSON.stringify(version.activeArtifactBundle) ||
        !selectedVerdictMatches(version.state, selected.verdict)
      ) {
        throw new TypeError('Active verification selection mismatch.')
      }
    }
  }

  #validateGenerationRecords(): void {
    for (const row of this.#rows('SELECT * FROM generation_runs')) {
      generationRunSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        status: row.status,
        maxAttempts: row.max_attempts,
        codexSessionId: row.codex_session_id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })
    }
    for (const row of this.#rows('SELECT * FROM generation_attempts')) {
      const attempt = generationAttemptSchema.parse({
        id: row.id,
        generationRunId: row.generation_run_id,
        attemptNumber: row.attempt_number,
        outcome: row.outcome,
        generatedArtifactId: row.generated_artifact_id,
        stableErrorId: row.stable_error_id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })
      if (attempt.generatedArtifactId === null) continue
      const owned = this.#database
        .prepare('SELECT 1 FROM generated_artifacts WHERE id=? AND generation_attempt_id=?')
        .get(attempt.generatedArtifactId, attempt.id)
      if (
        owned === undefined &&
        !this.#validReverificationArtifact(attempt.id, attempt.generatedArtifactId)
      ) {
        throw new TypeError('Attempt artifact ownership mismatch.')
      }
    }
  }

  #validReverificationArtifact(attemptId: string, generatedArtifactId: string): boolean {
    const attempt = this.#database
      .prepare('SELECT generation_run_id FROM generation_attempts WHERE id=?')
      .get(attemptId) as { generation_run_id: string } | undefined
    return (
      attempt !== undefined &&
      isExactReverificationAttempt(this.#database, {
        runId: attempt.generation_run_id,
        attemptId,
        generatedArtifactId,
      })
    )
  }

  #validateConcepts(artifacts: ReadonlyMap<string, StoredObject>): void {
    for (const row of this.#rows('SELECT * FROM concept_specs')) {
      const concept = conceptSpecRecordSchema.parse({
        id: row.id,
        simulationVersionId: row.simulation_version_id,
        generationRunId: row.generation_run_id,
        schemaVersion: row.schema_version,
        domain: row.domain,
        artifact: {
          artifactId: row.artifact_id,
          role: 'concept-spec',
          contentHash: row.artifact_hash,
        },
        createdAt: row.created_at,
      })
      const object = artifacts.get(concept.artifact.artifactId)
      if (
        object?.metadata.contentHash !== concept.artifact.contentHash ||
        object.metadata.role !== 'concept-spec'
      ) {
        throw new TypeError('Concept artifact metadata mismatch.')
      }
      conceptSpecSchema.parse(JSON.parse(object.content.toString('utf8')))
      const generationOwner = this.#database
        .prepare('SELECT simulation_version_id FROM generation_runs WHERE id=?')
        .get(concept.generationRunId) as { simulation_version_id: string } | undefined
      if (generationOwner?.simulation_version_id !== concept.simulationVersionId) {
        throw new TypeError('Concept generation-run ownership mismatch.')
      }
    }
  }

  #validateGeneratedArtifacts(artifacts: ReadonlyMap<string, StoredObject>): void {
    for (const row of this.#rows('SELECT * FROM generated_artifacts')) {
      const generated = generatedArtifactSchema.parse({
        id: row.id,
        generationAttemptId: row.generation_attempt_id,
        artifactBundle: json(row.artifact_bundle_json),
        exportLicense: json(row.export_license_json),
        createdAt: row.created_at,
      })
      if (
        JSON.stringify(generated.artifactBundle) !== row.artifact_bundle_json ||
        generated.artifactBundle.core.artifactId !== row.core_artifact_id ||
        generated.artifactBundle.renderer.artifactId !== row.renderer_artifact_id ||
        generated.artifactBundle.manifest.artifactId !== row.manifest_artifact_id
      ) {
        throw new TypeError('Generated artifact bundle columns mismatch.')
      }
      for (const binding of Object.values(generated.artifactBundle)) {
        const object = artifacts.get(binding.artifactId)
        if (
          object?.metadata.role !== binding.role ||
          object.metadata.contentHash !== binding.contentHash
        ) {
          throw new TypeError('Generated artifact object mismatch.')
        }
      }
    }
  }

  #rows(statement: string): Row[] {
    return this.#database.prepare(statement).all()
  }
}
