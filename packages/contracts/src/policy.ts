import { z } from 'zod'

import { pendulumInputSchema, projectileInputSchema } from './observation.js'
import {
  identifierSchema,
  numericRangeSchema,
  semverSchema,
  toleranceSchema,
} from './primitives.js'

const finiteNumberSchema = z.number().finite()
const nonemptyTextListSchema = z.array(z.string().trim().min(1).max(500)).min(1).max(50)
const unique = <T>(values: T[]) => new Set(values).size === values.length

export const projectileCheckIdSchema = z.enum([
  'projectile.range',
  'projectile.apex-height',
  'projectile.flight-time',
  'projectile.trajectory-curve',
  'projectile.energy-conservation',
  'projectile.range-maximum',
])

export const pendulumCheckIdSchema = z.literal('pendulum.period')

const projectileChecksSchema = z
  .array(projectileCheckIdSchema)
  .length(6)
  .refine(unique, { message: 'Projectile policy checks must be unique and complete.' })

const projectileCasesSchema = z
  .array(projectileInputSchema)
  .min(1)
  .max(1_000)
  .refine(
    (cases) =>
      unique(
        cases.map(({ initialSpeedMps, launchAngleDeg }) => `${initialSpeedMps}:${launchAngleDeg}`),
      ),
    {
      message: 'Projectile sampling cases must be unique.',
    },
  )

const pendulumCasesSchema = z
  .array(pendulumInputSchema)
  .min(1)
  .max(1_000)
  .refine(
    (cases) => unique(cases.map(({ amplitudeDeg, lengthM }) => `${lengthM}:${amplitudeDeg}`)),
    {
      message: 'Pendulum sampling cases must be unique.',
    },
  )

export const projectileVerificationPolicySchema = z
  .object({
    schemaVersion: z.literal('1'),
    id: identifierSchema,
    version: semverSchema,
    domain: z.literal('projectile'),
    checks: projectileChecksSchema,
    applicability: z
      .object({
        initialSpeedMps: numericRangeSchema.refine(({ min }) => min > 0),
        launchAngleDeg: numericRangeSchema,
        gravityMps2: z.literal(9.81),
      })
      .strict(),
    sampling: z
      .object({
        cases: projectileCasesSchema,
        trajectoryFractions: z
          .array(finiteNumberSchema.min(0).max(1))
          .min(2)
          .max(1_000)
          .refine(unique, { message: 'Trajectory fractions must be unique.' })
          .refine((fractions) => fractions[0] === 0 && fractions.at(-1) === 1, {
            message: 'Trajectory fractions must include zero and one as endpoints.',
          })
          .refine(
            (fractions) =>
              fractions
                .slice(1)
                .every((fraction, index) => fraction > (fractions.at(index) ?? fraction)),
            { message: 'Trajectory fractions must be strictly increasing.' },
          ),
        rangeMaximum: z
          .object({
            initialSpeedMps: finiteNumberSchema.positive(),
            launchAnglesDeg: z
              .array(finiteNumberSchema)
              .min(3)
              .max(100)
              .refine(unique, { message: 'Range-maximum angles must be unique.' })
              .refine((angles) => angles.includes(45), {
                message: 'Range-maximum grid must include 45 degrees.',
              })
              .refine(
                (angles) =>
                  angles.some((angle) => angle < 45) && angles.some((angle) => angle > 45),
                {
                  message: 'Range-maximum grid must test both sides of 45 degrees.',
                },
              ),
          })
          .strict(),
      })
      .strict(),
    tolerances: z
      .object({
        rangeM: toleranceSchema,
        apexHeightM: toleranceSchema,
        flightTimeS: toleranceSchema,
        trajectoryYM: z
          .object({
            relativeTo: z.literal('apexHeightM'),
            relative: finiteNumberSchema.min(0).max(1),
          })
          .strict(),
        trajectoryTimeS: z
          .object({
            relativeScale: finiteNumberSchema.positive(),
          })
          .strict(),
        trajectoryXM: z
          .object({
            relativeTo: z.literal('rangeM'),
            relative: finiteNumberSchema.min(0).max(1),
          })
          .strict(),
        specificEnergy: toleranceSchema,
        rangeMaximum: z
          .object({
            expectedAngleDeg: finiteNumberSchema,
            relativeOrdering: finiteNumberSchema.min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    assumptions: nonemptyTextListSchema,
    limitations: nonemptyTextListSchema,
  })
  .strict()

export const pendulumVerificationPolicySchema = z
  .object({
    schemaVersion: z.literal('1'),
    id: identifierSchema,
    version: semverSchema,
    domain: z.literal('pendulum'),
    checks: z.tuple([pendulumCheckIdSchema]),
    applicability: z
      .object({
        lengthM: numericRangeSchema.refine(({ min }) => min > 0),
        amplitudeDeg: z
          .object({
            minExclusive: finiteNumberSchema.nonnegative(),
            max: finiteNumberSchema.positive(),
          })
          .strict()
          .refine(({ max, minExclusive }) => minExclusive < max, {
            message: 'Exclusive range minimum must be less than maximum.',
          }),
        gravityMps2: z.literal(9.81),
        model: z.literal('small-angle'),
      })
      .strict(),
    sampling: z.object({ cases: pendulumCasesSchema }).strict(),
    tolerances: z.object({ periodS: toleranceSchema }).strict(),
    assumptions: nonemptyTextListSchema,
    limitations: nonemptyTextListSchema,
  })
  .strict()

export const verificationPolicySchema = z.discriminatedUnion('domain', [
  projectileVerificationPolicySchema,
  pendulumVerificationPolicySchema,
])

export type ProjectileCheckId = z.infer<typeof projectileCheckIdSchema>
export type PendulumCheckId = z.infer<typeof pendulumCheckIdSchema>
export type ProjectileVerificationPolicy = z.infer<typeof projectileVerificationPolicySchema>
export type PendulumVerificationPolicy = z.infer<typeof pendulumVerificationPolicySchema>
export type VerificationPolicy = z.infer<typeof verificationPolicySchema>
