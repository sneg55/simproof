import { z } from 'zod'

import {
  type LocalRetentionConfig,
  localRetentionConfigSchema,
  type OperationalSignal,
  type OperationalSignalInput,
  operationalSignalInputSchema,
  operationalSignalSchema,
  type SamplingConfig,
  type SignalSeverity,
  samplingConfigSchema,
} from './signals.js'

export interface OperationalSignalSink {
  readonly write: (signal: OperationalSignal) => void
}

const querySchema = z
  .object({
    limit: z.number().int().min(1).max(10_000).optional(),
    severity: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  })
  .strict()

type RecentQuery = z.input<typeof querySchema>
type Clock = () => number

const freezeSignal = (signal: OperationalSignal): OperationalSignal => {
  if (signal.correlation !== undefined) Object.freeze(signal.correlation)
  if (signal.attributes !== undefined) Object.freeze(signal.attributes)
  return Object.freeze(signal)
}

export class LocalLogStore implements OperationalSignalSink {
  readonly #clock: Clock
  readonly #config: LocalRetentionConfig
  readonly #signals: OperationalSignal[] = []

  constructor(config: LocalRetentionConfig, clock: Clock = Date.now) {
    this.#config = localRetentionConfigSchema.parse(config)
    this.#clock = clock
  }

  write(signal: OperationalSignal): void {
    const validated = freezeSignal(operationalSignalSchema.parse(signal))
    this.#signals.push(validated)
    this.#evict()
  }

  recent(query: RecentQuery = {}): readonly OperationalSignal[] {
    const parsed = querySchema.parse(query)
    const limit = parsed.limit ?? this.#config.maxEntries
    if (limit > this.#config.maxEntries) {
      throw new RangeError('The query limit exceeds configured local retention.')
    }
    this.#evict()
    const matching =
      parsed.severity === undefined
        ? this.#signals
        : this.#signals.filter(({ severity }) => severity === parsed.severity)
    return Object.freeze(matching.slice(-limit))
  }

  #evict(): void {
    const oldestAllowed = this.#clock() - this.#config.maxAgeMs
    let oldest = this.#signals[0]
    while (oldest !== undefined && Date.parse(oldest.occurredAt) < oldestAllowed) {
      this.#signals.shift()
      oldest = this.#signals[0]
    }
    const overflow = this.#signals.length - this.#config.maxEntries
    if (overflow > 0) this.#signals.splice(0, overflow)
  }
}

export interface StructuredLoggerOptions {
  readonly sink?: OperationalSignalSink
  readonly clock?: Clock
  readonly random?: () => number
  readonly sampling?: SamplingConfig
}

const defaultSampling: SamplingConfig = Object.freeze({ debug: 1, info: 1, warn: 1, error: 1 })
const noOperationSink: OperationalSignalSink = Object.freeze({ write: () => undefined })

const samplingRate = (config: SamplingConfig, severity: SignalSeverity): number => {
  switch (severity) {
    case 'debug':
      return config.debug
    case 'info':
      return config.info
    case 'warn':
      return config.warn
    case 'error':
      return 1
  }
}

const sampledIn = (
  severity: SignalSeverity,
  sampling: SamplingConfig,
  random: () => number,
): boolean => {
  if (severity === 'error') return true
  const rate = samplingRate(sampling, severity)
  if (rate === 0) return false
  const draw = random()
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) return false
  return draw < rate
}

export interface StructuredLogger {
  readonly emit: (input: OperationalSignalInput) => boolean
}

export const createStructuredLogger = (options: StructuredLoggerOptions = {}): StructuredLogger => {
  const clock = options.clock ?? Date.now
  const random = options.random ?? Math.random
  const sampling = samplingConfigSchema.parse(options.sampling ?? defaultSampling)
  const sink = options.sink ?? noOperationSink
  return Object.freeze({
    emit: (input: OperationalSignalInput): boolean => {
      const validated = operationalSignalInputSchema.parse(input)
      if (!sampledIn(validated.severity, sampling, random)) return false
      sink.write(
        operationalSignalSchema.parse({
          schemaVersion: '1',
          occurredAt: new Date(clock()).toISOString(),
          ...validated,
        }),
      )
      return true
    },
  })
}
