import { z } from 'zod'

const finiteNumberSchema = z.number().finite()

export const projectileInputSchema = z
  .object({
    initialSpeedMps: finiteNumberSchema.positive(),
    launchAngleDeg: finiteNumberSchema,
  })
  .strict()

export const projectileTrajectorySampleSchema = z
  .object({
    timeS: finiteNumberSchema.nonnegative(),
    xM: finiteNumberSchema,
    yM: finiteNumberSchema,
    speedMps: finiteNumberSchema.nonnegative(),
  })
  .strict()

export const projectileObservationSchema = z
  .object({
    input: projectileInputSchema,
    summary: z
      .object({
        rangeM: finiteNumberSchema,
        apexHeightM: finiteNumberSchema,
        flightTimeS: finiteNumberSchema.positive(),
        initialSpeedMps: finiteNumberSchema.positive(),
      })
      .strict(),
    trajectory: z.array(projectileTrajectorySampleSchema).min(1).max(20_000),
  })
  .strict()
  .refine(
    ({ trajectory }) =>
      trajectory.every((sample, index) => {
        if (index === 0) return true
        const previous = trajectory[index - 1]
        return previous !== undefined && sample.timeS >= previous.timeS
      }),
    { message: 'Trajectory sample times must be monotonically nondecreasing.' },
  )

export const pendulumInputSchema = z
  .object({
    lengthM: finiteNumberSchema.positive(),
    amplitudeDeg: finiteNumberSchema.positive(),
  })
  .strict()

export const pendulumObservationSchema = z
  .object({
    input: pendulumInputSchema,
    periodS: finiteNumberSchema.positive(),
  })
  .strict()

export type ProjectileInput = z.infer<typeof projectileInputSchema>
export type ProjectileTrajectorySample = z.infer<typeof projectileTrajectorySampleSchema>
export type ProjectileObservation = z.infer<typeof projectileObservationSchema>
export type PendulumInput = z.infer<typeof pendulumInputSchema>
export type PendulumObservation = z.infer<typeof pendulumObservationSchema>
