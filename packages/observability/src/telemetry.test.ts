import { describe, expect, it, vi } from 'vitest'

import { createTelemetryExporter, defaultTelemetryConfig, type MetricsSnapshot } from './index.js'

describe('optional telemetry export', () => {
  it('is disabled by default and makes zero transport calls', async () => {
    const exportMetrics = vi.fn()
    const transportFactory = vi.fn(() => ({ exportMetrics, shutdown: vi.fn() }))
    const exporter = createTelemetryExporter({ transportFactory })
    await expect(exporter.export({ metrics: emptyMetrics })).resolves.toEqual({
      ok: true,
      exported: false,
    })
    expect(defaultTelemetryConfig).toEqual({ enabled: false })
    expect(transportFactory).not.toHaveBeenCalled()
    expect(exportMetrics).not.toHaveBeenCalled()
  })

  it('exports only after an explicit HTTPS endpoint and transport are configured', async () => {
    const exportMetrics = vi.fn().mockResolvedValue(undefined)
    const exporter = createTelemetryExporter({
      config: {
        enabled: true,
        endpoint: 'https://telemetry.example.edu/v1/signals',
        protocol: 'otlp-http/protobuf',
        serviceVersion: '0.0.0',
      },
      transport: { exportMetrics, shutdown: vi.fn().mockResolvedValue(undefined) },
    })
    await expect(exporter.export({ metrics: emptyMetrics })).resolves.toEqual({
      ok: true,
      exported: true,
    })
    expect(exportMetrics).toHaveBeenCalledTimes(1)
    expect(exportMetrics).toHaveBeenCalledWith(emptyMetrics, undefined)
  })

  it('constructs the production transport only inside the explicitly enabled branch', async () => {
    const exportMetrics = vi.fn().mockResolvedValue(undefined)
    const shutdown = vi.fn().mockResolvedValue(undefined)
    const transportFactory = vi.fn(() => ({ exportMetrics, shutdown }))
    const exporter = createTelemetryExporter({
      config: {
        enabled: true,
        endpoint: 'https://telemetry.example.edu/v1/signals',
        protocol: 'otlp-http/protobuf',
        serviceVersion: '0.0.0',
      },
      transportFactory,
    })
    const result = await exporter.export({ metrics: emptyMetrics })
    expect(result).toEqual({ ok: true, exported: true })
    expect(transportFactory).toHaveBeenCalledTimes(1)
    expect(exportMetrics).toHaveBeenCalledWith(emptyMetrics, undefined)
    await expect(exporter.shutdown()).resolves.toEqual({ ok: true, exported: true })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('rejects insecure or unknown export configuration', () => {
    expect(() =>
      createTelemetryExporter({
        config: {
          enabled: true,
          endpoint: 'http://telemetry.example.edu/v1/signals',
          protocol: 'otlp-http/protobuf',
          serviceVersion: '0.0.0',
        },
      }),
    ).toThrow()
    expect(() =>
      createTelemetryExporter({ config: { enabled: false, endpoint: 'https://unexpected.test' } }),
    ).toThrow()
  })
})

const emptyMetrics: MetricsSnapshot = {
  transitions: [],
  verdicts: [],
  providerErrors: [],
  runnerErrors: [],
  queueDepth: 0,
  attempts: [],
  resourceRejections: [],
}
