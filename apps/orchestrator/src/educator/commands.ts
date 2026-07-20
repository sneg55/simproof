import {
  type ArchiveVersionRequest,
  type CreateDraftRequest,
  type DuplicateSimulationRequest,
  type PortableSimulationExport,
  type PublishVersionRequest,
  portableSimulationExportSchema,
  type SimulationDetail,
  type SimulationExportCommand,
  type StartBlankVersionRequest,
} from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'

import type { HttpOperationResult } from '../http/types.js'
import type { EducatorLibraryProjection } from './library-projection.js'
import { failed, fromPersistence } from './results.js'

export class EducatorCommands {
  readonly database: PersistenceDatabase
  readonly artifacts: ArtifactStore
  readonly library: EducatorLibraryProjection
  readonly createId: () => string
  readonly now: () => string
  readonly confirmPassword: (password: string, sessionId: string) => Promise<boolean>

  constructor(options: {
    readonly database: PersistenceDatabase
    readonly artifacts: ArtifactStore
    readonly library: EducatorLibraryProjection
    readonly createId: () => string
    readonly now: () => string
    readonly confirmPassword: (password: string, sessionId: string) => Promise<boolean>
  }) {
    this.database = options.database
    this.artifacts = options.artifacts
    this.library = options.library
    this.createId = options.createId
    this.now = options.now
    this.confirmPassword = options.confirmPassword
  }

  async create(input: CreateDraftRequest): Promise<HttpOperationResult<SimulationDetail>> {
    const simulationId = this.createId()
    const versionId = this.createId()
    const createdAt = this.now()
    const created = this.database.educator.createDraft({
      simulation: {
        id: simulationId,
        title: input.title,
        createdAt,
        updatedAt: createdAt,
      },
      version: {
        id: versionId,
        simulationId,
        versionNumber: 1,
        state: 'draft',
        revision: 0,
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
        createdAt,
        updatedAt: createdAt,
      },
    })
    return created.ok ? await this.library.detail(simulationId) : fromPersistence(created)
  }

  async startBlankVersion(
    simulationId: string,
    input: StartBlankVersionRequest,
  ): Promise<HttpOperationResult<SimulationDetail>> {
    const created = this.database.educator.createNextDraft({
      simulationId,
      sourceVersionId: input.sourceVersionId,
      expectedSourceRevision: input.expectedSourceRevision,
      versionId: this.createId(),
      createdAt: this.now(),
    })
    return created.ok
      ? await this.library.detail(simulationId, created.value.id)
      : fromPersistence(created)
  }

  async duplicate(
    simulationId: string,
    input: DuplicateSimulationRequest,
  ): Promise<HttpOperationResult<SimulationDetail>> {
    const source = this.database.educator.versionForSimulation(input.sourceVersionId, simulationId)
    if (!source.ok) return fromPersistence(source)
    const duplicatedSimulationId = this.createId()
    const duplicatedVersionId = this.createId()
    const createdAt = this.now()
    const duplicated = this.database.educator.duplicateToDraft({
      sourceVersionId: source.value.id,
      expectedSourceRevision: input.expectedSourceRevision,
      simulation: {
        id: duplicatedSimulationId,
        title: input.title,
        createdAt,
        updatedAt: createdAt,
      },
      versionId: duplicatedVersionId,
      createdAt,
      copiedRecordIds: {
        generationRunId: this.createId(),
        conceptSpecId: this.createId(),
        generationAttemptId: this.createId(),
        generatedArtifactId: this.createId(),
      },
    })
    return duplicated.ok
      ? await this.library.detail(duplicatedSimulationId)
      : fromPersistence(duplicated)
  }

  async archive(
    versionId: string,
    input: ArchiveVersionRequest,
  ): Promise<HttpOperationResult<SimulationDetail>> {
    const archived = this.database.educator.archive({
      versionId,
      expectedRevision: input.expectedRevision,
      archivedAt: this.now(),
    })
    return archived.ok
      ? await this.library.detail(archived.value.simulationId, archived.value.id)
      : fromPersistence(archived)
  }

  async publish(
    versionId: string,
    input: PublishVersionRequest,
  ): Promise<HttpOperationResult<SimulationDetail>> {
    const version = this.database.getVersion(versionId)
    if (!version.ok) return fromPersistence(version)
    if (version.value.activeVerificationRunId !== input.verificationRunId) {
      return failed('conflict', 'Publication does not match the selected verification run.')
    }
    const published = await this.database.verification.publish(
      {
        id: this.createId(),
        simulationVersionId: versionId,
        exportLicense: input.exportLicense,
        publishedAt: this.now(),
      },
      input.expectedRevision,
      this.artifacts,
    )
    return published.ok
      ? await this.library.detail(version.value.simulationId, versionId)
      : fromPersistence(published)
  }

  async export(
    input: SimulationExportCommand,
    sessionId: string,
  ): Promise<HttpOperationResult<PortableSimulationExport>> {
    if (!(await this.confirmPassword(input.currentPassword, sessionId))) {
      return failed('confirmation-failed', 'Current password confirmation failed.')
    }
    const exported = await this.database.maintenance.exportSimulation(
      input.simulationId,
      this.artifacts,
    )
    if (!exported.ok) return fromPersistence(exported)
    return {
      ok: true,
      value: portableSimulationExportSchema.parse({
        ...exported.value,
        records: {
          ...exported.value.records,
          generationRuns: exported.value.records.generationRuns.map((run) => ({
            ...run,
            codexSessionId: null,
          })),
        },
      }),
    }
  }
}
