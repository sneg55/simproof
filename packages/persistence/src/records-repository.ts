import type { DatabaseSync } from 'node:sqlite'

import {
  type ConceptSpecRecord,
  conceptSpecRecordSchema,
  type DomainPackReference,
  type GeneratedArtifact,
  type GenerationAttempt,
  type GenerationRun,
  generatedArtifactSchema,
  generationAttemptSchema,
  generationRunSchema,
  type Sha256,
  type StoredArtifact,
  storedArtifactSchema,
  type VerificationPolicyReference,
} from '@simproof/contracts'

import { ArtifactRecords } from './artifact-records.js'
import type { ArtifactStore } from './artifact-store.js'
import { EvidenceReferenceRepository } from './evidence-reference-repository.js'
import { sqliteFailure } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'
const MAINTENANCE_ACTIVE = 'Persistence maintenance is active.'

export class RecordsRepository {
  readonly #database: DatabaseSync
  readonly #canWrite: () => boolean
  readonly #artifacts: ArtifactRecords
  readonly #evidence: EvidenceReferenceRepository
  readonly #serialize: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>

  constructor(
    database: DatabaseSync,
    canWrite: () => boolean,
    serialize: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>,
  ) {
    this.#database = database
    this.#canWrite = canWrite
    this.#artifacts = new ArtifactRecords(database)
    this.#evidence = new EvidenceReferenceRepository(database, canWrite)
    this.#serialize = serialize
  }

