import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createPersistence } from '@simproof/persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProcessDiagnosticBundle } from './diagnostics-process.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'simproof-diagnostics-process-'))
  roots.push(directory)
  return directory
}

describe('read-only process diagnostic collection', () => {
  it('inspects a current migration journal and strictly parses the optional local log', async () => {
    const directory = await root()
    const databasePath = join(directory, 'metadata.sqlite')
    const artifactRoot = join(directory, 'artifacts')
    const logRoot = join(directory, 'diagnostics')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    await mkdir(logRoot, { mode: 0o700 })
    await writeFile(
      join(logRoot, 'operational.ndjson'),
      `${JSON.stringify({
        schemaVersion: '1',
        occurredAt: '2026-07-17T12:00:00.000Z',
        severity: 'info',
        component: 'diagnostics',
        event: 'diagnostics.bundle-created',
      })}\nnot-json\n`,
      { mode: 0o600 },
    )

    const bundle = await createProcessDiagnosticBundle(
      { includeLogs: true, maxLogEvents: 10 },
      {
        NODE_ENV: 'development',
        SIMPROOF_DATABASE_PATH: databasePath,
        SIMPROOF_ARTIFACT_ROOT: artifactRoot,
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-value-with-enough-entropy',
        SIMPROOF_SESSION_SECRET: 'session-secret-value-with-enough-entropy-123',
        SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:3000',
        SIMPROOF_DIAGNOSTIC_LOG_ROOT: logRoot,
      },
    )

    expect(bundle.versions).toMatchObject({
      simproof: '0.0.0',
      orchestrator: '0.0.0',
      databaseSchema: 5,
    })
    expect(bundle.migration).toEqual({
      status: 'current',
      expectedVersion: 5,
      appliedVersions: [1, 2, 3, 4, 5],
      checksumValid: true,
    })
    expect(bundle.readiness).toEqual({ status: 'ready' })
    expect(bundle.logs).toMatchObject({ rejectedCount: 1, truncated: false })
    expect(bundle.logs?.events).toHaveLength(1)
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain(databasePath)
    expect(serialized).not.toContain(artifactRoot)
    expect(serialized).not.toContain(logRoot)
    expect(serialized).not.toContain('bootstrap-secret-value')
    expect(serialized).not.toContain('session-secret-value')
  })

  it('reports missing migration state without creating a database or adding logs by default', async () => {
    const directory = await root()
    const databasePath = join(directory, 'absent.sqlite')
    const bundle = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10 },
      {
        NODE_ENV: 'development',
        SIMPROOF_DATABASE_PATH: databasePath,
        SIMPROOF_ARTIFACT_ROOT: join(directory, 'artifacts'),
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-value-with-enough-entropy',
        SIMPROOF_SESSION_SECRET: 'session-secret-value-with-enough-entropy-123',
      },
    )
    expect(bundle.migration.status).toBe('unavailable')
    expect(bundle.readiness).toEqual({ status: 'not-ready', errorId: 'database.unavailable' })
    expect(bundle).not.toHaveProperty('logs')
    await expect(lstat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses exact migration and artifact readiness without inventing production runner wiring', async () => {
    const directory = await root()
    const databasePath = join(directory, 'metadata.sqlite')
    const artifactRoot = join(directory, 'artifacts')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    const baseline = {
      NODE_ENV: 'development',
      SIMPROOF_DATABASE_PATH: databasePath,
      SIMPROOF_ARTIFACT_ROOT: artifactRoot,
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-value-with-enough-entropy',
      SIMPROOF_SESSION_SECRET: 'session-secret-value-with-enough-entropy-123',
    }

    await writeFile(artifactRoot, 'unsafe root')
    const unsafeArtifacts = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10 },
      baseline,
    )
    expect(unsafeArtifacts.readiness).toEqual({
      status: 'not-ready',
      errorId: 'artifact-store.unavailable',
    })
    await rm(artifactRoot)

    const credentialsOnly = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10 },
      { ...baseline, OPENAI_API_KEY: 'provider-secret-value-with-enough-entropy' },
    )
    expect(credentialsOnly.readiness).toEqual({
      status: 'not-ready',
      errorId: 'configuration.invalid',
    })
    expect(JSON.stringify(credentialsOnly)).not.toContain('provider-secret-value')

    const tamper = new DatabaseSync(databasePath)
    tamper.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('0'.repeat(64))
    tamper.close()
    const drifted = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10 },
      baseline,
    )
    expect(drifted.migration).toMatchObject({ status: 'drifted', checksumValid: false })
    expect(drifted.readiness).toEqual({ status: 'not-ready', errorId: 'migration.failed' })
  })

  it('uses an explicitly injected runner probe without invoking a provider', async () => {
    const directory = await root()
    const databasePath = join(directory, 'metadata.sqlite')
    const database = createPersistence(databasePath)
    expect(database.migrate()).toMatchObject({ ok: true })
    database.close()
    const environment = {
      NODE_ENV: 'development',
      SIMPROOF_DATABASE_PATH: databasePath,
      SIMPROOF_ARTIFACT_ROOT: join(directory, 'artifacts'),
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-value-with-enough-entropy',
      SIMPROOF_SESSION_SECRET: 'session-secret-value-with-enough-entropy-123',
      OPENAI_API_KEY: 'provider-secret-value-with-enough-entropy',
      CODEX_API_KEY: 'codex-secret-value-with-enough-entropy',
      SIMPROOF_RUNNER_ENDPOINT: 'http://runner-launcher:4318',
      SIMPROOF_RUNNER_TOKEN: 'runner-secret-value-with-enough-entropy',
      SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
      SIMPROOF_RUNNER_VERSION: '1.0.0',
      SIMPROOF_OPENAI_MODEL: 'gpt-5.2',
      SIMPROOF_CODEX_MODEL: 'gpt-5.2-codex',
      SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
      SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
      SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
      SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
      SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-codex/workspaces',
      SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/state',
    }
    const healthy = vi.fn(() => ({ ok: true as const }))
    const unhealthy = vi.fn(() => ({ ok: false as const, errorId: 'runner.unavailable' as const }))

    const healthyBundle = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10, runnerReadiness: healthy },
      environment,
    )
    const unhealthyBundle = await createProcessDiagnosticBundle(
      { includeLogs: false, maxLogEvents: 10, runnerReadiness: unhealthy },
      environment,
    )

    expect(healthy).toHaveBeenCalledOnce()
    expect(unhealthy).toHaveBeenCalledOnce()
    expect(healthyBundle.readiness).toEqual({ status: 'ready' })
    expect(unhealthyBundle.readiness).toEqual({
      status: 'not-ready',
      errorId: 'runner.unavailable',
    })
    expect(JSON.stringify([healthyBundle, unhealthyBundle])).not.toContain('provider-secret-value')
  })
})
