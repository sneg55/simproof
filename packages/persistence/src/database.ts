import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  type ArtifactBundle,
  artifactBundleSchema,
  type GenerationRun,
  type Sha256,
  type Simulation,
  type SimulationLifecycleState,
  type SimulationVersion,
  simulationSchema,
  simulationVersionSchema,
} from '@simproof/contracts'
import { ConceptReviewRepository } from './concept-review-repository.js'
import { DatabaseMaintenance } from './database-maintenance.js'
import { EducatorRepository } from './educator-repository.js'
import { GenerationRepository } from './generation-repository.js'
import type { BeginGenerationInput } from './generation-types.js'
import { validateTransition } from './lifecycle.js'
import { maintenanceActive, withOperationLock, writeAllowed } from './maintenance-lock.js'
import { MaintenanceRepository } from './maintenance-repository.js'
import { type MigrationReadiness, MigrationRunner } from './migration-runner.js'
import { RecordValidator } from './record-validator.js'
import { RecordsRepository } from './records-repository.js'
import { ReverificationRepository } from './reverification-repository.js'
import { asCount, sqliteFailure, transaction } from './sqlite.js'
import { err, type InstalledEvidenceResolver, ok, type Result } from './types.js'
import { VerificationRepository } from './verification-repository.js'
import { decodeVersion, type VersionRow } from './version-codec.js'

export { CURRENT_PERSISTENCE_SCHEMA_VERSION } from './migrations.js'
export { inspectPersistence, type PersistenceInspection } from './persistence-inspection.js'

const INVALID_INPUT = 'invalid-input'
const DATABASE_ERROR = 'database-error'
const INVALID_STATE = 'invalid-state'
const MAINTENANCE_ACTIVE = 'Persistence maintenance is active.'

export type PersistenceReadiness = MigrationReadiness

export class PersistenceDatabase {
  readonly path: string
  readonly #database: DatabaseSync
  readonly records: RecordsRepository
  readonly verification: VerificationRepository
  readonly reverification: ReverificationRepository
  readonly maintenance: MaintenanceRepository
  readonly generation: GenerationRepository
  readonly educator: EducatorRepository
  readonly conceptReviews: ConceptReviewRepository
  readonly #validator: RecordValidator
  readonly #migrations: MigrationRunner
  readonly #databaseMaintenance: DatabaseMaintenance

