import type {
  ArtifactBundle,
  NormalizedPreview,
  PreviewRequest,
  SimulationVersion,
  VerificationReportDisplay,
} from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase, VerificationRun } from '@simproof/persistence'
import { getDomainPack, hashCanonicalJson } from '@simproof/verifier'
import { describe, expect, it, vi } from 'vitest'

import type { ServerConfig } from '../config/environment.js'
import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import type { EducatorPreviewPort } from './ports.js'
import { createEducatorService } from './service.js'

const IDS = [
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000005',
  '40000000-0000-4000-8000-000000000006',
] as const
const REQUEST: PreviewRequest = {
  domain: 'projectile',
  expectedVersionRevision: 4,
  input: { initialSpeedMps: 20, launchAngleDeg: 45 },
  sampleCount: 5,
}

describe('generated preview trust binding', () => {
  it.each([
    [
      'cross-version output',
      (value: NormalizedPreview) => ({ ...value, simulationVersionId: IDS[5] }),
    ],
    [
      'request input mismatch',
      (value: NormalizedPreview) =>
        value.domain === 'projectile'
          ? { ...value, input: { ...value.input, initialSpeedMps: 21 } }
          : value,
    ],
    [
      'sample-count mismatch',
      (value: NormalizedPreview) => ({ ...value, samples: value.samples.slice(0, 4) }),
    ],
    [
      'verification-run mismatch',
      (value: NormalizedPreview) => ({
        ...value,
        evidence: { ...value.evidence, verificationRunId: IDS[5] },
      }),
    ],
    [
      'artifact mismatch',
      (value: NormalizedPreview) => ({
        ...value,
        evidence: { ...value.evidence, artifactHash: `sha256:${'f'.repeat(64)}` as const },
      }),
    ],
    [
      'concept mismatch',
      (value: NormalizedPreview) => ({
        ...value,
        conceptSpec: { ...value.conceptSpec, title: 'Unreviewed concept' },
      }),
    ],
    [
      'assumption mismatch',
      (value: NormalizedPreview) => ({
        ...value,
        evidence: { ...value.evidence, assumptions: ['Adapter-supplied assumption.'] },
      }),
    ],
    [
      'limitation mismatch',
      (value: NormalizedPreview) => ({
        ...value,
        evidence: { ...value.evidence, limitations: ['Adapter-supplied limitation.'] },
      }),
    ],
  ] as const)('rejects %s from the adapter', async (_label, corrupt) => {
    const context = previewContext()
    const preview = vi.fn<EducatorPreviewPort['preview']>().mockResolvedValue({
      ok: true,
      value: corrupt(context.preview) as NormalizedPreview,
    })
    const service = serviceFor(context, preview)

    expect(
      await service.previewVersion(context.version.id, REQUEST, 'owned-session'),
    ).toMatchObject({
      ok: false,
      error: { code: 'operation-failed' },
    })
  })

  it('does not call the adapter when validity is stale after trusted refresh', async () => {
    const context = previewContext({ stale: true })
    const preview = vi.fn<EducatorPreviewPort['preview']>()
    const service = serviceFor(context, preview)

    expect(
      await service.previewVersion(context.version.id, REQUEST, 'owned-session'),
    ).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(preview).not.toHaveBeenCalled()
  })

  it('accepts structurally identical request input with a different key insertion order', async () => {
    const context = previewContext()
    const preview = vi.fn<EducatorPreviewPort['preview']>().mockResolvedValue({
      ok: true,
      value: context.preview,
    })
    const service = serviceFor(context, preview)
    const reordered: PreviewRequest = {
      ...REQUEST,
      input: { launchAngleDeg: 45, initialSpeedMps: 20 },
    }

    expect(
      await service.previewVersion(context.version.id, reordered, 'owned-session'),
    ).toMatchObject({
      ok: true,
    })
  })

  it('does not call the adapter when the version revision changes during validity refresh', async () => {
    const context = previewContext({ revisionChangesAtRead: 3 })
    const preview = vi.fn<EducatorPreviewPort['preview']>()
    const service = serviceFor(context, preview)

    expect(
      await service.previewVersion(context.version.id, REQUEST, 'owned-session'),
    ).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(preview).not.toHaveBeenCalled()
  })
})

interface PreviewContext {
  readonly version: SimulationVersion
  readonly database: PersistenceDatabase
  readonly artifacts: ArtifactStore
  readonly preview: NormalizedPreview
  readonly run: VerificationRun
}

