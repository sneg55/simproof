import type { Simulation, SimulationLifecycleState, SimulationVersion } from '@simproof/contracts'

export interface BundledExampleMetadata {
  readonly exampleId: string
  readonly exampleVersion: string
  readonly catalogHash: string
  readonly simulationId: string
  readonly domain: 'projectile' | 'pendulum'
  readonly licenseId: 'CC-BY-4.0'
  readonly attribution: string
  readonly installedAt: string
}

export interface EducatorLibraryItem {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly latestVersionId: string
  readonly versionNumber: number
  readonly state: SimulationLifecycleState
  readonly domain: 'projectile' | 'pendulum' | null
  readonly ownership: 'teacher' | 'bundled'
}

export interface EducatorListResult {
  readonly items: readonly EducatorLibraryItem[]
  readonly nextCursor: string | null
}

export interface EducatorSimulationDetail {
  readonly simulation: Simulation
  readonly versions: readonly SimulationVersion[]
  readonly latestVersion: SimulationVersion
  readonly bundledExample: BundledExampleMetadata | null
}

export interface CreateEducatorDraftInput {
  readonly simulation: unknown
  readonly version: unknown
}

export interface CreateNextDraftInput {
  readonly simulationId: string
  readonly sourceVersionId: string
  readonly expectedSourceRevision: number
  readonly versionId: string
  readonly createdAt: string
}

export interface DuplicateDraftInput {
  readonly sourceVersionId: string
  readonly expectedSourceRevision: number
  readonly simulation: unknown
  readonly versionId: string
  readonly createdAt: string
  readonly copiedRecordIds: {
    readonly generationRunId: string
    readonly conceptSpecId: string
    readonly generationAttemptId: string
    readonly generatedArtifactId: string
  }
}

export interface DuplicateVersionLineage {
  readonly kind: 'duplicate'
  readonly destinationVersionId: string
  readonly sourceSimulationId: string
  readonly sourceVersionId: string
  readonly sourceVersionNumber: number
  readonly sourceRevision: number
  readonly createdAt: string
}