  constructor(
    path: string,
    resolveInstalledEvidence: InstalledEvidenceResolver = () =>
      err(INVALID_STATE, 'Installed verification evidence is unavailable.'),
  ) {
    this.path = resolve(path)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    this.#database = new DatabaseSync(this.path, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      timeout: 2_000,
    })
    this.#database.enableDefensive(true)
    const canWrite = () => writeAllowed(this.path)
    this.#databaseMaintenance = new DatabaseMaintenance(this.#database, this.path)
    this.#migrations = new MigrationRunner(this.#database, canWrite)
    this.records = new RecordsRepository(this.#database, canWrite, (operation) =>
      this.#databaseMaintenance.transaction(operation),
    )
    this.generation = new GenerationRepository(this.#database, canWrite, (id) =>
      this.getVersion(id),
    )
    this.educator = new EducatorRepository({
      database: this.#database,
      canWrite,
      getSimulation: (id) => this.getSimulation(id),
      getVersion: (id) => this.getVersion(id),
      transitionVersion: (input) => this.transitionVersion(input),
    })
    this.conceptReviews = new ConceptReviewRepository(
      this.#database,
      canWrite,
      (id) => this.generation.get(id),
      (id) => this.getVersion(id),
    )
    this.#validator = new RecordValidator(this.#database)
    this.verification = new VerificationRepository({
      database: this.#database,
      getVersion: (id) => this.getVersion(id),
      canWrite,
      resolveInstalledEvidence,
      serialize: (operation) => withOperationLock(this.path, operation),
    })
    this.reverification = new ReverificationRepository({
      database: this.#database,
      getVersion: (id) => this.getVersion(id),
      getVerificationRun: (id) => this.verification.get(id),
      getGenerationRun: (id) => this.generation.get(id),
      canWrite,
      resolveInstalledEvidence,
      serialize: (operation) => withOperationLock(this.path, operation),
    })
    this.maintenance = new MaintenanceRepository({
      database: this.#database,
      getSimulation: (id) => this.getSimulation(id),
      getVersion: (id) => this.getVersion(id),
      exclusive: (operation) => this.withMaintenanceTransaction(operation),
      validate: (store) => this.validateStoredRecords(store),
      phased: (metadata, cleanup) => this.#databaseMaintenance.phased(metadata, cleanup),
    })
  }

  migrate(): Result<{ readonly applied: readonly number[] }> {
    return this.#migrations.migrate()
  }

  appliedMigrations(): Result<readonly number[]> {
    return this.#migrations.applied()
  }

  foreignKeysEnabled(): boolean {
    return this.#migrations.foreignKeysEnabled()
  }

  createSimulation(input: unknown): Result<Simulation> {
    if (maintenanceActive(this.path)) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = simulationSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Simulation input is invalid.')
    try {
      const value = parsed.data
      this.#database
        .prepare('INSERT INTO simulations(id,title,created_at,updated_at) VALUES (?,?,?,?)')
        .run(value.id, value.title, value.createdAt, value.updatedAt)
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  getSimulation(id: string): Result<Simulation> {
    const row = this.#database
      .prepare('SELECT id,title,created_at,updated_at FROM simulations WHERE id=?')
      .get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined
    if (row === undefined) return err('not-found', 'Simulation was not found.')
    const parsed = simulationSchema.safeParse({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    return parsed.success ? ok(parsed.data) : err(DATABASE_ERROR, 'Stored simulation is invalid.')
  }

  createDraftVersion(input: unknown): Result<SimulationVersion> {
    if (maintenanceActive(this.path)) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = simulationVersionSchema.safeParse(input)
    if (!parsed.success || parsed.data.state !== 'draft' || parsed.data.revision !== 0) {
      return err(INVALID_INPUT, 'Initial simulation version must be a revision-zero draft.')
    }
    try {
      const value = parsed.data
      this.#database
        .prepare(`INSERT INTO simulation_versions(
        id,simulation_id,version_number,state,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.simulationId,
          value.versionNumber,
          value.state,
          value.revision,
          value.createdAt,
          value.updatedAt,
        )
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  getVersion(id: string): Result<SimulationVersion> {
    const row = this.#database.prepare('SELECT * FROM simulation_versions WHERE id=?').get(id) as
      | VersionRow
      | undefined
    return row === undefined
      ? err('not-found', 'Simulation version was not found.')
      : decodeVersion(row)
  }

  bindCandidate(input: {
    id: string
    expectedRevision: number
    conceptSpecId: string
    generatedArtifactId: string
    artifactBundle: ArtifactBundle
    updatedAt: string
  }): Result<SimulationVersion> {
    if (maintenanceActive(this.path)) return err('conflict', MAINTENANCE_ACTIVE)
    const bundle = artifactBundleSchema.safeParse(input.artifactBundle)
    if (!bundle.success) return err(INVALID_INPUT, 'Candidate artifact bundle is invalid.')
    const current = this.getVersion(input.id)
    if (!current.ok) return current
    const next = simulationVersionSchema.safeParse({
      ...current.value,
      revision: input.expectedRevision + 1,
      activeConceptSpecId: input.conceptSpecId,
      activeGeneratedArtifactId: input.generatedArtifactId,
      activeArtifactBundle: bundle.data,
      activeVerificationRunId: null,
      updatedAt: input.updatedAt,
    })
    if (!next.success) return err(INVALID_INPUT, 'Candidate version binding is invalid.')
    const provenance = this.#database
      .prepare(`SELECT COUNT(*) AS count FROM concept_specs c
      JOIN generated_artifacts g ON g.id=? JOIN generation_attempts a ON a.id=g.generation_attempt_id
      JOIN generation_runs r ON r.id=a.generation_run_id
      WHERE c.id=? AND c.simulation_version_id=? AND c.generation_run_id=r.id
        AND r.simulation_version_id=? AND g.artifact_bundle_json=?`)
      .get(
        input.generatedArtifactId,
        input.conceptSpecId,
        input.id,
        input.id,
        JSON.stringify(bundle.data),
      ) as { count: number }
    if (provenance.count !== 1)
      return err(INVALID_INPUT, 'Candidate provenance crosses simulation versions.')
    try {
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET
        active_concept_spec_id=?,active_generated_artifact_id=?,active_artifact_bundle_json=?,
        active_verification_run_id=NULL,revision=revision+1,updated_at=?
        WHERE id=? AND state='generating' AND revision=?`)
        .run(
          next.data.activeConceptSpecId,
          next.data.activeGeneratedArtifactId,
          JSON.stringify(next.data.activeArtifactBundle),
          next.data.updatedAt,
          next.data.id,
          input.expectedRevision,
        )
      return asCount(changed.changes) === 1
        ? this.getVersion(input.id)
        : err('conflict', 'Simulation version revision changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  transitionVersion(input: {
    id: string
    expectedRevision: number
    to: SimulationLifecycleState
    updatedAt: string
  }): Result<SimulationVersion> {
    if (maintenanceActive(this.path)) return err('conflict', MAINTENANCE_ACTIVE)
    if (input.to === 'generating') {
      return err(INVALID_STATE, 'Generation must begin atomically with its bounded run.')
    }
    const current = this.getVersion(input.id)
    if (!current.ok) return current
    if (current.value.revision !== input.expectedRevision) {
      return err('conflict', 'Simulation version revision changed concurrently.')
    }
    const allowed = validateTransition(current.value.state, input.to)
    if (!allowed.ok) return allowed
    if (current.value.state === 'verifying' && ['verified', 'rejected'].includes(input.to)) {
      return err(INVALID_STATE, 'Verification outcomes must be finalized with their immutable run.')
    }
    const next = simulationVersionSchema.safeParse({
      ...current.value,
      state: input.to,
      revision: input.expectedRevision + 1,
      updatedAt: input.updatedAt,
      ...(input.to === 'draft'
        ? {
            activeConceptSpecId: null,
            activeGeneratedArtifactId: null,
            activeArtifactBundle: null,
            activeVerificationRunId: null,
          }
        : {}),
    })
    if (!next.success) return err(INVALID_STATE, 'Lifecycle evidence requirements are not met.')
    try {
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET
        state=?,revision=?,active_concept_spec_id=?,active_generated_artifact_id=?,active_artifact_bundle_json=?,
        active_verification_run_id=?,updated_at=? WHERE id=? AND revision=?`)
        .run(
          next.data.state,
          next.data.revision,
          next.data.activeConceptSpecId,
          next.data.activeGeneratedArtifactId,
          next.data.activeArtifactBundle === null
            ? null
            : JSON.stringify(next.data.activeArtifactBundle),
          next.data.activeVerificationRunId,
          next.data.updatedAt,
          next.data.id,
          input.expectedRevision,
        )
      return asCount(changed.changes) === 1
        ? ok(next.data)
        : err('conflict', 'Simulation version revision changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  beginGeneration(input: {
    versionId: string
    expectedRevision: number
    updatedAt: string
    run: unknown
  }): Result<{ version: SimulationVersion; run: GenerationRun }> {
    if (maintenanceActive(this.path)) return err('conflict', MAINTENANCE_ACTIVE)
    return transaction(this.#database, () => {
      const run = this.records.insertGenerationRun(input.run)
      if (!run.ok) return run
      const fresh = run.value.status === 'running' && run.value.completedAt === null
      if (!fresh) return err(INVALID_INPUT, 'Generation must begin with a fresh running run.')
      if (run.value.simulationVersionId !== input.versionId)
        return err(INVALID_INPUT, 'Generation run must belong to the transitioned version.')
      const current = this.getVersion(input.versionId)
      if (!current.ok) return current
      if (
        current.value.state !== 'draft' &&
        current.value.state !== 'rejected' &&
        current.value.state !== 'stale'
      ) {
        return err(INVALID_STATE, 'Version cannot begin generation from its current state.')
      }
      const next = simulationVersionSchema.parse({
        ...current.value,
        state: 'generating',
        revision: input.expectedRevision + 1,
        updatedAt: input.updatedAt,
      })
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET state='generating',revision=revision+1,updated_at=?
          WHERE id=? AND revision=? AND state IN ('draft','rejected','stale')`)
        .run(input.updatedAt, input.versionId, input.expectedRevision)
      return asCount(changed.changes) === 1
        ? ok({ version: next, run: run.value })
        : err('conflict', 'Simulation version revision changed concurrently.')
    })
  }

  beginOrReplayGeneration(input: BeginGenerationInput) {
    return this.generation.beginOrReplay(input)
  }

  referencedArtifactHashes(): Result<readonly Sha256[]> {
    return this.records.referencedArtifactHashes()
  }

  integrityCheck(): Result<true> {
    return this.#migrations.integrity()
  }

  validateCurrentSchema(): Result<true> {
    return this.#migrations.validateCurrent()
  }

  readiness(): PersistenceReadiness {
    return this.#migrations.readiness()
  }

  async validateStoredRecords(
    store: import('./artifact-store.js').ArtifactStore,
  ): Promise<Result<true>> {
    return await this.#validator.validate(store)
  }

  async snapshot(destination: string): Promise<void> {
    await this.#databaseMaintenance.snapshot(destination)
  }

  async withMaintenanceTransaction<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    return await this.#databaseMaintenance.transaction(operation)
  }

  async withBackupLock<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    return await this.#databaseMaintenance.backupLock(operation)
  }

  close(): void {
    this.#database.close()
  }
}

export function createPersistence(
  path: string,
  resolveInstalledEvidence?: InstalledEvidenceResolver,
): PersistenceDatabase {
  return new PersistenceDatabase(path, resolveInstalledEvidence)
}