  async insertStoredArtifact(
    input: unknown,
    store: ArtifactStore,
  ): Promise<Result<StoredArtifact>> {
    return await this.#serialize(async () => {
      if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
      const parsed = storedArtifactSchema.safeParse(input)
      if (!parsed.success) return err(INVALID_INPUT, 'Stored artifact metadata is invalid.')
      const value = parsed.data
      const expectedMedia =
        value.role === 'core-source' || value.role === 'renderer-source'
          ? 'text/javascript'
          : 'application/json'
      if (value.normalizationVersion !== 1 || value.mediaType !== expectedMedia) {
        return err(INVALID_INPUT, 'Stored artifact normalization metadata is unsupported.')
      }
      const verified = await store.verifyMetadata(value)
      if (!verified.ok) return verified
      try {
        this.#database
          .prepare(`INSERT INTO stored_artifacts(
          id,role,content_hash,media_type,byte_length,normalization_version,created_at
        ) VALUES (?,?,?,?,?,?,?)`)
          .run(
            value.id,
            value.role,
            value.contentHash,
            value.mediaType,
            value.byteLength,
            value.normalizationVersion,
            value.createdAt,
          )
        return ok(value)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  insertGenerationRun(input: unknown): Result<GenerationRun> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = generationRunSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Generation run is invalid.')
    const value = parsed.data
    try {
      this.#database
        .prepare(`INSERT INTO generation_runs(
        id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
      ) VALUES (?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.simulationVersionId,
          value.status,
          value.maxAttempts,
          value.codexSessionId,
          value.createdAt,
          value.completedAt,
        )
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  insertGenerationAttempt(input: unknown): Result<GenerationAttempt> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = generationAttemptSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Generation attempt is invalid.')
    const value = parsed.data
    const run = this.#database
      .prepare('SELECT max_attempts,status FROM generation_runs WHERE id=?')
      .get(value.generationRunId) as { max_attempts: number; status: string } | undefined
    if (run === undefined || run.status !== 'running' || value.attemptNumber > run.max_attempts) {
      return err(INVALID_INPUT, 'Generation attempt exceeds its run cap.')
    }
    try {
      this.#database
        .prepare(`INSERT INTO generation_attempts(
        id,generation_run_id,attempt_number,outcome,generated_artifact_id,stable_error_id,created_at,completed_at
      ) VALUES (?,?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.generationRunId,
          value.attemptNumber,
          value.outcome,
          value.generatedArtifactId,
          value.stableErrorId,
          value.createdAt,
          value.completedAt,
        )
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  updateGenerationAttempt(input: unknown): Result<GenerationAttempt> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    if (
      typeof input !== 'object' ||
      input === null ||
      Object.keys(input).some(
        (key) =>
          !['id', 'outcome', 'generatedArtifactId', 'stableErrorId', 'completedAt'].includes(key),
      )
    )
      return err(INVALID_INPUT, 'Generation attempt update is invalid.')
    const command = input as Record<string, unknown>
    if (typeof command.id !== 'string')
      return err(INVALID_INPUT, 'Generation attempt ID is invalid.')
    const row = this.#database
      .prepare('SELECT * FROM generation_attempts WHERE id=?')
      .get(command.id) as Record<string, unknown> | undefined
    if (row === undefined || !['pending', 'running'].includes(String(row.outcome))) {
      return err('immutable-record', 'Only active generation attempts can be completed.')
    }
    const parsed = generationAttemptSchema.safeParse({
      id: row.id,
      generationRunId: row.generation_run_id,
      attemptNumber: row.attempt_number,
      outcome: command.outcome,
      generatedArtifactId: command.generatedArtifactId,
      stableErrorId: command.stableErrorId,
      createdAt: row.created_at,
      completedAt: command.completedAt,
    })
    if (!parsed.success || ['pending', 'running'].includes(parsed.data.outcome)) {
      return err(INVALID_INPUT, 'Generation attempt terminal outcome is invalid.')
    }
    const value = parsed.data
    if (value.generatedArtifactId !== null) {
      const owned = this.#database
        .prepare('SELECT 1 FROM generated_artifacts WHERE id=? AND generation_attempt_id=?')
        .get(value.generatedArtifactId, value.id)
      if (owned === undefined)
        return err(INVALID_INPUT, 'Generated artifact belongs to another attempt.')
    }
    try {
      const changed = this.#database
        .prepare(`UPDATE generation_attempts SET
        outcome=?,generated_artifact_id=?,stable_error_id=?,completed_at=? WHERE id=?
      `)
        .run(
          value.outcome,
          value.generatedArtifactId,
          value.stableErrorId,
          value.completedAt,
          value.id,
        )
      return Number(changed.changes) === 1
        ? ok(value)
        : err('not-found', 'Generation attempt was not found.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  completeGenerationRun(input: {
    id: string
    status: Exclude<GenerationRun['status'], 'running'>
    completedAt: string
  }): Result<GenerationRun> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const row = this.#database.prepare('SELECT * FROM generation_runs WHERE id=?').get(input.id) as
      | Record<string, unknown>
      | undefined
    if (row === undefined || row.status !== 'running') {
      return err('conflict', 'Only a running generation run can be completed.')
    }
    const parsed = generationRunSchema.safeParse({
      id: row.id,
      simulationVersionId: row.simulation_version_id,
      status: input.status,
      maxAttempts: row.max_attempts,
      codexSessionId: row.codex_session_id,
      createdAt: row.created_at,
      completedAt: input.completedAt,
    })
    if (!parsed.success) return err(INVALID_INPUT, 'Generation run completion is invalid.')
    const outcomes = this.#database
      .prepare('SELECT outcome FROM generation_attempts WHERE generation_run_id=?')
      .all(parsed.data.id) as unknown as Array<{ outcome: GenerationAttempt['outcome'] }>
    const active = outcomes.some(({ outcome }) => outcome === 'pending' || outcome === 'running')
    const verified = outcomes.some(({ outcome }) => outcome === 'verified')
    if (
      active ||
      (parsed.data.status === 'succeeded' && !verified) ||
      (parsed.data.status === 'rejected' && verified)
    ) {
      return err(INVALID_INPUT, 'Generation run outcome is inconsistent with its attempts.')
    }
    try {
      const changed = this.#database
        .prepare(`UPDATE generation_runs SET status=?,completed_at=?
        WHERE id=? AND status='running'`)
        .run(parsed.data.status, parsed.data.completedAt, parsed.data.id)
      return Number(changed.changes) === 1
        ? ok(parsed.data)
        : err('conflict', 'Generation run changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  insertConceptSpec(input: unknown): Result<ConceptSpecRecord> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = conceptSpecRecordSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Concept specification record is invalid.')
    const value = parsed.data
    if (
      !this.#bindingMatches(
        value.artifact.artifactId,
        value.artifact.role,
        value.artifact.contentHash,
      )
    ) {
      return err(INVALID_INPUT, 'Concept specification artifact binding is invalid.')
    }
    const owner = this.#database
      .prepare('SELECT 1 FROM generation_runs WHERE id=? AND simulation_version_id=?')
      .get(value.generationRunId, value.simulationVersionId)
    if (owner === undefined)
      return err(INVALID_INPUT, 'Concept specification provenance is invalid.')
    try {
      this.#database
        .prepare(`INSERT INTO concept_specs(
        id,simulation_version_id,generation_run_id,schema_version,domain,artifact_id,artifact_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.simulationVersionId,
          value.generationRunId,
          value.schemaVersion,
          value.domain,
          value.artifact.artifactId,
          value.artifact.contentHash,
          value.createdAt,
        )
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  getConceptSpec(id: string): Result<ConceptSpecRecord> {
    const row = this.#database
      .prepare(`SELECT c.id,c.simulation_version_id,c.generation_run_id,c.schema_version,c.domain,
        c.artifact_id,c.artifact_hash,c.created_at
        FROM concept_specs c WHERE c.id=?`)
      .get(id) as
      | {
          id: string
          simulation_version_id: string
          generation_run_id: string
          schema_version: string
          domain: string
          artifact_id: string
          artifact_hash: string
          created_at: string
        }
      | undefined
    if (row === undefined) return err('not-found', 'Concept specification was not found.')
    const parsed = conceptSpecRecordSchema.safeParse({
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
    return parsed.success
      ? ok(parsed.data)
      : err('database-error', 'Stored concept specification is invalid.')
  }

  insertGeneratedArtifact(input: unknown): Result<GeneratedArtifact> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = generatedArtifactSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Generated artifact record is invalid.')
    const value = parsed.data
    if (!this.#artifacts.bundleMatches(value.artifactBundle)) {
      return err(INVALID_INPUT, 'Generated artifact bundle does not match stored objects.')
    }
    try {
      this.#database
        .prepare(`INSERT INTO generated_artifacts(
        id,generation_attempt_id,artifact_bundle_json,core_artifact_id,renderer_artifact_id,
        manifest_artifact_id,export_license_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.generationAttemptId,
          JSON.stringify(value.artifactBundle),
          value.artifactBundle.core.artifactId,
          value.artifactBundle.renderer.artifactId,
          value.artifactBundle.manifest.artifactId,
          JSON.stringify(value.exportLicense),
          value.createdAt,
        )
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  insertPolicyReference(input: unknown): Result<VerificationPolicyReference> {
    return this.#evidence.insertPolicy(input)
  }

  ensurePolicyReference(input: unknown): Result<VerificationPolicyReference> {
    return this.#evidence.ensurePolicy(input)
  }

  insertDomainPackReference(input: unknown): Result<DomainPackReference> {
    return this.#evidence.insertDomainPack(input)
  }

  ensureDomainPackReference(input: unknown): Result<DomainPackReference> {
    return this.#evidence.ensureDomainPack(input)
  }

  referencedArtifactHashes(): Result<readonly Sha256[]> {
    return this.#artifacts.referencedHashes()
  }

  referencedArtifactFormats(): Result<
    readonly {
      hash: Sha256
      roles: readonly string[]
      normalizationVersions: readonly number[]
    }[]
  > {
    return this.#artifacts.referencedFormats()
  }

  storedArtifactFormats(): Result<
    readonly {
      hash: Sha256
      roles: readonly string[]
      normalizationVersions: readonly number[]
    }[]
  > {
    return this.#artifacts.allFormats()
  }

  #bindingMatches(id: string, role: string, hash: Sha256): boolean {
    return this.#artifacts.bindingMatches(id, role, hash)
  }
}
