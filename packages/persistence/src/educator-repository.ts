import type { DatabaseSync } from 'node:sqlite'

import {
  type Simulation,
  type SimulationVersion,
  simulationSchema,
  simulationVersionSchema,
} from '@simproof/contracts'
import { duplicateEditableContent } from './educator-duplicate.js'
import {
  bundledMetadata,
  decodeLibraryItem,
  type LibraryRow,
  librarySelect,
} from './educator-projections.js'
import type {
  CreateEducatorDraftInput,
  CreateNextDraftInput,
  DuplicateDraftInput,
  DuplicateVersionLineage,
  EducatorListResult,
  EducatorSimulationDetail,
} from './educator-types.js'
import { encodeCursor, parseEducatorList } from './educator-validation.js'
import { validId, validTimestamp } from './generation-validation.js'
import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'
import { decodeVersion, type VersionRow } from './version-codec.js'

const INVALID_INPUT = 'invalid-input'

export class EducatorRepository {
  readonly database: DatabaseSync
  readonly canWrite: () => boolean
  readonly getSimulation: (id: string) => Result<Simulation>
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly transitionVersion: (input: {
    id: string
    expectedRevision: number
    to: 'archived'
    updatedAt: string
  }) => Result<SimulationVersion>

  constructor(options: {
    readonly database: DatabaseSync
    readonly canWrite: () => boolean
    readonly getSimulation: (id: string) => Result<Simulation>
    readonly getVersion: (id: string) => Result<SimulationVersion>
    readonly transitionVersion: (input: {
      id: string
      expectedRevision: number
      to: 'archived'
      updatedAt: string
    }) => Result<SimulationVersion>
  }) {
    this.database = options.database
    this.canWrite = options.canWrite
    this.getSimulation = options.getSimulation
    this.getVersion = options.getVersion
    this.transitionVersion = options.transitionVersion
  }

