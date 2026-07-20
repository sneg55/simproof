import {
  type LibraryPage,
  libraryPageSchema,
  type NormalizedPreview,
  previewRequestSchema,
  type SimulationDetail,
  simulationDetailSchema,
  type VerificationReportDisplay,
} from '@simproof/contracts'

import { buildNormalizedPreview } from '../preview/normalized-preview.js'
import {
  BUNDLED_SEED_DEFINITIONS,
  BUNDLED_SEED_TIMESTAMP,
  BUNDLED_SEED_VERSION_REVISION,
  type BundledSeedDefinition,
} from './bundled-seed-definitions.js'
import { reportHash, verificationDisplayFor } from './bundled-seed-evidence.js'

export type SeedCatalogResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: { readonly code: 'invalid-input' | 'not-found'; readonly message: string }
    }

export interface BundledSeedCatalog {
  readonly list: () => LibraryPage
  readonly detail: (seedId: string) => SeedCatalogResult<SimulationDetail>
  readonly report: (seedId: string) => SeedCatalogResult<VerificationReportDisplay>
  readonly preview: (seedId: string, request: unknown) => SeedCatalogResult<NormalizedPreview>
}

interface CatalogEntry {
  readonly definition: BundledSeedDefinition
  readonly report: VerificationReportDisplay
  readonly detail: SimulationDetail
}

const INVALID_INPUT = 'invalid-input' as const

const fail = (code: 'invalid-input' | 'not-found', message: string): SeedCatalogResult<never> => ({
  ok: false,
  error: { code, message },
})

const succeed = <T>(value: T): SeedCatalogResult<T> => ({ ok: true, value })

function detailFor(
  definition: BundledSeedDefinition,
  report: VerificationReportDisplay,
): SimulationDetail {
  const verification = {
    status: 'current' as const,
    verificationRunId: report.verificationRunId,
    verdict: report.report.verdict,
    artifactHash: report.report.artifact.hash,
    reportHash: reportHash(report),
  }
  const version = {
    id: definition.identity.versionId,
    versionNumber: 1,
    state: 'verified' as const,
    revision: BUNDLED_SEED_VERSION_REVISION,
    domain: definition.metadata.domain,
    verification,
    updatedAt: BUNDLED_SEED_TIMESTAMP,
  }
  return simulationDetailSchema.parse({
    simulation: {
      id: definition.identity.simulationId,
      title: definition.metadata.title,
      source: { kind: 'seed', seed: definition.metadata },
      currentVersion: version,
      createdAt: BUNDLED_SEED_TIMESTAMP,
      updatedAt: BUNDLED_SEED_TIMESTAMP,
    },
    selectedVersion: {
      summary: version,
      conceptSpec: definition.conceptSpec,
      exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
      generationProvenance: null,
      lineage: null,
      availableActions: ['preview', 'view-report'],
      createdAt: BUNDLED_SEED_TIMESTAMP,
    },
  })
}

function createEntry(definition: BundledSeedDefinition): CatalogEntry {
  const report = verificationDisplayFor(definition)
  if (!report.badgeActive || report.validity.status !== 'current') {
    throw new TypeError(`Bundled seed ${definition.metadata.seedId} is not currently verified.`)
  }
  return Object.freeze({ definition, report, detail: detailFor(definition, report) })
}

function evidenceFor(entry: CatalogEntry) {
  return {
    verificationRunId: entry.report.verificationRunId,
    artifactHash: entry.report.report.artifact.hash,
    validity: entry.report.validity,
    assumptions: entry.report.report.assumptions,
    limitations: entry.report.report.limitations,
  }
}

export function createBundledSeedCatalog(): BundledSeedCatalog {
  const entries = BUNDLED_SEED_DEFINITIONS.map(createEntry)
  const byId = new Map(entries.map((entry) => [entry.definition.metadata.seedId, entry]))
  const list = libraryPageSchema.parse({
    items: entries.map(({ detail }) => detail.simulation),
    nextCursor: null,
  })
  const find = (seedId: string) => byId.get(seedId)
  const catalog: BundledSeedCatalog = {
    list: () => structuredClone(list),
    detail: (seedId: string): SeedCatalogResult<SimulationDetail> => {
      const entry = find(seedId)
      return entry === undefined
        ? fail('not-found', 'Bundled seed was not found.')
        : succeed(structuredClone(entry.detail))
    },
    report: (seedId: string): SeedCatalogResult<VerificationReportDisplay> => {
      const entry = find(seedId)
      return entry === undefined
        ? fail('not-found', 'Bundled seed was not found.')
        : succeed(structuredClone(entry.report))
    },
    preview: (seedId: string, input: unknown): SeedCatalogResult<NormalizedPreview> => {
      const entry = find(seedId)
      if (entry === undefined) return fail('not-found', 'Bundled seed was not found.')
      const request = previewRequestSchema.safeParse(input)
      if (!request.success) return fail(INVALID_INPUT, 'Preview request is invalid.')
      if (request.data.expectedVersionRevision !== BUNDLED_SEED_VERSION_REVISION) {
        return fail(INVALID_INPUT, 'Bundled seed version changed; refresh before previewing.')
      }
      if (request.data.domain !== entry.definition.conceptSpec.domain) {
        return fail(INVALID_INPUT, 'Preview domain does not match the bundled seed.')
      }
      const preview = buildNormalizedPreview(request.data, {
        simulationVersionId: entry.definition.identity.versionId,
        conceptSpec: entry.definition.conceptSpec,
        renderer: entry.definition.renderer,
        evidence: evidenceFor(entry),
      })
      return preview === undefined
        ? fail(INVALID_INPUT, 'Preview request is outside the reviewed concept bounds.')
        : succeed(preview)
    },
  }
  return Object.freeze(catalog)
}
