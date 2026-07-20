import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { type LocalLogReadResult, LocalNdjsonLogReader } from '@simproof/observability'
import {
  ArtifactStore,
  CURRENT_PERSISTENCE_SCHEMA_VERSION,
  inspectPersistence,
} from '@simproof/persistence'

import {
  parseEnvironment,
  readProcessEnvironmentInput,
  type ServerConfig,
} from '../config/environment.js'
import {
  createDiagnosticBundle,
  type DiagnosticBundle,
  type DiagnosticMigrationStatus,
  type DiagnosticVersions,
  type RecentStableErrorInput,
} from './diagnostics-bundle.js'
import {
  createReadinessService,
  probeArtifactStore,
  probeConfiguration,
  type ReadinessProbe,
  type ReadinessProbeResult,
} from './readiness.js'

const MAX_LOG_EVENT_BYTES = 65_536

export interface ProcessBundleOptions {
  readonly includeLogs: boolean
  readonly maxLogEvents: number
  readonly runnerReadiness?: ReadinessProbe
}

interface ErrorRow {
  readonly stable_error_id: string
  readonly count: number
  readonly last_observed_at: string
}

interface DatabaseDiagnostics {
  readonly migration: DiagnosticMigrationStatus
  readonly readiness: ReadinessProbeResult
  readonly recentStableErrors: readonly RecentStableErrorInput[]
}

const configured = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  const value = Reflect.get(environment, name)
  return typeof value !== 'string' || value.length === 0 ? undefined : value
}

async function packageVersion(url: URL): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(url, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
      return 'unavailable'
    }
    const version = Reflect.get(parsed, 'version')
    return typeof version === 'string' && version.length > 0 && version.length <= 100
      ? version
      : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function versions(): Promise<DiagnosticVersions> {
  const [simproof, orchestrator, observability, persistence, runner, verifier] = await Promise.all([
    packageVersion(new URL('../../../../package.json', import.meta.url)),
    packageVersion(new URL('../../package.json', import.meta.url)),
    packageVersion(new URL('../../../../packages/observability/package.json', import.meta.url)),
    packageVersion(new URL('../../../../packages/persistence/package.json', import.meta.url)),
    packageVersion(new URL('../../../runner/package.json', import.meta.url)),
    packageVersion(new URL('../../../../packages/verifier/package.json', import.meta.url)),
  ])
  return {
    simproof,
    orchestrator,
    observability,
    persistence,
    runner,
    verifier,
    node: process.version.replace(/^v/u, ''),
    runnerProtocol: '1',
    databaseSchema: CURRENT_PERSISTENCE_SCHEMA_VERSION,
  }
}

function recentErrors(path: string): readonly RecentStableErrorInput[] {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(path, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      readOnly: true,
      timeout: 2_000,
    })
    database.enableDefensive(true)
    const rows = database
      .prepare(`SELECT stable_error_id,COUNT(*) AS count,MAX(observed_at) AS last_observed_at FROM (
        SELECT stable_error_id,COALESCE(completed_at,updated_at) AS observed_at
          FROM generation_pipeline_runs WHERE stable_error_id IS NOT NULL
        UNION ALL
        SELECT stable_error_id,COALESCE(completed_at,created_at) AS observed_at
          FROM generation_pipeline_attempts WHERE stable_error_id IS NOT NULL
        UNION ALL
        SELECT stable_error_id,recorded_at AS observed_at
          FROM generation_external_calls WHERE stable_error_id IS NOT NULL
      ) GROUP BY stable_error_id ORDER BY last_observed_at DESC LIMIT 1000`)
      .all() as unknown as readonly ErrorRow[]
    return rows.map((row) => ({
      stableErrorId: row.stable_error_id,
      count: row.count,
      lastObservedAt: row.last_observed_at,
    }))
  } catch {
    return []
  } finally {
    try {
      database?.close()
    } catch {
      // Collection never exposes a raw database close error.
    }
  }
}

