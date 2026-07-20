import {
  type NormalizedPreview,
  normalizedPreviewSchema,
  type PreviewRequest,
  type VerificationReportDisplay,
} from '@simproof/contracts'
import { hashCanonicalJson, isPublishable } from '@simproof/verifier'

import { toPublicRuntimeConfig } from '../config/environment.js'
import type { EducatorHttpCallbacks, HttpOperationResult } from '../http/types.js'
import { createVersionPreviewProducer } from '../preview/version-preview-producer.js'
import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { EducatorCommands } from './commands.js'
import { EducatorLibraryProjection } from './library-projection.js'
import type { EducatorServiceOptions } from './ports.js'
import { EducatorReportProjection } from './report-projection.js'
import { failed, fromPersistence, succeeded, unavailable } from './results.js'

export function createEducatorService(options: EducatorServiceOptions): EducatorHttpCallbacks {
  const seeds = createBundledSeedCatalog()
  const reports = new EducatorReportProjection(
    options.database,
    options.artifacts,
    options.resolveInstalledEvidence,
    options.findingExplainer,
  )
  const library = new EducatorLibraryProjection(options.database, reports)
  const commands = new EducatorCommands({
    database: options.database,
    artifacts: options.artifacts,
    library,
    createId: options.createId,
    now: options.now,
    confirmPassword: options.confirmPassword,
  })
  const authorize = <T>(
    sessionId: string,
    operation: () => HttpOperationResult<T> | Promise<HttpOperationResult<T>>,
  ) =>
    options.authorizeSession(sessionId)
      ? Promise.resolve(operation())
      : Promise.resolve(
          unavailable('Educator session is unavailable.', 'educator.session-unavailable'),
        )
  const seedMetadata = seeds
    .list()
    .items.flatMap(({ source }) => (source.kind === 'seed' ? [source.seed] : []))

  return {
    bootstrapCapability: () => succeeded({ bootstrapAvailable: options.bootstrapAvailable() }),
    runtimeConfig: (sessionId) =>
      authorize(sessionId, () =>
        succeeded({
          runtime: toPublicRuntimeConfig(options.config),
          generation: generationAvailability(options),
          seedLibraryReady: seedMetadata.length > 0,
          supportedDomains: ['pendulum', 'projectile'],
        }),
      ),
    listSeeds: (sessionId) => authorize(sessionId, () => succeeded(seedMetadata)),
    getSeed: (seedId, sessionId) => authorize(sessionId, () => seedResult(seeds.detail(seedId))),
    getSeedReport: (seedId, sessionId) =>
      authorize(sessionId, () => seedResult(seeds.report(seedId))),
    previewSeed: (seedId, input, sessionId) =>
      authorize(sessionId, () => seedResult(seeds.preview(seedId, input))),
    listSimulations: (query, sessionId) => authorize(sessionId, () => library.list(query)),
    getSimulation: (simulationId, sessionId) =>
      authorize(sessionId, () => library.detail(simulationId)),
    createSimulation: (input, sessionId) => authorize(sessionId, () => commands.create(input)),
    versionHistory: (simulationId, sessionId) =>
      authorize(sessionId, () => library.history(simulationId)),
    compareVersions: (simulationId, left, right, sessionId) =>
      authorize(sessionId, () => library.compare(simulationId, left, right)),
    startBlankVersion: (simulationId, input, sessionId) =>
      authorize(sessionId, () => commands.startBlankVersion(simulationId, input)),
    duplicateSimulation: (simulationId, input, sessionId) =>
      authorize(sessionId, () => commands.duplicate(simulationId, input)),
    startGeneration: (input, sessionId) =>
      generationVersionOperation({
        options,
        sessionId,
        versionId: input.simulationVersionId,
        expectedRevision: input.expectedVersionRevision,
        invoke: (port) => port.start(input, sessionId),
      }),
    generationStatus: (runId, sessionId) =>
      generationOperation(options, sessionId, (port) => port.status(runId, sessionId)),
    decideConcept: (runId, input, sessionId) =>
      generationOperation(options, sessionId, (port) => port.decide(runId, input, sessionId)),
    cancelGeneration: (runId, input, sessionId) =>
      generationOperation(options, sessionId, (port) => port.cancel(runId, input, sessionId)),
    getReport: (versionId, sessionId) => authorize(sessionId, () => reports.display(versionId)),
    publishVersion: (versionId, input, sessionId) =>
      authorize(sessionId, () => commands.publish(versionId, input)),
    archiveVersion: (versionId, input, sessionId) =>
      authorize(sessionId, () => commands.archive(versionId, input)),
    reverifyVersion: (versionId, input, sessionId) =>
      generationVersionOperation({
        options,
        sessionId,
        versionId,
        expectedRevision: input.expectedRevision,
        invoke: (port) => port.reverify(versionId, input, sessionId),
      }),
    exportSimulation: (input, sessionId) =>
      authorize(sessionId, () => commands.export(input, sessionId)),
    previewVersion: (versionId, input, sessionId) =>
      previewOperation(options, reports, { sessionId, versionId, input }),
  }
}

