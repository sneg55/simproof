import { z } from 'zod'

import { conceptSpecSchema } from './concept.js'
import {
  generationBudgetLimitsSchema,
  generationBudgetSchema,
  generationIdempotencyKeySchema,
  generationStateSchema,
} from './generation.js'
import { identifierSchema, sha256Schema } from './primitives.js'
import { teacherGenerationRequestSchema } from './privacy.js'

const timestampSchema = z.iso.datetime({ offset: true })

export const educatorGenerationStateSchema = z.union([
  generationStateSchema,
  z.literal('awaiting_confirmation'),
])

export const educatorGenerationStartRequestSchema = z
  .object({
    schemaVersion: z.literal('1'),
    simulationVersionId: z.uuid(),
    expectedVersionRevision: z.number().int().nonnegative(),
    idempotencyKey: generationIdempotencyKeySchema,
    teacher: teacherGenerationRequestSchema,
    maxAttempts: z.number().int().min(1).max(3),
    budget: generationBudgetLimitsSchema,
  })
  .strict()

export const generationAcceptedSchema = z
  .object({
    runId: z.uuid(),
    created: z.boolean(),
    state: educatorGenerationStateSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict()

export const conceptReviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-ready') }).strict(),
  z
    .object({
      status: z.literal('pending'),
      reviewRevision: z.number().int().nonnegative(),
      conceptSpec: conceptSpecSchema,
      conceptSpecHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      status: z.literal('accepted'),
      reviewRevision: z.number().int().nonnegative(),
      conceptSpec: conceptSpecSchema,
      conceptSpecHash: sha256Schema,
      acceptedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('declined'),
      reviewRevision: z.number().int().nonnegative(),
      conceptSpecHash: sha256Schema,
      declinedAt: timestampSchema,
    })
    .strict(),
])

export const conceptReviewDecisionSchema = z
  .object({
    expectedRunRevision: z.number().int().nonnegative(),
    expectedReviewRevision: z.number().int().nonnegative(),
    conceptSpecHash: sha256Schema,
    decision: z.enum(['accept', 'decline']),
  })
  .strict()

export const publicGenerationAttemptSchema = z
  .object({
    attemptNumber: z.number().int().min(1).max(3),
    kind: z.enum(['generation', 'repair']),
    outcome: z.enum([
      'pending',
      'verified',
      'rejected',
      'provider_failed',
      'runner_failed',
      'malformed_response',
      'cancelled',
      'budget_exhausted',
      'invariant_failed',
    ]),
    artifactHash: sha256Schema.nullable(),
    verificationRunId: z.uuid().nullable(),
    stableErrorId: identifierSchema.nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine(({ completedAt, kind, attemptNumber, outcome }, context) => {
    if ((outcome === 'pending') !== (completedAt === null)) {
      context.addIssue({ code: 'custom', message: 'Only pending attempts are incomplete.' })
    }
    if ((attemptNumber === 1) !== (kind === 'generation')) {
      context.addIssue({ code: 'custom', message: 'Only the first attempt is generation.' })
    }
  })

const publicOperationalAttemptOutcomes = new Set([
  'provider_failed',
  'runner_failed',
  'malformed_response',
  'budget_exhausted',
  'invariant_failed',
])

export const publicGenerationTransitionSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    from: educatorGenerationStateSchema.nullable(),
    to: educatorGenerationStateSchema,
    occurredAt: timestampSchema,
  })
  .strict()

export const publicGenerationErrorSchema = z
  .object({
    category: z.enum([
      'authentication',
      'quota',
      'transient',
      'malformed-response',
      'cancellation',
      'budget',
      'runner',
      'verifier-rejection',
      'invariant',
    ]),
    stableErrorId: identifierSchema,
    retryable: z.boolean(),
  })
  .strict()

const terminalStates = new Set([
  'verified',
  'rejected',
  'cancelled',
  'provider_failed',
  'runner_failed',
  'budget_exhausted',
  'invariant_failed',
])

export const generationStatusSchema = z
  .object({
    runId: z.uuid(),
    simulationVersionId: z.uuid(),
    state: educatorGenerationStateSchema,
    revision: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(3),
    budget: generationBudgetSchema,
    conceptReview: conceptReviewSchema,
    cancellationRequestedAt: timestampSchema.nullable(),
    error: publicGenerationErrorSchema.nullable(),
    attempts: z.array(publicGenerationAttemptSchema).max(3),
    transitions: z.array(publicGenerationTransitionSchema).max(32),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (terminalStates.has(value.state) !== (value.completedAt !== null)) {
      context.addIssue({ code: 'custom', message: 'Terminal status completion is inconsistent.' })
    }
    if (value.state === 'awaiting_confirmation' && value.conceptReview.status !== 'pending') {
      context.addIssue({ code: 'custom', message: 'Confirmation requires pending concept review.' })
    }
    if (
      new Set(value.attempts.map(({ attemptNumber }) => attemptNumber)).size !==
      value.attempts.length
    ) {
      context.addIssue({ code: 'custom', message: 'Attempt numbers must be unique.' })
    }
    if (
      value.attempts.some(
        ({ outcome, stableErrorId }) =>
          publicOperationalAttemptOutcomes.has(outcome) !== (stableErrorId !== null),
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Attempt error evidence is inconsistent.' })
    }
    if (
      value.attempts.some(
        ({ artifactHash, outcome, verificationRunId }) =>
          (outcome === 'verified' || outcome === 'rejected') &&
          (artifactHash === null || verificationRunId === null),
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Scientific attempts require exact evidence.' })
    }
    if (value.attempts.some(({ attemptNumber }) => attemptNumber > value.maxAttempts)) {
      context.addIssue({ code: 'custom', message: 'Attempt exceeds the run cap.' })
    }
    if (
      value.transitions.some(
        ({ sequence }, index) =>
          index > 0 && sequence <= (value.transitions[index - 1]?.sequence ?? -1),
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Transitions must be strictly ordered.' })
    }
    if (
      value.transitions.some(
        (transition, index) =>
          (index === 0 && (transition.sequence !== 0 || transition.from !== null)) ||
          (index > 0 && transition.from !== value.transitions[index - 1]?.to),
      ) ||
      value.transitions.at(-1)?.to !== value.state
    ) {
      context.addIssue({ code: 'custom', message: 'Transition history is discontinuous.' })
    }
  })

export const cancelGenerationRequestSchema = z
  .object({ expectedRunRevision: z.number().int().nonnegative() })
  .strict()

export const cancellationAcceptedSchema = z
  .object({ runId: z.uuid(), cancellationRequestedAt: timestampSchema })
  .strict()

export type EducatorGenerationState = z.infer<typeof educatorGenerationStateSchema>
export type EducatorGenerationStartRequest = z.infer<typeof educatorGenerationStartRequestSchema>
export type GenerationStatus = z.infer<typeof generationStatusSchema>
export type ConceptReview = z.infer<typeof conceptReviewSchema>
export type GenerationAccepted = z.infer<typeof generationAcceptedSchema>
export type ConceptReviewDecision = z.infer<typeof conceptReviewDecisionSchema>
export type CancelGenerationRequest = z.infer<typeof cancelGenerationRequestSchema>
export type CancellationAccepted = z.infer<typeof cancellationAcceptedSchema>
