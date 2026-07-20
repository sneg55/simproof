import { z } from 'zod'

import { csrfTokenSchema } from './auth.js'
import { publicRuntimeConfigSchema } from './privacy.js'

const timestampSchema = z.iso.datetime({ offset: true })

export const bootstrapCapabilitySchema = z.object({ bootstrapAvailable: z.boolean() }).strict()

export const generationAvailabilitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), demo: z.boolean().optional() }).strict(),
  z
    .object({
      available: z.literal(false),
      reason: z.enum(['provider-not-configured', 'runner-unavailable', 'generation-disabled']),
    })
    .strict(),
])

export const educatorRuntimeConfigSchema = z
  .object({
    runtime: publicRuntimeConfigSchema,
    generation: generationAvailabilitySchema,
    seedLibraryReady: z.boolean(),
    supportedDomains: z.tuple([z.literal('pendulum'), z.literal('projectile')]),
  })
  .strict()

export const educatorSessionSchema = z
  .object({
    authenticated: z.literal(true),
    authenticationMode: z.enum(['password', 'local-bypass']).optional(),
    expiresAt: timestampSchema,
    csrfToken: csrfTokenSchema,
  })
  .strict()

export type BootstrapCapability = z.infer<typeof bootstrapCapabilitySchema>
export type GenerationAvailability = z.infer<typeof generationAvailabilitySchema>
export type EducatorRuntimeConfig = z.infer<typeof educatorRuntimeConfigSchema>
export type EducatorSession = z.infer<typeof educatorSessionSchema>
