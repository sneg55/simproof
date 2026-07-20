import { z } from 'zod'

import { pendulumConceptSpecSchema, projectileConceptSpecSchema } from './concept.js'
import { pendulumInputSchema, projectileInputSchema } from './observation.js'
import { sha256Schema } from './primitives.js'
import { reportValiditySchema } from './validity.js'

const finiteNumberSchema = z.number().finite()
const unique = <T>(values: T[]) => new Set(values).size === values.length

export const projectileRendererDataSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('projectile'),
    renderer: z.literal('projectile-trajectory'),
    features: z
      .array(z.enum(['trail', 'velocity-vector', 'apex-marker', 'impact-marker']))
      .max(4)
      .refine(unique),
  })
  .strict()

export const pendulumRendererDataSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('pendulum'),
    renderer: z.literal('pendulum-bob'),
    features: z
      .array(z.enum(['equilibrium-line', 'turning-points', 'period-markers']))
      .max(3)
      .refine(unique),
  })
  .strict()

export const rendererDataSchema = z.discriminatedUnion('domain', [
  projectileRendererDataSchema,
  pendulumRendererDataSchema,
])

export const BUILT_IN_RENDERER_CAPABILITIES = Object.freeze({
  projectile: Object.freeze({
    renderer: 'projectile-trajectory',
    features: Object.freeze(['trail', 'apex-marker', 'impact-marker']),
  }),
  pendulum: Object.freeze({
    renderer: 'pendulum-bob',
    features: Object.freeze(['equilibrium-line', 'turning-points']),
  }),
} as const)

export const rendererFeaturesAreImplemented = (
  domain: string,
  renderer: string,
  features: readonly string[],
): boolean => {
  const capability =
    domain === 'projectile'
      ? BUILT_IN_RENDERER_CAPABILITIES.projectile
      : domain === 'pendulum'
        ? BUILT_IN_RENDERER_CAPABILITIES.pendulum
        : undefined
  return (
    capability !== undefined &&
    capability.renderer === renderer &&
    features.every((feature) => capability.features.some((supported) => supported === feature))
  )
}

export const previewRequestSchema = z.discriminatedUnion('domain', [
  z
    .object({
      domain: z.literal('projectile'),
      expectedVersionRevision: z.number().int().nonnegative(),
      input: projectileInputSchema,
      sampleCount: z.number().int().min(2).max(2_001),
    })
    .strict(),
  z
    .object({
      domain: z.literal('pendulum'),
      expectedVersionRevision: z.number().int().nonnegative(),
      input: pendulumInputSchema,
      sampleCount: z.number().int().min(2).max(2_001),
    })
    .strict(),
])

const previewEvidenceSchema = z
  .object({
    verificationRunId: z.uuid(),
    artifactHash: sha256Schema,
    validity: reportValiditySchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict()

const projectilePreviewSampleSchema = z
  .object({
    index: z.number().int().nonnegative(),
    timeS: finiteNumberSchema.nonnegative(),
    xM: finiteNumberSchema,
    yM: finiteNumberSchema,
    speedMps: finiteNumberSchema.nonnegative(),
    velocityXMps: finiteNumberSchema.optional(),
    velocityYMps: finiteNumberSchema.optional(),
  })
  .strict()

const pendulumPreviewSampleSchema = z
  .object({
    index: z.number().int().nonnegative(),
    timeS: finiteNumberSchema.nonnegative(),
    angleDeg: finiteNumberSchema,
    angularVelocityDegPerS: finiteNumberSchema.optional(),
  })
  .strict()

export const projectilePreviewSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('projectile'),
    simulationVersionId: z.uuid(),
    conceptSpec: projectileConceptSpecSchema,
    renderer: projectileRendererDataSchema,
    input: projectileInputSchema,
    evidence: previewEvidenceSchema,
    samples: z.array(projectilePreviewSampleSchema).min(2).max(2_001),
    events: z
      .array(
        z
          .object({
            kind: z.enum(['launch', 'apex', 'impact']),
            sampleIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict()

export const pendulumPreviewSchema = z
  .object({
    schemaVersion: z.literal('1'),
    domain: z.literal('pendulum'),
    simulationVersionId: z.uuid(),
    conceptSpec: pendulumConceptSpecSchema,
    renderer: pendulumRendererDataSchema,
    input: pendulumInputSchema,
    periodS: finiteNumberSchema.positive(),
    evidence: previewEvidenceSchema,
    samples: z.array(pendulumPreviewSampleSchema).min(2).max(2_001),
    events: z
      .array(
        z
          .object({
            kind: z.enum(['left-turning-point', 'equilibrium-crossing', 'right-turning-point']),
            sampleIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(2_001),
  })
  .strict()

function samplesAndEventsAreValid(
  samples: readonly { readonly index: number; readonly timeS: number }[],
  events: readonly { readonly sampleIndex: number }[],
): boolean {
  return (
    samples[0]?.timeS === 0 &&
    samples.every(
      (sample, index) =>
        sample.index === index &&
        (index === 0 || sample.timeS > (samples[index - 1]?.timeS ?? sample.timeS)),
    ) &&
    events.every(({ sampleIndex }) => sampleIndex < samples.length)
  )
}

export const normalizedPreviewSchema = z
  .discriminatedUnion('domain', [projectilePreviewSchema, pendulumPreviewSchema])
  .superRefine((preview, context) => {
    if (!samplesAndEventsAreValid(preview.samples, preview.events)) {
      context.addIssue({ code: 'custom', message: 'Preview samples or events are inconsistent.' })
    }
    if (preview.domain === 'projectile') {
      const { initialSpeed, launchAngle } = preview.conceptSpec.parameters
      if (
        preview.input.initialSpeedMps < initialSpeed.requestedRange.min ||
        preview.input.initialSpeedMps > initialSpeed.requestedRange.max ||
        preview.input.launchAngleDeg < launchAngle.requestedRange.min ||
        preview.input.launchAngleDeg > launchAngle.requestedRange.max
      ) {
        context.addIssue({ code: 'custom', message: 'Preview input is outside concept bounds.' })
      }
      if (!unique(preview.events.map(({ kind }) => kind))) {
        context.addIssue({ code: 'custom', message: 'Projectile events must be unique.' })
      }
      return
    }
    const { amplitude, length } = preview.conceptSpec.parameters
    if (
      preview.input.lengthM < length.requestedRange.min ||
      preview.input.lengthM > length.requestedRange.max ||
      preview.input.amplitudeDeg < amplitude.requestedRange.min ||
      preview.input.amplitudeDeg > amplitude.requestedRange.max
    ) {
      context.addIssue({ code: 'custom', message: 'Preview input is outside concept bounds.' })
    }
  })

export const normalizedProjectilePreviewSchema =
  normalizedPreviewSchema.pipe(projectilePreviewSchema)
export const normalizedPendulumPreviewSchema = normalizedPreviewSchema.pipe(pendulumPreviewSchema)

export type RendererData = z.infer<typeof rendererDataSchema>
export type PreviewRequest = z.infer<typeof previewRequestSchema>
export type NormalizedPreview = z.infer<typeof normalizedPreviewSchema>
export type ProjectilePreview = z.infer<typeof normalizedProjectilePreviewSchema>
export type PendulumPreview = z.infer<typeof normalizedPendulumPreviewSchema>
