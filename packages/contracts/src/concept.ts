import { z } from 'zod'

import { numericRangeSchema } from './primitives.js'

const finiteNumberSchema = z.number().finite()
const positiveRangeSchema = numericRangeSchema.refine(({ min }) => min > 0, {
  message: 'Range must contain positive values only.',
})
const nonnegativeRangeSchema = numericRangeSchema.refine(({ min }) => min >= 0, {
  message: 'Range must contain nonnegative values only.',
})

const parameterSchema = <Unit extends string>(
  unit: Unit,
  rangeSchema: typeof numericRangeSchema,
  valueSchema = finiteNumberSchema,
) =>
  z
    .object({
      unit: z.literal(unit),
      defaultValue: valueSchema,
      requestedRange: rangeSchema,
    })
    .strict()
    .refine(
      ({ defaultValue, requestedRange }) =>
        defaultValue >= requestedRange.min && defaultValue <= requestedRange.max,
      { message: 'Default value must be inside the requested range.' },
    )

const uniqueControls = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .array(z.enum(values))
    .min(1)
    .max(values.length)
    .refine((controls) => new Set(controls).size === controls.length, {
      message: 'Requested controls must be unique.',
    })

export const projectileConceptSpecSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('projectile'),
    title: z.string().trim().min(1).max(120),
    parameters: z
      .object({
        initialSpeed: parameterSchema('m/s', positiveRangeSchema, finiteNumberSchema.positive()),
        launchAngle: parameterSchema('deg', numericRangeSchema),
      })
      .strict(),
    requestedControls: uniqueControls(['initialSpeed', 'launchAngle']),
  })
  .strict()

export const pendulumConceptSpecSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('pendulum'),
    title: z.string().trim().min(1).max(120),
    parameters: z
      .object({
        length: parameterSchema('m', positiveRangeSchema, finiteNumberSchema.positive()),
        amplitude: parameterSchema('deg', nonnegativeRangeSchema, finiteNumberSchema.nonnegative()),
      })
      .strict(),
    requestedControls: uniqueControls(['length', 'amplitude']),
  })
  .strict()

export const conceptSpecSchema = z.discriminatedUnion('domain', [
  projectileConceptSpecSchema,
  pendulumConceptSpecSchema,
])

export type ProjectileConceptSpec = z.infer<typeof projectileConceptSpecSchema>
export type PendulumConceptSpec = z.infer<typeof pendulumConceptSpecSchema>
export type ConceptSpec = z.infer<typeof conceptSpecSchema>
