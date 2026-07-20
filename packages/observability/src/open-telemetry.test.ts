import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics'
import { describe, expect, it } from 'vitest'

import { createOpenTelemetryMetricsTransport, type MetricsSnapshot } from './index.js'

describe('OpenTelemetry OTLP metrics adapter', () => {
  it('records the fixed low-cardinality metric inventory through the official SDK', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
    const transport = createOpenTelemetryMetricsTransport(
      {
        enabled: true,
        endpoint: 'https://telemetry.example.edu/v1/metrics',
        protocol: 'otlp-http/protobuf',
        serviceVersion: '0.0.0',
      },
      { exporter },
    )

    await transport.exportMetrics(snapshot)
    const exported = exporter.getMetrics()
    const names = exported.flatMap(({ scopeMetrics }) =>
      scopeMetrics.flatMap(({ metrics }) => metrics.map(({ descriptor }) => descriptor.name)),
    )
    expect(names).toEqual(
      expect.arrayContaining([
        'simproof.generation.transitions',
        'simproof.verification.verdicts',
        'simproof.provider.errors',
        'simproof.runner.errors',
        'simproof.generation.queue.depth',
        'simproof.generation.attempts',
        'simproof.runner.resource_rejections',
      ]),
    )
    const serialized = JSON.stringify(exported)
    expect(serialized).toContain('service.name')
    expect(serialized).toContain('simproof-orchestrator')
    expect(serialized).not.toContain('requestId')
    expect(serialized).not.toContain('runId')
    await transport.shutdown()
  })
})

const snapshot: MetricsSnapshot = {
  transitions: [{ from: 'queued', to: 'compiling', count: 2 }],
  verdicts: [{ verdict: 'verified', count: 1 }],
  providerErrors: [{ classification: 'transient', count: 1 }],
  runnerErrors: [{ classification: 'resource-limit', count: 1 }],
  queueDepth: 3,
  attempts: [{ attemptKind: 'generation', count: 1 }],
  resourceRejections: [{ resource: 'memory', count: 1 }],
}
