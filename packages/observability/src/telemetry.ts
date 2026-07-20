import { z } from 'zod'

import { createOperationalError, type OperationalError } from './errors.js'
import { type MetricsSnapshot, metricsSnapshotSchema } from './metrics.js'
import { createOpenTelemetryMetricsTransport } from './open-telemetry.js'

const disabledTelemetryConfigSchema = z.object({ enabled: z.literal(false) }).strict()
const enabledTelemetryConfigSchema = z
  .object({
    enabled: z.literal(true),
    endpoint: z.url().refine((value) => value.startsWith('https://'), {
      message: 'Telemetry export requires HTTPS.',
    }),
    protocol: z.literal('otlp-http/protobuf'),
    serviceVersion: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[0-9A-Za-z.+-]+$/u),
  })
  .strict()

export const telemetryConfigSchema = z.discriminatedUnion('enabled', [
  disabledTelemetryConfigSchema,
  enabledTelemetryConfigSchema,
])
export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>
export type EnabledTelemetryConfig = z.infer<typeof enabledTelemetryConfigSchema>

export const defaultTelemetryConfig = Object.freeze({ enabled: false } as const)

export interface OtlpMetricsTransport {
  readonly exportMetrics: (metrics: MetricsSnapshot, signal?: AbortSignal) => Promise<void>
  readonly shutdown: () => Promise<void>
}

export type OtlpMetricsTransportFactory = (config: EnabledTelemetryConfig) => OtlpMetricsTransport

export interface TelemetryExporterOptions {
  readonly config?: unknown
  readonly transport?: OtlpMetricsTransport
  readonly transportFactory?: OtlpMetricsTransportFactory
}

export interface TelemetryExportInput {
  readonly metrics: MetricsSnapshot
}

export type TelemetryExportResult =
  | { readonly ok: true; readonly exported: boolean }
  | { readonly ok: false; readonly error: OperationalError }

export interface TelemetryExporter {
  readonly export: (
    input: TelemetryExportInput,
    signal?: AbortSignal,
  ) => Promise<TelemetryExportResult>
  readonly shutdown: () => Promise<TelemetryExportResult>
}

export const createTelemetryExporter = (
  options: TelemetryExporterOptions = {},
): TelemetryExporter => {
  const config = telemetryConfigSchema.parse(options.config ?? defaultTelemetryConfig)
  const transport = config.enabled
    ? (options.transport ??
      (options.transportFactory ?? createOpenTelemetryMetricsTransport)(config))
    : undefined
  return Object.freeze({
    export: async (
      input: TelemetryExportInput,
      signal?: AbortSignal,
    ): Promise<TelemetryExportResult> => {
      if (transport === undefined) return { ok: true, exported: false }
      const metrics = metricsSnapshotSchema.parse(input.metrics)
      try {
        await transport.exportMetrics(metrics, signal)
        return { ok: true, exported: true }
      } catch (cause: unknown) {
        return { ok: false, error: createOperationalError('telemetry.export-failed', { cause }) }
      }
    },
    shutdown: async (): Promise<TelemetryExportResult> => {
      if (transport === undefined) return { ok: true, exported: false }
      try {
        await transport.shutdown()
        return { ok: true, exported: true }
      } catch (cause: unknown) {
        return { ok: false, error: createOperationalError('telemetry.export-failed', { cause }) }
      }
    },
  })
}