function databaseDiagnostics(
  config: ServerConfig,
  databasePathExplicitlyConfigured: boolean,
): DatabaseDiagnostics {
  const inspected = inspectPersistence(config.databasePath)
  if (!inspected.ok) {
    return {
      migration: {
        status: databasePathExplicitlyConfigured ? 'unavailable' : 'missing',
        expectedVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION,
        appliedVersions: [],
        checksumValid: null,
      },
      readiness: { ok: false, errorId: 'database.unavailable' },
      recentStableErrors: [],
    }
  }
  const current = inspected.value.status === 'current'
  return {
    migration: {
      status: current ? 'current' : 'drifted',
      expectedVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION,
      appliedVersions: [...inspected.value.appliedVersions],
      checksumValid: inspected.value.checksumsValid,
    },
    readiness: current ? { ok: true } : { ok: false, errorId: 'migration.failed' },
    recentStableErrors: current ? recentErrors(config.databasePath) : [],
  }
}

function unavailableDatabaseDiagnostics(
  databasePathExplicitlyConfigured: boolean,
): DatabaseDiagnostics {
  return {
    migration: {
      status: databasePathExplicitlyConfigured ? 'unavailable' : 'missing',
      expectedVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION,
      appliedVersions: [],
      checksumValid: null,
    },
    readiness: { ok: false, errorId: 'database.unavailable' },
    recentStableErrors: [],
  }
}

function recentLogs(
  config: ServerConfig | undefined,
  includeLogs: boolean,
  limit: number,
): LocalLogReadResult {
  if (!includeLogs || config === undefined) {
    return { available: false, events: [], rejectedLineCount: 0, truncated: false }
  }
  try {
    return new LocalNdjsonLogReader({
      root: config.observability.diagnosticLogRoot,
      maxEventBytes: MAX_LOG_EVENT_BYTES,
      maxFileBytes: config.observability.maxFileBytes,
      maxFiles: config.observability.retainedFiles,
    }).readRecent({ limit })
  } catch {
    return { available: false, events: [], rejectedLineCount: 0, truncated: false }
  }
}

const sensitiveValues = (environment: Readonly<Record<string, string | undefined>>) => ({
  apiKeys: [
    configured(environment, 'OPENAI_API_KEY'),
    configured(environment, 'CODEX_API_KEY'),
  ].filter((value): value is string => value !== undefined),
  accessTokens: [configured(environment, 'SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN')].filter(
    (value): value is string => value !== undefined,
  ),
  passwords: [
    configured(environment, 'SIMPROOF_ADMIN_BOOTSTRAP_SECRET'),
    configured(environment, 'SIMPROOF_SESSION_SECRET'),
  ].filter((value): value is string => value !== undefined),
})

export async function createProcessDiagnosticBundle(
  options: ProcessBundleOptions,
  environment: Readonly<Record<string, string | undefined>> = readProcessEnvironmentInput(),
): Promise<DiagnosticBundle> {
  let config: ServerConfig | undefined
  try {
    config = parseEnvironment(environment)
  } catch {
    config = undefined
  }
  const valid = config !== undefined
  const databasePathExplicitlyConfigured =
    configured(environment, 'SIMPROOF_DATABASE_PATH') !== undefined
  const database =
    config === undefined
      ? unavailableDatabaseDiagnostics(databasePathExplicitlyConfigured)
      : databaseDiagnostics(config, databasePathExplicitlyConfigured)
  const readiness = await createReadinessService({
    configuration: () =>
      config === undefined
        ? { ok: false, errorId: 'configuration.invalid' }
        : probeConfiguration(config),
    database: () => database.readiness,
    artifacts: () =>
      config === undefined
        ? { ok: false, errorId: 'artifact-store.unavailable' }
        : probeArtifactStore(new ArtifactStore(config.artifactRoot)),
    ...(options.runnerReadiness === undefined ? {} : { runner: options.runnerReadiness }),
  }).check()
  const logs = recentLogs(config, options.includeLogs, options.maxLogEvents)
  return createDiagnosticBundle({
    bundleId: randomUUID(),
    createdAt: new Date().toISOString(),
    versions: await versions(),
    configurationValid: valid,
    environment,
    migration: database.migration,
    readiness,
    recentStableErrors: database.recentStableErrors,
    recentLogs: logs.events,
    recentLogRejectedCount: logs.rejectedLineCount,
    recentLogsTruncated: logs.truncated,
    includeLogs: options.includeLogs,
    maxLogEvents: options.maxLogEvents,
    sensitiveValues: sensitiveValues(environment),
  })
}
