import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalNdjsonLogStore } from '@simproof/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseEnvironment } from '../config/environment.js'
import { createObservabilityRuntime } from './observability-runtime.js'

const roots: string[] = []
const NOW = Date.parse('2026-07-17T12:00:00.000Z')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true })))
})

const configuration = async (telemetryEnabled = false) => {
  const root = await mkdtemp(join(tmpdir(), 'simproof-observability-runtime-'))
  roots.push(root)
  return parseEnvironment({
    NODE_ENV: 'production',
    SIMPROOF_DEPLOYMENT_MODE: 'network',
    SIMPROOF_DATABASE_PATH: join(root, 'metadata.sqlite'),
    SIMPROOF_ARTIFACT_ROOT: join(root, 'artifacts'),
    SIMPROOF_DIAGNOSTIC_LOG_ROOT: join(root, 'diagnostics'),
    SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
    SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
    SIMPROOF_ALLOWED_ORIGINS: 'https://simproof.example.edu',
    SIMPROOF_TELEMETRY_ENABLED: String(telemetryEnabled),
    ...(telemetryEnabled
      ? { SIMPROOF_TELEMETRY_ENDPOINT: 'https://telemetry.example.edu/v1/metrics' }
      : {}),
  })
}

describe('application observability runtime', () => {
  it('writes strict local signals while constructing no exporter by default', async () => {
    const config = await configuration()
    const transportFactory = vi.fn()
    const runtime = createObservabilityRuntime(config, {
      clock: () => NOW,
      telemetryTransportFactory: transportFactory,
    })

    runtime.context.run({ requestId: '019f6bc1-0811-70c1-a139-938a3ad2dee0' }, () => {
      runtime.logger.emit({
        severity: 'info',
        component: 'web-api',
        event: 'http.request.completed',
        attributes: { operation: 'health-check', statusCode: 200 },
      })
    })
    await runtime.close()

    const stored = new LocalNdjsonLogStore({
      root: config.observability.diagnosticLogRoot,
      maxEventBytes: 16_384,
      maxFileBytes: config.observability.maxFileBytes,
      maxFiles: config.observability.retainedFiles,
    }).readRecent({ limit: 10 })
    expect(stored.events).toHaveLength(1)
    expect(transportFactory).not.toHaveBeenCalled()
  })

  it('exports a final low-cardinality snapshot only after explicit enablement', async () => {
    const config = await configuration(true)
    const exportMetrics = vi.fn().mockResolvedValue(undefined)
    const shutdown = vi.fn().mockResolvedValue(undefined)
    const transportFactory = vi.fn(() => ({ exportMetrics, shutdown }))
    const runtime = createObservabilityRuntime(config, {
      telemetryTransportFactory: transportFactory,
    })
    runtime.metrics.record({ kind: 'verdict', verdict: 'verified' })

    await runtime.close()

    expect(transportFactory).toHaveBeenCalledOnce()
    expect(exportMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ verdicts: [{ verdict: 'verified', count: 1 }] }),
      undefined,
    )
    expect(shutdown).toHaveBeenCalledOnce()
  })
})
