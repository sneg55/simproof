import { z } from 'zod'
import { educatorVersionDetailSchema } from './educator-library.js'

const recordIdSchema = z.uuid()
const unique = <T>(values: T[]) => new Set(values).size === values.length

export const comparisonFieldSchema = z.enum([
  'state',
  'artifact',
  'concept',
  'policy',
  'domain-pack',
  'runner',
  'verdict',
  'findings',
  'assumptions',
  'limitations',
  'publication',
  'export-license',
])

export const comparisonValueSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    details: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            value: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    totalDetailCount: z.number().int().nonnegative().max(10_000),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine(({ details, totalDetailCount, truncated }, context) => {
    if (totalDetailCount < details.length || truncated !== totalDetailCount > details.length) {
      context.addIssue({ code: 'custom', message: 'Comparison detail bounds are inconsistent.' })
    }
  })

export const comparisonRowSchema = z
  .object({
    field: comparisonFieldSchema,
    changed: z.boolean(),
    left: comparisonValueSchema,
    right: comparisonValueSchema,
  })
  .strict()

const COMPARISON_FIELDS = comparisonFieldSchema.options

export const versionComparisonSchema = z
  .object({
    simulationId: recordIdSchema,
    left: educatorVersionDetailSchema,
    right: educatorVersionDetailSchema,
    rows: z.array(comparisonRowSchema).length(COMPARISON_FIELDS.length),
  })
  .strict()
  .superRefine(({ left, right, rows }, context) => {
    if (left.summary.id === right.summary.id) {
      context.addIssue({
        code: 'custom',
        message: 'Version comparison requires distinct versions.',
      })
    }
    if (!unique(rows.map(({ field }) => field))) {
      context.addIssue({ code: 'custom', message: 'Comparison fields must be unique.' })
    }
    if (rows.some(({ field }, index) => field !== COMPARISON_FIELDS.at(index))) {
      context.addIssue({ code: 'custom', message: 'Comparison fields must use canonical order.' })
    }
  })

export type ComparisonField = z.infer<typeof comparisonFieldSchema>
export type ComparisonValue = z.infer<typeof comparisonValueSchema>
export type VersionComparison = z.infer<typeof versionComparisonSchema>
