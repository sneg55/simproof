import { z } from 'zod'

import { sha256Schema } from './primitives.js'

const timestampSchema = z.iso.datetime({ offset: true })
const positiveCountSchema = z.number().int().positive()
const consumedCountSchema = z.number().int().nonnegative()

export const generationIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const generationBudgetLimitsSchema = z
  .object({
    maxProviderRequests: positiveCountSchema.max(20),
    maxInputTokens: positiveCountSchema.max(2_000_000),
    maxOutputTokens: positiveCountSchema.max(200_000),
    maxCostMicrousd: positiveCountSchema.max(10_000_000_000),
    maxArtifactBytes: positiveCountSchema.max(64 * 1024 * 1024),
  })
  .strict()

export const generationRequestSchema = z
  .object({
    schemaVersion: z.literal('1'),
    simulationVersionId: z.uuid(),
    idempotencyKey: generationIdempotencyKeySchema,
    prompt: z.string().trim().min(1).max(20_000),
    maxAttempts: z.number().int().min(1).max(3),
    budget: generationBudgetLimitsSchema,
  })
  .strict()

export const generationBudgetSchema = z
  .object({
    limits: generationBudgetLimitsSchema,
    consumed: z
      .object({
        providerRequests: consumedCountSchema,
        inputTokens: consumedCountSchema,
        outputTokens: consumedCountSchema,
        costMicrousd: consumedCountSchema,
        artifactBytes: consumedCountSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(({ consumed, limits }, context) => {
    const comparisons = [
      [consumed.providerRequests, limits.maxProviderRequests, 'provider requests'],
      [consumed.inputTokens, limits.maxInputTokens, 'input tokens'],
      [consumed.outputTokens, limits.maxOutputTokens, 'output tokens'],
      [consumed.costMicrousd, limits.maxCostMicrousd, 'cost in micro-US dollars'],
      [consumed.artifactBytes, limits.maxArtifactBytes, 'artifact bytes'],
    ] as const
    for (const [actual, maximum, name] of comparisons) {
      if (actual > maximum) {
        context.addIssue({ code: 'custom', message: `Consumed ${name} exceed the run budget.` })
      }
    }
  })

export const generationStateSchema = z.enum([
  'queued',
  'compiling',
  'generating',
  'executing',
  'verifying',
  'repairing',
  'verified',
  'rejected',
  'cancelled',
  'provider_failed',
  'runner_failed',
  'budget_exhausted',
  'invariant_failed',
])

export type GenerationState = z.infer<typeof generationStateSchema>

export const terminalGenerationStates = [
  'verified',
  'rejected',
  'cancelled',
  'provider_failed',
  'runner_failed',
  'budget_exhausted',
  'invariant_failed',
] as const satisfies readonly GenerationState[]

const allowedTransitions = new Map<GenerationState, readonly GenerationState[]>([
  ['queued', ['compiling', 'cancelled', 'budget_exhausted', 'invariant_failed']],
  [
    'compiling',
    ['generating', 'provider_failed', 'cancelled', 'budget_exhausted', 'invariant_failed'],
  ],
  [
    'generating',
    ['executing', 'provider_failed', 'cancelled', 'budget_exhausted', 'invariant_failed'],
  ],
  [
    'executing',
    ['verifying', 'runner_failed', 'cancelled', 'budget_exhausted', 'invariant_failed'],
  ],
  [
    'verifying',
    ['verified', 'repairing', 'rejected', 'cancelled', 'budget_exhausted', 'invariant_failed'],
  ],
  [
    'repairing',
    ['executing', 'provider_failed', 'cancelled', 'budget_exhausted', 'invariant_failed'],
  ],
  ['verified', []],
  ['rejected', []],
  ['cancelled', []],
  ['provider_failed', []],
  ['runner_failed', []],
  ['budget_exhausted', []],
  ['invariant_failed', []],
])

export const isGenerationTransitionAllowed = (from: GenerationState, to: GenerationState) =>
  allowedTransitions.get(from)?.includes(to) ?? false

export const generationTransitionSchema = z
  .object({
    from: generationStateSchema,
    to: generationStateSchema,
    occurredAt: timestampSchema,
  })
  .strict()
  .refine(({ from, to }) => isGenerationTransitionAllowed(from, to), {
    message: 'Generation state transition is not allowed.',
  })

export const orchestrationAttemptSchema = z
  .object({
    attemptNumber: z.number().int().min(1).max(3),
    kind: z.enum(['generation', 'repair']),
    startedAt: timestampSchema,
    sourceArtifactHash: sha256Schema.nullable(),
    findingsHash: sha256Schema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const hasRepairEvidence = attempt.sourceArtifactHash !== null && attempt.findingsHash !== null
    if ((attempt.kind === 'repair') !== hasRepairEvidence) {
      context.addIssue({
        code: 'custom',
        message: 'Only repair attempts require source artifact and immutable findings hashes.',
      })
    }
    if (attempt.kind === 'generation' && attempt.attemptNumber !== 1) {
      context.addIssue({ code: 'custom', message: 'Generation is always the first attempt.' })
    }
  })

const errorBase = { retryable: z.boolean() } as const
const errorVariant = <Category extends string, StableId extends string>(
  category: Category,
  stableErrorId: StableId,
) =>
  z
    .object({
      category: z.literal(category),
      stableErrorId: z.literal(stableErrorId),
      ...errorBase,
    })
    .strict()

const authenticationErrorSchema = errorVariant('authentication', 'provider.authentication-failed')
const quotaErrorSchema = errorVariant('quota', 'provider.quota-exceeded')
const transientErrorSchema = errorVariant('transient', 'provider.transient-failure')
const malformedResponseErrorSchema = errorVariant(
  'malformed-response',
  'provider.malformed-response',
)
const cancellationErrorSchema = errorVariant('cancellation', 'generation.cancelled')
const budgetErrorSchema = errorVariant('budget', 'generation.budget-exhausted')
const runnerErrorSchema = errorVariant('runner', 'runner.execution-failed')
const rejectionErrorSchema = errorVariant('verifier-rejection', 'verifier.scientific-rejection')
const invariantErrorSchema = errorVariant('invariant', 'orchestration.invariant-failed')

export const generationErrorSchema = z.discriminatedUnion('category', [
  authenticationErrorSchema,
  quotaErrorSchema,
  transientErrorSchema,
  malformedResponseErrorSchema,
  cancellationErrorSchema,
  budgetErrorSchema,
  runnerErrorSchema,
  rejectionErrorSchema,
  invariantErrorSchema,
])

export const cancellationRecordSchema = z
  .object({
    requestedAt: timestampSchema,
    source: z.enum(['teacher', 'operator', 'system']),
    propagatedTo: z
      .array(z.enum(['concept-provider', 'code-provider', 'runner', 'verifier', 'persistence']))
      .min(1)
      .max(5)
      .refine((stages) => new Set(stages).size === stages.length, {
        message: 'Cancellation propagation stages must be unique.',
      }),
  })
  .strict()

export const generationTerminalOutcomeSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('verified'),
      attemptCount: z.number().int().min(1).max(3),
      artifactHash: sha256Schema,
      verificationReportHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      state: z.literal('rejected'),
      attemptCount: z.number().int().min(1).max(3),
      artifactHash: sha256Schema,
      verificationReportHash: sha256Schema,
      findingsCount: positiveCountSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('cancelled'),
      attemptCount: z.number().int().min(0).max(3),
      cancellation: cancellationRecordSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('provider_failed'),
      attemptCount: z.number().int().min(0).max(3),
      error: z.discriminatedUnion('category', [
        authenticationErrorSchema,
        quotaErrorSchema,
        transientErrorSchema,
        malformedResponseErrorSchema,
      ]),
    })
    .strict(),
  z
    .object({
      state: z.literal('runner_failed'),
      attemptCount: z.number().int().min(1).max(3),
      error: runnerErrorSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('budget_exhausted'),
      attemptCount: z.number().int().min(0).max(3),
      error: budgetErrorSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('invariant_failed'),
      attemptCount: z.number().int().min(0).max(3),
      error: invariantErrorSchema,
    })
    .strict(),
])

export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type GenerationBudget = z.infer<typeof generationBudgetSchema>
export type GenerationTransition = z.infer<typeof generationTransitionSchema>
export type OrchestrationAttempt = z.infer<typeof orchestrationAttemptSchema>
export type GenerationError = z.infer<typeof generationErrorSchema>
export type CancellationRecord = z.infer<typeof cancellationRecordSchema>
export type GenerationTerminalOutcome = z.infer<typeof generationTerminalOutcomeSchema>
