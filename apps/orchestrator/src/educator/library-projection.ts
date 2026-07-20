import type {
  EducatorVersionDetail,
  LibraryPage,
  LibraryQuery,
  SimulationDetail,
  VersionComparison,
  VersionHistory,
} from '@simproof/contracts'
import type { PersistenceDatabase } from '@simproof/persistence'

import type { HttpOperationResult } from '../http/types.js'
import { comparisonRowsFor } from './comparison-projection.js'
import type { EducatorReportProjection } from './report-projection.js'
import { failed, fromPersistence, persistenceFailure, succeeded } from './results.js'

export class EducatorLibraryProjection {
  constructor(
    readonly database: PersistenceDatabase,
    readonly reports: EducatorReportProjection,
  ) {}

  async list(query: LibraryQuery): Promise<HttpOperationResult<LibraryPage>> {
    if (query.sources.includes('seed')) {
      return failed(
        'invalid-input',
        'Seed filtering is available through the immutable seed catalog endpoint.',
      )
    }
    const listed = this.database.educator.list({
      limit: Math.min(query.limit, 50),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.search === '' ? {} : { search: query.search }),
      ...(query.domains.length === 1 ? { domain: query.domains[0] } : {}),
      states: query.states,
      ownership: 'teacher',
    })
    if (!listed.ok) return fromPersistence(listed)
    const details: SimulationDetail[] = []
    for (const { id } of listed.value.items) {
      const detail = await this.detail(id)
      if (!detail.ok) return detail
      details.push(detail.value)
    }
    const filtered =
      query.domains.length === 0
        ? details
        : details.filter(({ simulation }) => {
            const domain = simulation.currentVersion.domain
            return domain !== null && query.domains.includes(domain)
          })
    return succeeded({
      items: filtered.map(({ simulation }) => simulation),
      nextCursor: listed.value.nextCursor,
    })
  }

  async detail(
    simulationId: string,
    selectedVersionId?: string,
  ): Promise<HttpOperationResult<SimulationDetail>> {
    const detail = this.database.educator.detail(simulationId)
    if (!detail.ok) return fromPersistence(detail)
    if (detail.value.bundledExample !== null) {
      return failed('conflict', 'Bundled examples are served from the immutable seed catalog.')
    }
    const selected =
      selectedVersionId === undefined
        ? detail.value.latestVersion
        : detail.value.versions.find(({ id }) => id === selectedVersionId)
    if (selected === undefined) return failed('not-found', 'Simulation version was not found.')
    const current = await this.reports.versionDetail(detail.value.latestVersion)
    const selectedDetail =
      selected.id === detail.value.latestVersion.id
        ? undefined
        : await this.reports.versionDetail(selected)
    if (!current.ok) return current
    if (selectedDetail !== undefined && !selectedDetail.ok) return selectedDetail
    return succeeded({
      simulation: {
        id: detail.value.simulation.id,
        title: detail.value.simulation.title,
        source: { kind: 'teacher' },
        currentVersion: current.value.summary,
        createdAt: detail.value.simulation.createdAt,
        updatedAt: detail.value.simulation.updatedAt,
      },
      selectedVersion: selectedDetail?.ok ? selectedDetail.value : current.value,
    })
  }

  async history(simulationId: string): Promise<HttpOperationResult<VersionHistory>> {
    const versions = this.database.educator.versions(simulationId)
    if (!versions.ok) return fromPersistence(versions)
    const details: EducatorVersionDetail[] = []
    for (const version of versions.value) {
      const detail = await this.reports.versionDetail(version)
      if (!detail.ok) return detail
      details.push(detail.value)
    }
    return succeeded({
      simulationId,
      versions: details,
    })
  }

  async compare(
    simulationId: string,
    leftVersionId: string,
    rightVersionId: string,
  ): Promise<HttpOperationResult<VersionComparison>> {
    if (leftVersionId === rightVersionId) {
      return failed('invalid-input', 'Version comparison requires distinct versions.')
    }
    const leftVersion = this.database.educator.versionForSimulation(leftVersionId, simulationId)
    const rightVersion = this.database.educator.versionForSimulation(rightVersionId, simulationId)
    if (!leftVersion.ok) return persistenceFailure(leftVersion)
    if (!rightVersion.ok) return persistenceFailure(rightVersion)
    const [left, right, leftEvidence, rightEvidence] = await Promise.all([
      this.reports.versionDetail(leftVersion.value),
      this.reports.versionDetail(rightVersion.value),
      this.reports.comparisonEvidence(leftVersionId),
      this.reports.comparisonEvidence(rightVersionId),
    ])
    if (!left.ok) return left
    if (!right.ok) return right
    if (!leftEvidence.ok) return leftEvidence
    if (!rightEvidence.ok) return rightEvidence
    return succeeded({
      simulationId,
      left: left.value,
      right: right.value,
      rows: comparisonRowsFor(left.value, right.value, leftEvidence.value, rightEvidence.value),
    })
  }
}
