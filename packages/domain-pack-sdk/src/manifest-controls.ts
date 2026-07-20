import { identifierSchema } from '@simproof/contracts'
import { z } from 'zod'

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)

export const relativeFilePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/u)

const exactScientificOutcomeSchema = z
  .object({
    kind: z.literal('scientific'),
    verdict: z.enum(['inapplicable', 'rejected', 'verified']),
    findingIds: z.array(identifierSchema).max(10_000),
    sampleCount: z.number().int().positive().max(100_000),
  })
  .strict()

const exactBoundaryOutcomeSchema = z
  .object({ kind: z.literal('boundary-failure'), errorId: identifierSchema })
  .strict()

const fixtureControlSchema = z
  .object({
    id: identifierSchema,
    evidenceId: identifierSchema,
    path: relativeFilePathSchema,
    expected: z.discriminatedUnion('kind', [
      exactScientificOutcomeSchema,
      exactBoundaryOutcomeSchema,
    ]),
  })
  .strict()

const executableControlSchema = z
  .object({
    id: identifierSchema,
    evidenceId: identifierSchema,
    seed: z.number().int().nonnegative(),
    runCount: z.number().int().min(1).max(100_000),
    generator: z
      .object({
        description: boundedText(1_000),
        ranges: z
          .array(
            z
              .object({
                quantity: identifierSchema,
                unit: boundedText(24),
                min: z.number().finite(),
                max: z.number().finite(),
              })
              .strict()
              .refine(({ max, min }) => min <= max),
          )
          .min(1)
          .max(50),
      })
      .strict(),
    invariantId: identifierSchema,
    allowedError: z
      .object({ value: z.number().finite().nonnegative(), unit: boundedText(24) })
      .strict(),
    expected: z.literal('passed'),
  })
  .strict()

const boundaryControlSchema = z
  .object({
    id: identifierSchema,
    evidenceId: identifierSchema,
    threshold: z
      .object({ quantity: identifierSchema, unit: boundedText(24), value: z.number().finite() })
      .strict(),
    covers: z
      .object({
        kind: z.enum(['applicability-endpoint', 'singularity', 'tolerance-threshold']),
        id: identifierSchema,
      })
      .strict(),
    cases: z
      .object({
        below: z.number().finite(),
        equal: z.number().finite(),
        above: z.number().finite(),
      })
      .strict()
      .refine(({ above, below, equal }) => below < equal && equal < above, {
        message: 'Boundary cases must straddle the exact threshold.',
      }),
    expected: z.literal('passed'),
  })
  .strict()
  .refine(({ cases, threshold }) => cases.equal === threshold.value, {
    message: 'The equal boundary case must be the declared threshold.',
    path: ['cases', 'equal'],
  })

export const controlEvidenceSchema = z
  .object({
    positive: z.array(fixtureControlSchema).min(1).max(100),
    negative: z.array(fixtureControlSchema).min(1).max(100),
    property: z.array(executableControlSchema).min(1).max(100),
    boundary: z.array(boundaryControlSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (controls) =>
      Object.values(controls).every(
        (entries) => new Set(entries.map(({ id }) => id)).size === entries.length,
      ),
    { message: 'Control identifiers must be unique within each control class.' },
  )
