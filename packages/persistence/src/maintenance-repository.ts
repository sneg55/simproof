import type { DatabaseSync } from 'node:sqlite'

import {
  portableSimulationExportSchema,
  type Sha256,
  type StoredArtifact,
  storedArtifactSchema,
} from '@simproof/contracts'

import { ArtifactCleanup } from './artifact-cleanup.js'
import type { ArtifactCleanupResult, ArtifactStore } from './artifact-store.js'
import { compareRecordId, portableRecord, recordQueries } from './portable-export-records.js'
import {
  type ExportByteBudget,
  TeacherPrivacyExporter,
  type TeacherPrivacySnapshot,
} from './privacy-export.js'
import { sqliteFailure } from './sqlite.js'
import {
  type ExportedSimulation,
  err,
  ok,
  type Result,
  type Simulation,
  type SimulationVersion,
} from './types.js'

interface ArtifactRow {
  id: string
  role: StoredArtifact['role']
  content_hash: Sha256
  media_type: StoredArtifact['mediaType']
  byte_length: number
  normalization_version: number
  created_at: string
}

export class MaintenanceRepository {
  readonly #database: DatabaseSync
  readonly #getSimulation: (id: string) => Result<Simulation>
  readonly #getVersion: (id: string) => Result<SimulationVersion>
  readonly #exclusive: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>
  readonly #validate: (store: ArtifactStore) => Promise<Result<true>>
  readonly #cleanup: ArtifactCleanup
  readonly #privacyExporter: TeacherPrivacyExporter
  readonly #phased: <T, U>(
    metadata: () => Result<T> | Promise<Result<T>>,
    cleanup: (value: T) => Promise<Result<U>>,
  ) => Promise<Result<U>>

  constructor(options: {
    database: DatabaseSync
    getSimulation: (id: string) => Result<Simulation>
    getVersion: (id: string) => Result<SimulationVersion>
    exclusive: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>
    validate: (store: ArtifactStore) => Promise<Result<true>>
    phased: <T, U>(
      metadata: () => Result<T> | Promise<Result<T>>,
      cleanup: (value: T) => Promise<Result<U>>,
    ) => Promise<Result<U>>
  }) {
    const { database, getSimulation, getVersion, exclusive, validate, phased } = options
    this.#database = database
    this.#getSimulation = getSimulation
    this.#getVersion = getVersion
    this.#exclusive = exclusive
    this.#validate = validate
    this.#phased = phased
    this.#cleanup = new ArtifactCleanup(database, exclusive, phased)
    this.#privacyExporter = new TeacherPrivacyExporter({
      database,
      exclusive,
      exportSimulation: async (id, store, budget) =>
        await this.#exportSimulation(id, store, false, budget),
    })
  }

  async auditAndCollect(
    store: ArtifactStore,
    options: { readonly dryRun?: boolean; readonly minimumAgeMs?: number } = {},
  ): Promise<Result<ArtifactCleanupResult>> {
    return await this.#cleanup.auditAndCollect(store, options)
  }

  listSimulationIds(): Result<readonly string[]> {
    try {
      const rows = this.#database
        .prepare('SELECT id FROM simulations ORDER BY created_at ASC,id ASC')
        .all() as Array<{ id: string }>
      return ok(rows.map(({ id }) => id))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  async exportTeacherPrivacySnapshot(
    store: ArtifactStore,
    maxBytes: number,
  ): Promise<Result<TeacherPrivacySnapshot>> {
    return await this.#privacyExporter.export(store, maxBytes)
  }

  async deleteSimulation(
    id: string,
    store: ArtifactStore,
  ): Promise<
    Result<{
      readonly orphanedArtifacts: readonly Sha256[]
      readonly deletedArtifacts: readonly Sha256[]
      readonly skippedArtifacts: readonly Sha256[]
      readonly deferredArtifacts: readonly Sha256[]
    }>
  > {
    return await this.#phased(
      () => this.#deleteMetadata(id),
      (candidates) => this.#deleteCandidates(candidates, store),
    )
  }

  async #deleteCandidates(
    candidates: readonly Sha256[],
    store: ArtifactStore,
  ): Promise<
    Result<{
      readonly orphanedArtifacts: readonly Sha256[]
      readonly deletedArtifacts: readonly Sha256[]
      readonly skippedArtifacts: readonly Sha256[]
      readonly deferredArtifacts: readonly Sha256[]
    }>
  > {
    const deleted: Sha256[] = []
    const skipped: Sha256[] = []
    const deferred: Sha256[] = []
    for (const hash of candidates) {
      const retained = this.#database
        .prepare('SELECT 1 FROM stored_artifacts WHERE content_hash=? LIMIT 1')
        .get(hash)
      if (retained !== undefined) {
        skipped.push(hash)
        continue
      }
      const result = await store.delete(hash)
      if (!result.ok) {
        deferred.push(hash)
        continue
      }
      if (result.value) deleted.push(hash)
      else skipped.push(hash)
    }
    return ok({
      orphanedArtifacts: candidates,
      deletedArtifacts: deleted,
      skippedArtifacts: skipped,
      deferredArtifacts: deferred,
    })
  }

  #deleteMetadata(id: string): Result<readonly Sha256[]> {
    if (!this.#getSimulation(id).ok) return err('not-found', 'Simulation was not found.')
    const candidates = this.#artifactRowsForSimulation(id)
    this.#database.prepare('DELETE FROM simulations WHERE id=?').run(id)
    for (const { id: artifactId } of candidates) {
      this.#database
        .prepare(`DELETE FROM stored_artifacts WHERE id=? AND NOT(
        EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=stored_artifacts.id) OR
        EXISTS(SELECT 1 FROM generated_artifacts g WHERE stored_artifacts.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
        EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=stored_artifacts.id))`)
        .run(artifactId)
    }
    return ok([...new Set(candidates.map(({ content_hash }) => content_hash))])
  }

  async exportSimulation(id: string, store: ArtifactStore): Promise<Result<ExportedSimulation>> {
    return await this.#exclusive(() => this.#exportSimulation(id, store, true))
  }

  async #exportSimulation(
    id: string,
    store: ArtifactStore,
    validate: boolean,
    budget?: ExportByteBudget,
  ): Promise<Result<ExportedSimulation>> {
    if (validate) {
      const validation = await this.#validate(store)
      if (!validation.ok) return validation
    }
    const simulation = this.#getSimulation(id)
    if (!simulation.ok) return simulation
    const simulationBudget = budget?.consumeJson(simulation.value)
    if (simulationBudget !== undefined && !simulationBudget.ok) return simulationBudget
    try {
      const versions = this.#collectVersions(id, budget)
      if (!versions.ok) return versions
      const records = this.#collectRecords(id, budget)
      if (!records.ok) return records
      const artifacts = await this.#collectArtifacts(id, store, budget)
      if (!artifacts.ok) return artifacts
      return ok(
        portableSimulationExportSchema.parse({
          schemaVersion: '1',
          simulation: simulation.value,
          versions: versions.value,
          records: records.value,
          artifacts: artifacts.value,
        }),
      )
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  #collectVersions(id: string, budget?: ExportByteBudget): Result<readonly SimulationVersion[]> {
    const rows = this.#database
      .prepare('SELECT id FROM simulation_versions WHERE simulation_id=? ORDER BY version_number')
      .iterate(id) as unknown as Iterable<{ id: string }>
    const versions: SimulationVersion[] = []
    for (const { id: versionId } of rows) {
      const version = this.#getVersion(versionId)
      if (!version.ok) return version
      const consumed = budget?.consumeJson(version.value)
      if (consumed !== undefined && !consumed.ok) return consumed
      versions.push(version.value)
    }
    return ok(versions)
  }

  #collectRecords(
    id: string,
    budget?: ExportByteBudget,
  ): Result<Record<string, readonly Readonly<Record<string, unknown>>[]>> {
    const entries: [string, Readonly<Record<string, unknown>>[]][] = []
    for (const [name, query] of Object.entries(recordQueries)) {
      const collection: Readonly<Record<string, unknown>>[] = []
      const rows = this.#database.prepare(query).iterate(id) as unknown as Iterable<
        Readonly<Record<string, unknown>>
      >
      for (const row of rows) {
        const record = portableRecord(name, row)
        const consumed = budget?.consumeJson(record)
        if (consumed !== undefined && !consumed.ok) return consumed
        collection.push(record)
      }
      entries.push([name, collection.sort(compareRecordId)])
    }
    return ok(Object.fromEntries(entries))
  }

  async #collectArtifacts(
    id: string,
    store: ArtifactStore,
    budget?: ExportByteBudget,
  ): Promise<Result<readonly (StoredArtifact & { readonly content: string })[]>> {
    const artifacts: Array<StoredArtifact & { content: string }> = []
    for (const row of this.#artifactRowsForSimulationIterator(id)) {
      const metadata = storedArtifactSchema.safeParse({
        id: row.id,
        role: row.role,
        contentHash: row.content_hash,
        mediaType: row.media_type,
        byteLength: row.byte_length,
        normalizationVersion: row.normalization_version,
        createdAt: row.created_at,
      })
      if (!metadata.success) return err('database-error', 'Stored artifact metadata is invalid.')
      if (budget !== undefined && metadata.data.byteLength > budget.remaining) {
        return err('invalid-input', 'Teacher privacy export exceeds its aggregate byte limit.')
      }
      const content = await store.get(metadata.data.contentHash)
      if (!content.ok) return content
      const artifact = { ...metadata.data, content: content.value.toString('utf8') }
      const consumed = budget?.consumeJson(artifact)
      if (consumed !== undefined && !consumed.ok) return consumed
      artifacts.push(artifact)
    }
    return ok(artifacts)
  }

  #artifactRowsForSimulation(id: string): readonly ArtifactRow[] {
    return [...this.#artifactRowsForSimulationIterator(id)]
  }

  #artifactRowsForSimulationIterator(id: string): Iterable<ArtifactRow> {
    return this.#database
      .prepare(`SELECT DISTINCT s.* FROM stored_artifacts s WHERE
      EXISTS(SELECT 1 FROM concept_specs c JOIN simulation_versions v ON v.id=c.simulation_version_id WHERE c.artifact_id=s.id AND v.simulation_id=?) OR
      EXISTS(SELECT 1 FROM generated_artifacts g JOIN generation_attempts a ON a.id=g.generation_attempt_id JOIN generation_runs r ON r.id=a.generation_run_id JOIN simulation_versions v ON v.id=r.simulation_version_id WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id) AND v.simulation_id=?) OR
      EXISTS(SELECT 1 FROM verification_runs q JOIN simulation_versions v ON v.id=q.simulation_version_id WHERE q.report_artifact_id=s.id AND v.simulation_id=?)
      ORDER BY s.id`)
      .iterate(id, id, id) as unknown as Iterable<ArtifactRow>
  }
}
