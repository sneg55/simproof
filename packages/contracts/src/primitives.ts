import { z } from 'zod'

const finiteNumberSchema = z.number().finite()

export const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
export const semverSchema = z
  .string()
  .max(100)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- Input is capped before the anchored semantic-version grammar is evaluated.
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  )
export const identifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9.-]*$/)
export const fieldIdentifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9.-]*$/)

export const numericRangeSchema = z
  .object({
    min: finiteNumberSchema,
    max: finiteNumberSchema,
  })
  .strict()
  .refine(({ max, min }) => min <= max, { message: 'Range minimum must not exceed maximum.' })

const absoluteToleranceSchema = z
  .object({
    mode: z.literal('absolute'),
    absolute: finiteNumberSchema.nonnegative(),
    unit: z.string().trim().min(1).max(24),
  })
  .strict()

const relativeToleranceSchema = z
  .object({
    mode: z.literal('relative'),
    relative: finiteNumberSchema.min(0).max(1),
  })
  .strict()

const combinedToleranceSchema = z
  .object({
    mode: z.literal('absolute-or-relative'),
    absolute: finiteNumberSchema.nonnegative(),
    relative: finiteNumberSchema.min(0).max(1),
    unit: z.string().trim().min(1).max(24),
  })
  .strict()

export const toleranceSchema = z.discriminatedUnion('mode', [
  absoluteToleranceSchema,
  relativeToleranceSchema,
  combinedToleranceSchema,
])

export const measuredValueSchema = z
  .object({
    value: finiteNumberSchema,
    unit: z.string().trim().min(1).max(24),
  })
  .strict()

export const parameterRangeSchema = z
  .object({
    parameter: fieldIdentifierSchema,
    unit: z.string().trim().min(1).max(24),
    min: finiteNumberSchema,
    max: finiteNumberSchema,
    sampledValues: z.array(finiteNumberSchema).min(1).max(10_000).optional(),
  })
  .strict()
  .superRefine(({ max, min, sampledValues }, context) => {
    if (min > max) {
      context.addIssue({ code: 'custom', message: 'Range minimum must not exceed maximum.' })
    }
    if (sampledValues === undefined) return
    if (new Set(sampledValues).size !== sampledValues.length) {
      context.addIssue({ code: 'custom', message: 'Sampled values must be unique.' })
    }
    if (sampledValues.some((value) => value < min || value > max)) {
      context.addIssue({ code: 'custom', message: 'Sampled values must be inside the range.' })
    }
  })

export type Sha256 = z.infer<typeof sha256Schema>
export type Semver = z.infer<typeof semverSchema>
export type NumericRange = z.infer<typeof numericRangeSchema>
export type Tolerance = z.infer<typeof toleranceSchema>
export type MeasuredValue = z.infer<typeof measuredValueSchema>
export type ParameterRange = z.infer<typeof parameterRangeSchema>
