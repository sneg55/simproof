import { generationStateSchema } from '@simproof/contracts'
import { z } from 'zod'

import { correlationSchema } from './correlation.js'
import { operationalErrorIdSchema } from './error-registry.js'
import { operationalEventIdSchema } from './operational-event-registry.js'

export const signalSeveritySchema = z.enum(['debug', 'info', 'warn', 'error'])
export const signalComponentSchema = z.enum([
  'orchestrator',
  'web-api',
  'persistence',
  'provider',
  'runner-client',
  'verifier',
  'diagnostics',
])

const isLowercaseLetter = (character: string): boolean => character >= 'a' && character <= 'z'
const isDigit = (character: string): boolean => character >= '0' && character <= '9'

const isBoundedIdentifier = (value: string): boolean => {
  const first = value[0]
  const last = value.at(-1)
  if (first === undefined || last === undefined) return false
  if (!isLowercaseLetter(first) || (!isLowercaseLetter(last) && !isDigit(last))) return false
  let hasSeparator = false
  for (const character of value) {
    if (character === '.' || character === '-') {
      hasSeparator = true
      continue
    }
    if (!isLowercaseLetter(character) && !isDigit(character)) return false
  }
  return hasSeparator
}

const boundedIdentifierSchema = z.string().min(1).max(100).refine(isBoundedIdentifier, {
  message: 'Expected a bounded lowercase namespaced identifier.',
})

export const operationalAttributesSchema = z
  .object({
    operation: boundedIdentifierSchema.optional(),
    detail: boundedIdentifierSchema.optional(),
    failureClass: z
      .enum([
        'authentication',
        'quota',
        'transient',
        'malformed-response',
        'policy-denied',
        'resource-limit',
        'runtime-error',
        'internal-error',
        'scientific-rejection',
        'configuration',
      ])
      .optional(),
    fromState: generationStateSchema.nullable().optional(),
    toState: generationStateSchema.optional(),
    verdict: z.enum(['verified', 'rejected', 'inapplicable']).optional(),
    retryable: z.boolean().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    attemptNumber: z.number().int().min(1).max(3).optional(),
    queueDepth: z.number().int().nonnegative().max(100_000).optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    resource: z.enum(['cpu', 'memory', 'output', 'processes', 'wall-time', 'workspace']).optional(),
  })
  .strict()

const operationalSignalInputFields = {
  severity: signalSeveritySchema,
  component: signalComponentSchema,
  event: operationalEventIdSchema,
  errorId: operationalErrorIdSchema.optional(),
  correlation: correlationSchema.optional(),
  attributes: operationalAttributesSchema.optional(),
} as const

export const operationalSignalInputSchema = z.object(operationalSignalInputFields).strict()

export const operationalSignalSchema = z
  .object({
    schemaVersion: z.literal('1'),
    occurredAt: z.iso.datetime({ offset: true }),
    ...operationalSignalInputFields,
  })
  .strict()

export type SignalSeverity = z.infer<typeof signalSeveritySchema>
export type OperationalSignalInput = z.infer<typeof operationalSignalInputSchema>
export type OperationalSignal = z.infer<typeof operationalSignalSchema>

export const localRetentionConfigSchema = z
  .object({
    maxEntries: z.number().int().min(1).max(10_000),
    maxAgeMs: z
      .number()
      .int()
      .min(1_000)
      .max(30 * 24 * 60 * 60 * 1_000),
  })
  .strict()

export const samplingConfigSchema = z
  .object({
    debug: z.number().min(0).max(1),
    info: z.number().min(0).max(1),
    warn: z.number().min(0).max(1),
    error: z.number().min(0).max(1),
  })
  .strict()

export type LocalRetentionConfig = z.infer<typeof localRetentionConfigSchema>
export type SamplingConfig = z.infer<typeof samplingConfigSchema>