  createDraft(
    input: CreateEducatorDraftInput,
  ): Result<{ simulation: Simulation; version: SimulationVersion }> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    const simulation = simulationSchema.safeParse(input.simulation)
    const version = simulationVersionSchema.safeParse(input.version)
    if (
      !simulation.success ||
      !version.success ||
      version.data.simulationId !== simulation.data.id ||
      version.data.versionNumber !== 1 ||
      version.data.state !== 'draft' ||
      version.data.revision !== 0
    )
      return err(INVALID_INPUT, 'Initial educator draft is invalid.')
    return transaction(this.database, () => {
      try {
        insertSimulation(this.database, simulation.data)
        insertVersion(this.database, version.data)
        return ok({ simulation: simulation.data, version: version.data })
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  createNextDraft(input: CreateNextDraftInput): Result<SimulationVersion> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (
      !validId(input.simulationId) ||
      !validId(input.sourceVersionId) ||
      !Number.isSafeInteger(input.expectedSourceRevision) ||
      input.expectedSourceRevision < 0 ||
      !validId(input.versionId) ||
      !validTimestamp(input.createdAt)
    )
      return err(INVALID_INPUT, 'New version input is invalid.')
    return transaction(this.database, () => {
      const source = this.versionForSimulation(input.sourceVersionId, input.simulationId)
      if (!source.ok) return source
      if (source.value.revision !== input.expectedSourceRevision) {
        return err('conflict', 'Source simulation version changed concurrently.')
      }
      const maximum = this.database
        .prepare(
          'SELECT MAX(version_number) AS value FROM simulation_versions WHERE simulation_id=?',
        )
        .get(input.simulationId) as { value: number }
      const version = simulationVersionSchema.parse({
        id: input.versionId,
        simulationId: input.simulationId,
        versionNumber: maximum.value + 1,
        state: 'draft',
        revision: 0,
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      try {
        insertVersion(this.database, version)
        this.database
          .prepare('UPDATE simulations SET updated_at=? WHERE id=?')
          .run(input.createdAt, input.simulationId)
        return ok(version)
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  duplicateToDraft(
    input: DuplicateDraftInput,
  ): Result<{ simulation: Simulation; version: SimulationVersion }> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    const simulation = simulationSchema.safeParse(input.simulation)
    if (
      !simulation.success ||
      !validId(input.sourceVersionId) ||
      !Number.isSafeInteger(input.expectedSourceRevision) ||
      input.expectedSourceRevision < 0 ||
      !validId(input.versionId) ||
      !validTimestamp(input.createdAt) ||
      Object.values(input.copiedRecordIds).some((value) => !validId(value))
    )
      return err(INVALID_INPUT, 'Duplicate draft input is invalid.')
    return transaction(this.database, () => {
      const source = this.getVersion(input.sourceVersionId)
      if (!source.ok) return source
      if (source.value.revision !== input.expectedSourceRevision) {
        return err('conflict', 'Source simulation version changed concurrently.')
      }
      try {
        const version = duplicateEditableContent(this.database, {
          source: source.value,
          simulation: simulation.data,
          destinationVersionId: input.versionId,
          copiedRecordIds: input.copiedRecordIds,
          createdAt: input.createdAt,
        })
        return ok({ simulation: simulation.data, version })
      } catch (error) {
        return sqliteFailure(error)
      }
    })
  }

  duplicateLineage(versionId: string): Result<DuplicateVersionLineage | null> {
    if (!validId(versionId)) return err(INVALID_INPUT, 'Version ID is invalid.')
    const row = this.database
      .prepare('SELECT * FROM version_lineage WHERE destination_version_id=?')
      .get(versionId) as
      | {
          destination_version_id: string
          source_simulation_id: string
          source_version_id: string
          source_version_number: number
          source_revision: number
          kind: string
          created_at: string
        }
      | undefined
    if (row === undefined) return ok(null)
    if (row.kind !== 'duplicate') return err('database-error', 'Stored version lineage is invalid.')
    return ok({
      kind: 'duplicate',
      destinationVersionId: row.destination_version_id,
      sourceSimulationId: row.source_simulation_id,
      sourceVersionId: row.source_version_id,
      sourceVersionNumber: row.source_version_number,
      sourceRevision: row.source_revision,
      createdAt: row.created_at,
    })
  }

  list(input: unknown): Result<EducatorListResult> {
    const parsed = parseEducatorList(input)
    if (parsed === null) return err(INVALID_INPUT, 'Educator library query is invalid.')
    const where: string[] = []
    const parameters: (string | number | null)[] = []
    if (parsed.cursor !== null) {
      where.push('(s.updated_at<? OR (s.updated_at=? AND s.id>?))')
      parameters.push(parsed.cursor.updatedAt, parsed.cursor.updatedAt, parsed.cursor.id)
    }
    if (parsed.search !== null) {
      where.push('instr(lower(s.title),lower(?))>0')
      parameters.push(parsed.search)
    }
    if (parsed.domain !== null) {
      where.push('c.domain=?')
      parameters.push(parsed.domain)
    }
    if (parsed.ownership !== null)
      where.push(
        parsed.ownership === 'bundled' ? 'b.example_id IS NOT NULL' : 'b.example_id IS NULL',
      )
    if (parsed.states.length > 0) {
      where.push(`v.state IN (${parsed.states.map(() => '?').join(',')})`)
      parameters.push(...parsed.states)
    }
    const rows = this.database
      .prepare(`${librarySelect()} ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
      ORDER BY s.updated_at DESC,s.id ASC LIMIT ?`)
      .all(...parameters, parsed.limit + 1) as unknown as LibraryRow[]
    const hasNext = rows.length > parsed.limit
    const page = rows.slice(0, parsed.limit)
    const last = page.at(-1)
    return ok({
      items: page.map(decodeLibraryItem),
      nextCursor: hasNext && last !== undefined ? encodeCursor(last.updated_at, last.id) : null,
    })
  }

  detail(simulationId: string): Result<EducatorSimulationDetail> {
    const simulation = this.getSimulation(simulationId)
    if (!simulation.ok) return simulation
    const versions = this.versions(simulationId)
    if (!versions.ok) return versions
    const latestVersion = versions.value.at(-1)
    if (latestVersion === undefined)
      return err('database-error', 'Simulation has no version history.')
    return ok({
      simulation: simulation.value,
      versions: versions.value,
      latestVersion,
      bundledExample: bundledMetadata(this.database, simulationId),
    })
  }

  versions(simulationId: string): Result<readonly SimulationVersion[]> {
    if (!validId(simulationId)) return err(INVALID_INPUT, 'Simulation ID is invalid.')
    const rows = this.database
      .prepare('SELECT * FROM simulation_versions WHERE simulation_id=? ORDER BY version_number')
      .all(simulationId) as unknown as VersionRow[]
    if (rows.length === 0) return err('not-found', 'Simulation version history was not found.')
    const values: SimulationVersion[] = []
    for (const row of rows) {
      const decoded = decodeVersion(row)
      if (!decoded.ok) return decoded
      values.push(decoded.value)
    }
    return ok(values)
  }

  versionForSimulation(versionId: string, simulationId: string): Result<SimulationVersion> {
    const row = this.database
      .prepare('SELECT * FROM simulation_versions WHERE id=? AND simulation_id=?')
      .get(versionId, simulationId) as VersionRow | undefined
    return row === undefined
      ? err('not-found', 'Simulation version was not found.')
      : decodeVersion(row)
  }

  archive(input: {
    readonly versionId: string
    readonly expectedRevision: number
    readonly archivedAt: string
  }): Result<SimulationVersion> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (
      !validId(input.versionId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !validTimestamp(input.archivedAt)
    )
      return err(INVALID_INPUT, 'Archive command is invalid.')
    return transaction(this.database, () => {
      const version = this.transitionVersion({
        id: input.versionId,
        expectedRevision: input.expectedRevision,
        to: 'archived',
        updatedAt: input.archivedAt,
      })
      if (!version.ok) return version
      this.database
        .prepare('UPDATE simulations SET updated_at=? WHERE id=?')
        .run(input.archivedAt, version.value.simulationId)
      return version
    })
  }
}

function insertSimulation(database: DatabaseSync, value: Simulation): void {
  database
    .prepare('INSERT INTO simulations(id,title,created_at,updated_at) VALUES (?,?,?,?)')
    .run(value.id, value.title, value.createdAt, value.updatedAt)
}

function insertVersion(database: DatabaseSync, value: SimulationVersion): void {
  database
    .prepare(
      `INSERT INTO simulation_versions(id,simulation_id,version_number,state,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      value.id,
      value.simulationId,
      value.versionNumber,
      value.state,
      value.revision,
      value.createdAt,
      value.updatedAt,
    )
}
