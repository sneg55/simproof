import { z } from 'zod'

const finite = z.number().finite()

export const pendulumDomainSceneSchema = z
  .object({
    renderer: z.literal('pendulum-bob'),
    rows: z
      .array(
        z
          .object({
            lengthM: finite.positive(),
            amplitudeDeg: finite,
            periodS: finite.positive(),
            timeS: finite.nonnegative(),
            angleDeg: finite,
            angularVelocityDegPerS: z.union([finite, z.literal('not-provided')]),
            event: z.enum([
              'equilibrium-crossing',
              'left-turning-point',
              'none',
              'right-turning-point',
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(2_001),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict()

export const projectileDomainSceneSchema = z
  .object({
    renderer: z.literal('projectile-trajectory'),
    rows: z
      .array(
        z
          .object({
            initialSpeedMps: finite.positive(),
            launchAngleDeg: finite,
            timeS: finite.nonnegative(),
            xM: finite,
            yM: finite,
            speedMps: finite.nonnegative(),
            velocityXMps: z.union([finite, z.literal('not-provided')]),
            velocityYMps: z.union([finite, z.literal('not-provided')]),
            event: z.enum(['apex', 'impact', 'launch', 'none']),
          })
          .strict(),
      )
      .min(1)
      .max(2_001),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict()

export type PendulumDomainScene = z.infer<typeof pendulumDomainSceneSchema>
export type ProjectileDomainScene = z.infer<typeof projectileDomainSceneSchema>
