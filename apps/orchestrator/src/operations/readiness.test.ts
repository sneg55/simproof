import { describe, expect, it, vi } from 'vitest'

import { parseEnvironment } from '../config/environment.js'
import {
  createReadinessService,
  probeConfiguration,
  type ReadinessFailureId,
  type ReadinessProbe,
} from './readiness.js'

const ready: ReadinessProbe = () => ({ ok: true })

describe('orchestrator readiness', () => {
  it('validates local configuration without requiring provider credentials', () => {
    const config = parseEnvironment({
      NODE_ENV: 'test',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      SIMPROOF_SESSION_SECRET: 'session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    })

    expect(config.providers).toEqual({ openaiApiKey: undefined, codexApiKey: undefined })
    expect(probeConfiguration(config)).toEqual({ ok: true })
    expect(probeConfiguration({ ...config, allowedOrigins: [] })).toEqual({
      ok: false,
      errorId: 'configuration.invalid',
    })
  })

  it('rejects programmatic configuration whose database and artifact storage overlap', () => {
    const config = parseEnvironment({
      NODE_ENV: 'test',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      SIMPROOF_SESSION_SECRET: 'session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    })

    for (const storage of [
      {
        databasePath: '/srv/simproof/storage/metadata.sqlite',
        artifactRoot: '/srv/simproof/storage',
      },
      {
        databasePath: '/srv/simproof/storage',
        artifactRoot: '/srv/simproof/storage/artifacts',
      },
    ]) {
      expect(probeConfiguration({ ...config, ...storage })).toEqual({
        ok: false,
        errorId: 'configuration.invalid',
      })
    }

    expect(
      probeConfiguration({
        ...config,
        databasePath: '/srv/simproof/data',
        artifactRoot: '/srv/simproof/data-artifacts',
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    {
      name: 'diagnostic root is relative',
      databasePath: '/srv/simproof/metadata.sqlite',
      artifactRoot: '/srv/simproof/artifacts',
      diagnosticLogRoot: './diagnostics',
    },
    {
      name: 'diagnostic root equals the database path',
      databasePath: '/srv/simproof/metadata.sqlite',
      artifactRoot: '/srv/simproof/artifacts',
      diagnosticLogRoot: '/srv/simproof/metadata.sqlite',
    },
    {
      name: 'diagnostic root contains the database path',
      databasePath: '/srv/simproof/diagnostics/metadata.sqlite',
      artifactRoot: '/srv/simproof/artifacts',
      diagnosticLogRoot: '/srv/simproof/diagnostics',
    },
    {
      name: 'database path contains the diagnostic root',
      databasePath: '/srv/simproof/storage',
      artifactRoot: '/srv/simproof/artifacts',
      diagnosticLogRoot: '/srv/simproof/storage/diagnostics',
    },
    {
      name: 'diagnostic root equals the artifact root',
      databasePath: '/srv/simproof/metadata.sqlite',
      artifactRoot: '/srv/simproof/artifacts',
      diagnosticLogRoot: '/srv/simproof/artifacts',
    },
    {
      name: 'diagnostic root contains the artifact root',
      databasePath: '/srv/simproof/metadata.sqlite',
      artifactRoot: '/srv/simproof/storage/artifacts',
      diagnosticLogRoot: '/srv/simproof/storage',
    },
    {
      name: 'artifact root contains the diagnostic root',
      databasePath: '/srv/simproof/metadata.sqlite',
      artifactRoot: '/srv/simproof/storage',
      diagnosticLogRoot: '/srv/simproof/storage/diagnostics',
    },
  ])('rejects programmatic configuration when $name', (storage) => {
    const config = parseEnvironment({
      NODE_ENV: 'test',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      SIMPROOF_SESSION_SECRET: 'session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    })

    expect(
      probeConfiguration({
        ...config,
        databasePath: storage.databasePath,
        artifactRoot: storage.artifactRoot,
        observability: {
          ...config.observability,
          diagnosticLogRoot: storage.diagnosticLogRoot,
        },
      }),
    ).toEqual({ ok: false, errorId: 'configuration.invalid' })
  })

  it('accepts programmatic configuration with segment-distinct sibling storage prefixes', () => {
    const config = parseEnvironment({
      NODE_ENV: 'test',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      SIMPROOF_SESSION_SECRET: 'session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    })

    expect(
      probeConfiguration({
        ...config,
        databasePath: '/srv/simproof/data',
        artifactRoot: '/srv/simproof/data-artifacts',
        observability: {
          ...config.observability,
          diagnosticLogRoot: '/srv/simproof/data-logs',
        },
      }),
    ).toEqual({ ok: true })
  })

  it('collects every required local dependency without provider access', async () => {
    const configuration = vi.fn(ready)
    const database = vi.fn(ready)
    const artifacts = vi.fn(ready)
    const runner = vi.fn(ready)
    const service = createReadinessService({ configuration, database, artifacts, runner })

    await expect(service.check()).resolves.toEqual({ status: 'ready' })
    expect(configuration).toHaveBeenCalledOnce()
    expect(database).toHaveBeenCalledOnce()
    expect(artifacts).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledOnce()
    expect(Object.keys(service)).toEqual(['check'])
  })

  it.each([
    'configuration.invalid',
    'migration.failed',
    'database.unavailable',
    'artifact-store.unavailable',
    'runner.unavailable',
  ] satisfies ReadinessFailureId[])('maps %s deterministically to not-ready', async (errorId) => {
    const service = createReadinessService({
      configuration: () =>
        errorId === 'configuration.invalid' ? { ok: false, errorId } : { ok: true },
      database: () =>
        errorId === 'migration.failed' || errorId === 'database.unavailable'
          ? { ok: false, errorId }
          : { ok: true },
      artifacts: () =>
        errorId === 'artifact-store.unavailable' ? { ok: false, errorId } : { ok: true },
      runner: () => (errorId === 'runner.unavailable' ? { ok: false, errorId } : { ok: true }),
    })

    await expect(service.check()).resolves.toEqual({ status: 'not-ready', errorId })
  })

  it('uses fixed priority rather than probe completion order and catches probe failures', async () => {
    const service = createReadinessService({
      configuration: () =>
        Promise.resolve({ ok: false, errorId: 'configuration.invalid' as const }),
      database: () => ({ ok: false, errorId: 'database.unavailable' }),
      artifacts: () => {
        throw new TypeError('secret storage detail')
      },
      runner: () => ({ ok: false, errorId: 'runner.unavailable' }),
    })

    await expect(service.check()).resolves.toEqual({
      status: 'not-ready',
      errorId: 'configuration.invalid',
    })
  })

  it('does not require a runner when generation is disabled', async () => {
    const service = createReadinessService({
      configuration: ready,
      database: ready,
      artifacts: ready,
    })

    await expect(service.check()).resolves.toEqual({ status: 'ready' })
  })

  it('fails closed when the caller requires runner readiness without a runner probe', async () => {
    const service = createReadinessService({
      configuration: ready,
      database: ready,
      artifacts: ready,
      runnerRequired: true,
    })

    await expect(service.check()).resolves.toEqual({
      status: 'not-ready',
      errorId: 'runner.unavailable',
    })
  })
})