function previewContext(
  options: { stale?: boolean; revisionChangesAtRead?: number } = {},
): PreviewContext {
  const catalog = createBundledSeedCatalog()
  const reportResult = catalog.report('projectile.introduction')
  const previewResult = catalog.preview('projectile.introduction', REQUEST)
  if (!reportResult.ok || !previewResult.ok) throw new Error('Bundled evidence unavailable.')
  const display = reportResult.value
  const version = versionFor(display)
  const run = runFor(version, display)
  let reads = 0
  const database = {
    getVersion: () => {
      reads += 1
      const revision = reads >= (options.revisionChangesAtRead ?? Number.POSITIVE_INFINITY) ? 5 : 4
      return { ok: true as const, value: { ...version, revision } }
    },
    educator: { detail: () => ({ ok: true as const, value: { bundledExample: null } }) },
    verification: {
      get: () => ({ ok: true as const, value: run }),
      currentValidity: () => Promise.resolve({ ok: true as const, value: { status: 'current' } }),
      validity: () => ({
        ok: true as const,
        value: options.stale
          ? { status: 'stale' as const, reasons: ['policy-changed' as const] }
          : { status: 'current' as const },
      }),
    },
    maintenance: {
      exportSimulation: () =>
        Promise.resolve({ ok: true as const, value: { records: { publications: [] } } }),
    },
  } as unknown as PersistenceDatabase
  const artifacts = {
    get: (hash: string) =>
      Promise.resolve({
        ok: true as const,
        value: Buffer.from(
          JSON.stringify(hash === run.report.contentHash ? display.report : display.conceptSpec),
          'utf8',
        ),
      }),
  } as unknown as ArtifactStore
  return { version, database, artifacts, preview: previewResult.value, run }
}

function serviceFor(context: PreviewContext, preview: EducatorPreviewPort['preview']) {
  return createEducatorService({
    database: context.database,
    artifacts: context.artifacts,
    config: CONFIG,
    bootstrapAvailable: () => false,
    authorizeSession: (sessionId) => sessionId === 'owned-session',
    confirmPassword: () => Promise.resolve(false),
    createId: () => IDS[5],
    now: () => '2026-07-16T12:00:00.000Z',
    resolveInstalledEvidence: (run) => ({
      ok: true,
      value: {
        policyReferenceId: run.policyReferenceId,
        policyContentHash: run.policyContentHash,
        domainPackReferenceId: run.domainPackReferenceId,
        domainPackContentHash: run.domainPackContentHash,
        runnerVersion: run.runnerVersion,
        runnerProtocolVersion: run.runnerProtocolVersion,
        dependencies: run.dependencies,
      },
    }),
    preview: { preview },
  })
}

function versionFor(display: VerificationReportDisplay): SimulationVersion {
  return {
    id: display.simulationVersionId,
    simulationId: IDS[0],
    versionNumber: 1,
    state: 'verified',
    revision: 4,
    activeConceptSpecId: IDS[1],
    activeGeneratedArtifactId: IDS[2],
    activeArtifactBundle: bundle(display.report.artifact.hash as `sha256:${string}`),
    activeVerificationRunId: display.verificationRunId,
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  }
}

function runFor(version: SimulationVersion, display: VerificationReportDisplay): VerificationRun {
  if (version.activeArtifactBundle === null) throw new Error('Artifact bundle unavailable.')
  const pack = getDomainPack('projectile')
  return {
    id: display.verificationRunId,
    simulationVersionId: version.id,
    conceptSpecId: IDS[1],
    conceptSpecArtifact: {
      artifactId: IDS[3],
      role: 'concept-spec',
      contentHash: display.report.conceptSpecHash,
    },
    generatedArtifactId: IDS[2],
    artifactBundle: version.activeArtifactBundle,
    policyReferenceId: IDS[4],
    domainPackReferenceId: IDS[5],
    policyContentHash: hashCanonicalJson(pack.policy),
    domainPackContentHash: pack.contentHash,
    runnerVersion: display.report.runner.version,
    runnerProtocolVersion: display.report.runner.protocolVersion,
    dependencies: { schemaVersion: '1', entries: [], contentHash: `sha256:${'d'.repeat(64)}` },
    observationHash: display.report.observationHash,
    report: {
      artifactId: IDS[5],
      role: 'verification-report',
      contentHash: hashCanonicalJson(display.report),
    },
    verdict: display.report.verdict,
    createdAt: display.report.createdAt,
  }
}

function bundle(coreHash: `sha256:${string}`): ArtifactBundle {
  return {
    core: { artifactId: IDS[3], role: 'core-source', contentHash: coreHash },
    renderer: {
      artifactId: IDS[4],
      role: 'renderer-data',
      contentHash: `sha256:${'b'.repeat(64)}`,
    },
    manifest: { artifactId: IDS[5], role: 'manifest', contentHash: `sha256:${'c'.repeat(64)}` },
  }
}

const CONFIG = {
  environment: 'test',
  deploymentMode: 'loopback',
  databasePath: '/tmp/simproof.sqlite',
  artifactRoot: '/tmp/simproof-artifacts',
  allowedOrigins: ['http://127.0.0.1:3000'],
  trustedProxyAddress: undefined,
  adminBootstrapSecret: undefined,
  sessionSecret: undefined,
  localAuthBypass: false,
  providers: { openaiApiKey: undefined, codexApiKey: undefined },
  session: { ttlSeconds: 3600, idleSeconds: 900, maxActiveSessions: 3 },
  request: { maxBytes: 1_000_000, maxPromptCharacters: 10_000 },
  privacy: {
    promptRetention: 'discard',
    telemetryEnabled: false,
    externalDiagnosticsEnabled: false,
  },
  externalDiagnostics: { endpoint: undefined, token: undefined },
  telemetry: { endpoint: undefined },
  observability: {
    diagnosticLogRoot: '/tmp/simproof-preview-trust-diagnostics',
    maxFileBytes: 8_388_608,
    retainedFiles: 3,
  },
} satisfies ServerConfig
