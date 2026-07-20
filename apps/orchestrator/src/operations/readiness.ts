import type { OperationalErrorId } from '@simproof/observability'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'

import type { ServerConfig } from '../config/environment.js'
import { invalidStorageConfigurationFields } from '../config/environment-storage.js'

export type ReadinessFailureId = Extract<
  OperationalErrorId,
  | 'artifact-store.unavailable'
  | 'configuration.invalid'
  | 'database.unavailable'
  | 'migration.failed'
  | 'runner.unavailable'
>

export type ReadinessProbeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorId: ReadinessFailureId }

export type ReadinessProbe = () => ReadinessProbeResult | Promise<ReadinessProbeResult>

export interface ReadinessProbes {
  readonly configuration: ReadinessProbe
  readonly database: ReadinessProbe
  readonly artifacts: ReadinessProbe
  readonly runnerRequired?: boolean
  readonly runner?: ReadinessProbe
}

export type ReadinessReport =
  | { readonly status: 'ready' }
  | { readonly status: 'not-ready'; readonly errorId: ReadinessFailureId }

export interface ReadinessService {
  check(): Promise<ReadinessReport>
}

const FAILURE_PRIORITY = [
  'configuration.invalid',
  'migration.failed',
  'database.unavailable',
  'artifact-store.unavailable',
  'runner.unavailable',
] as const satisfies readonly ReadinessFailureId[]

export function createReadinessService(probes: ReadinessProbes): ReadinessService {
  return {
    check: async () => {
      const results = await Promise.all([
        runProbe(probes.configuration, 'configuration.invalid'),
        runProbe(probes.database, 'database.unavailable'),
        runProbe(probes.artifacts, 'artifact-store.unavailable'),
        ...(probes.runner === undefined
          ? probes.runnerRequired === true
            ? [Promise.resolve({ ok: false as const, errorId: 'runner.unavailable' as const })]
            : []
          : [runProbe(probes.runner, 'runner.unavailable')]),
      ])
      const failures = new Set(results.flatMap((result) => (result.ok ? [] : [result.errorId])))
      const errorId = FAILURE_PRIORITY.find((candidate) => failures.has(candidate))
      return errorId === undefined ? { status: 'ready' } : { status: 'not-ready', errorId }
    },
  }
}

export function probeConfiguration(config: ServerConfig): ReadinessProbeResult {
  const valid =
    config.adminBootstrapSecret !== undefined &&
    config.sessionSecret !== undefined &&
    invalidStorageConfigurationFields({
      databasePath: config.databasePath,
      artifactRoot: config.artifactRoot,
      diagnosticLogRoot: config.observability.diagnosticLogRoot,
    }).length === 0 &&
    config.allowedOrigins.length > 0 &&
    config.session.idleSeconds <= config.session.ttlSeconds &&
    config.session.maxActiveSessions > 0 &&
    config.request.maxBytes > 0 &&
    config.request.maxPromptCharacters > 0
  return valid ? { ok: true } : { ok: false, errorId: 'configuration.invalid' }
}

export function probeDatabase(database: PersistenceDatabase): ReadinessProbeResult {
  const result = database.readiness()
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        errorId: result.reason === 'migration' ? 'migration.failed' : 'database.unavailable',
      }
}

export async function probeArtifactStore(store: ArtifactStore): Promise<ReadinessProbeResult> {
  return (await store.readiness()).ok
    ? { ok: true }
    : { ok: false, errorId: 'artifact-store.unavailable' }
}

async function runProbe(
  probe: ReadinessProbe,
  failureId: ReadinessFailureId,
): Promise<ReadinessProbeResult> {
  try {
    return await probe()
  } catch {
    return { ok: false, errorId: failureId }
  }
}
