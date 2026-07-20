import {
  CorrelationContext,
  createStructuredLogger,
  createTelemetryExporter,
  LocalLogStore,
  LocalMetrics,
  LocalNdjsonLogStore,
  type OperationalSignal,
  type OperationalSignalSink,
  type OtlpMetricsTransportFactory,
} from '@simproof/observability'

import type { ServerConfig } from '../config/environment.js'
import { GenerationObservability } from '../generation/generation-observability.js'

interface RuntimeOverrides {
  readonly clock?: () => number
  readonly context?: CorrelationContext
  readonly serviceVersion?: string
  readonly telemetryTransportFactory?: OtlpMetricsTransportFactory
}

class ResilientLocalSink implements OperationalSignalSink {
  constructor(
    private readonly memory: LocalLogStore,
    private readonly file: LocalNdjsonLogStore,
  ) {}

  write(signal: OperationalSignal): void {
    this.memory.write(signal)
    try {
      this.file.write(signal)
    } catch {
      // A later local storage failure must not turn a completed product operation into a failure.
    }
  }
}

export function createObservabilityRuntime(config: ServerConfig, overrides: RuntimeOverrides = {}) {
  const clock = overrides.clock ?? Date.now
  const memory = new LocalLogStore({ maxEntries: 1_000, maxAgeMs: 86_400_000 }, clock)
  const file = new LocalNdjsonLogStore({
    root: config.observability.diagnosticLogRoot,
    maxEventBytes: 16_384,
    maxFileBytes: config.observability.maxFileBytes,
    maxFiles: config.observability.retainedFiles,
  })
  const logger = createStructuredLogger({ sink: new ResilientLocalSink(memory, file), clock })
  const metrics = new LocalMetrics()
  const context = overrides.context ?? new CorrelationContext()
  const generation = new GenerationObservability({ context, logger, metrics })
  const telemetry = createTelemetryExporter({
    config: telemetryConfiguration(config, overrides.serviceVersion ?? '0.0.0'),
    ...(overrides.telemetryTransportFactory === undefined
      ? {}
      : { transportFactory: overrides.telemetryTransportFactory }),
  })
  let activeFlush: Promise<void> | undefined
  let closed = false
  const flush = (): Promise<void> => {
    if (activeFlush !== undefined) return activeFlush
    activeFlush = telemetry
      .export({ metrics: metrics.snapshot() })
      .then((result) => {
        if (!result.ok) {
          logger.emit({
            severity: 'error',
            component: 'orchestrator',
            event: 'telemetry.export.failed',
            errorId: result.error.errorId,
          })
        }
      })
      .finally(() => {
        activeFlush = undefined
      })
    return activeFlush
  }
  const interval = config.privacy.telemetryEnabled
    ? setInterval(() => void flush(), 60_000)
    : undefined
  interval?.unref()

  return Object.freeze({
    context,
    logger,
    metrics,
    generation,
    recent: (limit: number) => memory.recent({ limit }),
    flush,
    close: async (): Promise<void> => {
      if (closed) return
      closed = true
      if (interval !== undefined) clearInterval(interval)
      await flush()
      const result = await telemetry.shutdown()
      if (!result.ok) {
        logger.emit({
          severity: 'error',
          component: 'orchestrator',
          event: 'telemetry.shutdown.failed',
          errorId: result.error.errorId,
        })
      }
    },
  })
}

export type ObservabilityRuntime = ReturnType<typeof createObservabilityRuntime>

function telemetryConfiguration(config: ServerConfig, serviceVersion: string) {
  if (!config.privacy.telemetryEnabled) return { enabled: false as const }
  if (config.telemetry.endpoint === undefined) {
    throw new TypeError('Enabled telemetry requires its validated endpoint.')
  }
  return {
    enabled: true as const,
    endpoint: config.telemetry.endpoint,
    protocol: 'otlp-http/protobuf' as const,
    serviceVersion,
  }
}
