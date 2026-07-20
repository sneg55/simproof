import { generationStateSchema } from '@simproof/contracts'
import { z } from 'zod'

const verdictSchema = z.enum(['verified', 'rejected', 'inapplicable'])
const providerFailureSchema = z.enum([
  'authentication',
  'quota',
  'transient',
  'malformed-response',
  'cancellation',
])
const runnerFailureSchema = z.enum([
  'policy-denied',
  'invalid-artifact',
  'resource-limit',
  'runtime-error',
  'internal-error',
  'cancelled',
])
const resourceSchema = z.enum(['cpu', 'memory', 'output', 'processes', 'wall-time', 'workspace'])
const attemptKindSchema = z.enum(['generation', 'repair'])

export const metricEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('transition'),
      from: generationStateSchema.nullable(),
      to: generationStateSchema,
    })
    .strict(),
  z.object({ kind: z.literal('verdict'), verdict: verdictSchema }).strict(),
  z.object({ kind: z.literal('provider-error'), classification: providerFailureSchema }).strict(),
  z.object({ kind: z.literal('runner-error'), classification: runnerFailureSchema }).strict(),
  z
    .object({ kind: z.literal('queue-depth'), depth: z.number().int().nonnegative().max(100_000) })
    .strict(),
  z
    .object({
      kind: z.literal('attempt'),
      attemptNumber: z.number().int().min(1).max(3),
      attemptKind: attemptKindSchema,
    })
    .strict(),
  z.object({ kind: z.literal('resource-rejection'), resource: resourceSchema }).strict(),
])

export type MetricEvent = z.infer<typeof metricEventSchema>

const positiveCounterSchema = z.number().int().positive()
const transitionCounterSchema = z
  .object({
    from: generationStateSchema.nullable(),
    to: generationStateSchema,
    count: positiveCounterSchema,
  })
  .strict()
const verdictCounterSchema = z
  .object({ verdict: verdictSchema, count: positiveCounterSchema })
  .strict()
const providerCounterSchema = z
  .object({ classification: providerFailureSchema, count: positiveCounterSchema })
  .strict()
const runnerCounterSchema = z
  .object({ classification: runnerFailureSchema, count: positiveCounterSchema })
  .strict()
const attemptCounterSchema = z
  .object({ attemptKind: attemptKindSchema, count: positiveCounterSchema })
  .strict()
const resourceCounterSchema = z
  .object({ resource: resourceSchema, count: positiveCounterSchema })
  .strict()

export const metricsSnapshotSchema = z
  .object({
    transitions: z.array(transitionCounterSchema).max(196),
    verdicts: z.array(verdictCounterSchema).max(3),
    providerErrors: z.array(providerCounterSchema).max(5),
    runnerErrors: z.array(runnerCounterSchema).max(6),
    queueDepth: z.number().int().nonnegative().max(100_000),
    attempts: z.array(attemptCounterSchema).max(2),
    resourceRejections: z.array(resourceCounterSchema).max(6),
  })
  .strict()

export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>
type TransitionCounter = z.infer<typeof transitionCounterSchema>

const increment = <Key>(counts: Map<Key, number>, key: Key): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

const frozenEntries = <Key, Entry>(
  counts: ReadonlyMap<Key, number>,
  create: (key: Key, count: number) => Entry,
): readonly Entry[] =>
  Object.freeze([...counts].map(([key, count]) => Object.freeze(create(key, count))))

export class LocalMetrics {
  readonly #transitions: TransitionCounter[] = []
  readonly #verdicts = new Map<z.infer<typeof verdictSchema>, number>()
  readonly #providerErrors = new Map<z.infer<typeof providerFailureSchema>, number>()
  readonly #runnerErrors = new Map<z.infer<typeof runnerFailureSchema>, number>()
  readonly #attempts = new Map<z.infer<typeof attemptKindSchema>, number>()
  readonly #resourceRejections = new Map<z.infer<typeof resourceSchema>, number>()
  #queueDepth = 0

  record(input: MetricEvent): void {
    const event = metricEventSchema.parse(input)
    switch (event.kind) {
      case 'transition':
        this.#transition(event.from, event.to)
        return
      case 'verdict':
        increment(this.#verdicts, event.verdict)
        return
      case 'provider-error':
        increment(this.#providerErrors, event.classification)
        return
      case 'runner-error':
        increment(this.#runnerErrors, event.classification)
        return
      case 'queue-depth':
        this.#queueDepth = event.depth
        return
      case 'attempt':
        increment(this.#attempts, event.attemptKind)
        return
      case 'resource-rejection':
        increment(this.#resourceRejections, event.resource)
        return
    }
  }

  snapshot(): MetricsSnapshot {
    const snapshot = metricsSnapshotSchema.parse({
      transitions: this.#transitions,
      verdicts: frozenEntries(this.#verdicts, (verdict, count) => ({ verdict, count })),
      providerErrors: frozenEntries(this.#providerErrors, (classification, count) => ({
        classification,
        count,
      })),
      runnerErrors: frozenEntries(this.#runnerErrors, (classification, count) => ({
        classification,
        count,
      })),
      queueDepth: this.#queueDepth,
      attempts: frozenEntries(this.#attempts, (attemptKind, count) => ({ attemptKind, count })),
      resourceRejections: frozenEntries(this.#resourceRejections, (resource, count) => ({
        resource,
        count,
      })),
    })
    Object.freeze(snapshot.transitions)
    Object.freeze(snapshot.verdicts)
    Object.freeze(snapshot.providerErrors)
    Object.freeze(snapshot.runnerErrors)
    Object.freeze(snapshot.attempts)
    Object.freeze(snapshot.resourceRejections)
    return Object.freeze(snapshot)
  }

  #transition(from: TransitionCounter['from'], to: TransitionCounter['to']): void {
    const existing = this.#transitions.find((counter) => counter.from === from && counter.to === to)
    if (existing === undefined) {
      this.#transitions.push({ from, to, count: 1 })
      return
    }
    existing.count += 1
  }
}
