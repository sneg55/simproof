import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

import { type MetricsSnapshot, metricsSnapshotSchema } from './metrics.js'
import type { EnabledTelemetryConfig, OtlpMetricsTransport } from './telemetry.js'

interface OpenTelemetryDependencies {
  readonly exporter?: PushMetricExporter
}

const emptySnapshot = (): MetricsSnapshot => ({
  transitions: [],
  verdicts: [],
  providerErrors: [],
  runnerErrors: [],
  queueDepth: 0,
  attempts: [],
  resourceRejections: [],
})

export const createOpenTelemetryMetricsTransport = (
  config: EnabledTelemetryConfig,
  dependencies: OpenTelemetryDependencies = {},
): OtlpMetricsTransport => {
  const exporter = dependencies.exporter ?? new OTLPMetricExporter({ url: config.endpoint })
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
    cardinalityLimits: { default: 256 },
  })
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'simproof-orchestrator',
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    readers: [reader],
  })
  const meter = provider.getMeter('@simproof/observability', config.serviceVersion)
  let current = emptySnapshot()

  meter.createObservableCounter('simproof.generation.transitions').addCallback((result) => {
    for (const entry of current.transitions) {
      result.observe(entry.count, { from: entry.from ?? 'initial', to: entry.to })
    }
  })
  meter.createObservableCounter('simproof.verification.verdicts').addCallback((result) => {
    for (const entry of current.verdicts) result.observe(entry.count, { verdict: entry.verdict })
  })
  meter.createObservableCounter('simproof.provider.errors').addCallback((result) => {
    for (const entry of current.providerErrors) {
      result.observe(entry.count, { classification: entry.classification })
    }
  })
  meter.createObservableCounter('simproof.runner.errors').addCallback((result) => {
    for (const entry of current.runnerErrors) {
      result.observe(entry.count, { classification: entry.classification })
    }
  })
  meter.createObservableGauge('simproof.generation.queue.depth').addCallback((result) => {
    result.observe(current.queueDepth)
  })
  meter.createObservableCounter('simproof.generation.attempts').addCallback((result) => {
    for (const entry of current.attempts) {
      result.observe(entry.count, { kind: entry.attemptKind })
    }
  })
  meter.createObservableCounter('simproof.runner.resource_rejections').addCallback((result) => {
    for (const entry of current.resourceRejections) {
      result.observe(entry.count, { resource: entry.resource })
    }
  })

  return Object.freeze({
    exportMetrics: async (metrics: MetricsSnapshot, signal?: AbortSignal): Promise<void> => {
      signal?.throwIfAborted()
      current = metricsSnapshotSchema.parse(metrics)
      await provider.forceFlush()
      signal?.throwIfAborted()
    },
    shutdown: async (): Promise<void> => {
      await provider.shutdown()
    },
  })
}