function generationAvailability(options: EducatorServiceOptions) {
  if (options.generationDisabled)
    return { available: false as const, reason: 'generation-disabled' as const }
  const demo = options.config.demoGeneration === true
  if (!demo && !toPublicRuntimeConfig(options.config).providerConfigured) {
    return { available: false as const, reason: 'provider-not-configured' as const }
  }
  if (options.generation === undefined) {
    return { available: false as const, reason: 'runner-unavailable' as const }
  }
  return demo ? { available: true as const, demo: true as const } : { available: true as const }
}

async function generationOperation<T>(
  options: EducatorServiceOptions,
  sessionId: string,
  invoke: (
    port: NonNullable<EducatorServiceOptions['generation']>,
  ) => Promise<HttpOperationResult<T>>,
): Promise<HttpOperationResult<T>> {
  if (!options.authorizeSession(sessionId))
    return unavailable('Educator session is unavailable.', 'educator.session-unavailable')
  return options.generation === undefined
    ? unavailable(
        'Generation coordinator is unavailable.',
        'educator.generation-coordinator-unavailable',
      )
    : await invoke(options.generation)
}

async function generationVersionOperation<T>(input: {
  readonly options: EducatorServiceOptions
  readonly sessionId: string
  readonly versionId: string
  readonly expectedRevision: number
  readonly invoke: (
    port: NonNullable<EducatorServiceOptions['generation']>,
  ) => Promise<HttpOperationResult<T>>
}): Promise<HttpOperationResult<T>> {
  const { expectedRevision, invoke, options, sessionId, versionId } = input
  const owned = ownedVersion(options, sessionId, versionId, expectedRevision)
  if (!owned.ok) return owned
  return await generationOperation(options, sessionId, invoke)
}

async function previewOperation(
  options: EducatorServiceOptions,
  reports: EducatorReportProjection,
  command: {
    readonly sessionId: string
    readonly versionId: string
    readonly input: PreviewRequest
  },
) {
  const { input, sessionId, versionId } = command
  const owned = ownedVersion(options, sessionId, versionId, input.expectedVersionRevision)
  if (!owned.ok) return owned
  const authority = await reports.display(versionId)
  if (!authority.ok) return authority
  if (
    !isPublishable(authority.value.report, authority.value.validity) ||
    !authority.value.badgeActive
  ) {
    return failed(
      'conflict',
      'Preview requires current verified evidence.',
      'educator.preview-not-current',
    )
  }
  const refreshed = ownedVersion(options, sessionId, versionId, input.expectedVersionRevision)
  if (!refreshed.ok) return refreshed
  const producer = options.preview ?? createVersionPreviewProducer(reports)
  const adapter = await producer.preview(versionId, input, sessionId)
  if (!adapter.ok) return adapter
  const unchanged = ownedVersion(options, sessionId, versionId, input.expectedVersionRevision)
  if (!unchanged.ok) return unchanged
  const parsed = normalizedPreviewSchema.safeParse(adapter.value)
  if (!parsed.success || !previewBindingsMatch(parsed.data, input, authority.value)) {
    return failed(
      'operation-failed',
      'Generated preview differs from trusted evidence.',
      'educator.preview-evidence-mismatch',
    )
  }
  return succeeded(parsed.data)
}

function previewBindingsMatch(
  preview: NormalizedPreview,
  request: PreviewRequest,
  authority: VerificationReportDisplay,
): boolean {
  return (
    preview.simulationVersionId === authority.simulationVersionId &&
    preview.domain === request.domain &&
    hashCanonicalJson(preview.input) === hashCanonicalJson(request.input) &&
    preview.samples.length === request.sampleCount &&
    hashCanonicalJson(preview.conceptSpec) === hashCanonicalJson(authority.conceptSpec) &&
    hashCanonicalJson(preview.conceptSpec) === authority.report.conceptSpecHash &&
    preview.evidence.verificationRunId === authority.verificationRunId &&
    preview.evidence.artifactHash === authority.report.artifact.hash &&
    preview.evidence.validity.status === 'current' &&
    JSON.stringify(preview.evidence.assumptions) === JSON.stringify(authority.report.assumptions) &&
    JSON.stringify(preview.evidence.limitations) === JSON.stringify(authority.report.limitations)
  )
}

function ownedVersion(
  options: EducatorServiceOptions,
  sessionId: string,
  versionId: string,
  expectedRevision: number,
): HttpOperationResult<true> {
  if (!options.authorizeSession(sessionId))
    return unavailable('Educator session is unavailable.', 'educator.session-unavailable')
  const version = options.database.getVersion(versionId)
  if (!version.ok) return fromPersistence(version)
  if (version.value.revision !== expectedRevision) {
    return failed(
      'conflict',
      'Simulation version changed concurrently.',
      'educator.version-revision-conflict',
    )
  }
  const owner = options.database.educator.detail(version.value.simulationId)
  if (!owner.ok) return fromPersistence(owner)
  return owner.value.bundledExample === null
    ? succeeded(true)
    : failed('conflict', 'Bundled examples cannot be changed through teacher commands.')
}

function seedResult<T>(result: {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly code: 'invalid-input' | 'not-found'; readonly message: string }
}): HttpOperationResult<T> {
  if (result.ok && result.value !== undefined) return succeeded(result.value)
  return failed(
    result.error?.code ?? 'operation-failed',
    result.error?.message ?? 'Seed operation failed.',
  )
}
