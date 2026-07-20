import { z } from 'zod'

import { sha256Schema } from './primitives.js'

export const MAX_PERSISTED_ARTIFACT_BYTES = 16_777_216

const recordIdSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })

const customLicenseSchema = z
  .object({
    kind: z.literal('custom'),
    label: z.string().trim().min(1).max(120),
    referenceUrl: z
      .url({ protocol: /^https$/ })
      .max(2_000)
      .nullable(),
  })
  .strict()
  .superRefine(({ referenceUrl }, context) => {
    if (referenceUrl === null) return
    const parsed = new URL(referenceUrl)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      context.addIssue({
        code: 'custom',
        message: 'License references must be HTTPS URLs without credentials, query, or fragment.',
      })
    }
  })

export const exportLicenseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('spdx'),
      id: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/),
    })
    .strict(),
  customLicenseSchema,
])

export const storedArtifactRoleSchema = z.enum([
  'core-source',
  'renderer-source',
  'renderer-data',
  'manifest',
  'concept-spec',
  'verification-report',
])

export const storedArtifactSchema = z
  .object({
    id: recordIdSchema,
    role: storedArtifactRoleSchema,
    contentHash: sha256Schema,
    mediaType: z.enum(['text/javascript', 'application/json']),
    byteLength: z.number().int().min(1).max(MAX_PERSISTED_ARTIFACT_BYTES),
    normalizationVersion: z.number().int().positive(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine(({ mediaType, role }, context) => {
    const expectedMediaType =
      role === 'core-source' || role === 'renderer-source' ? 'text/javascript' : 'application/json'
    if (mediaType !== expectedMediaType) {
      context.addIssue({ code: 'custom', message: 'Artifact role and media type must agree.' })
    }
  })

const artifactBindingFor = <Role extends string>(role: Role) =>
  z
    .object({ artifactId: recordIdSchema, role: z.literal(role), contentHash: sha256Schema })
    .strict()

export const coreArtifactBindingSchema = artifactBindingFor('core-source')
export const rendererArtifactBindingSchema = z.union([
  artifactBindingFor('renderer-source'),
  artifactBindingFor('renderer-data'),
])
export const manifestArtifactBindingSchema = artifactBindingFor('manifest')
export const conceptSpecArtifactBindingSchema = artifactBindingFor('concept-spec')
export const verificationReportArtifactBindingSchema = artifactBindingFor('verification-report')

export const artifactBundleSchema = z
  .object({
    core: coreArtifactBindingSchema,
    renderer: rendererArtifactBindingSchema,
    manifest: manifestArtifactBindingSchema,
  })
  .strict()
  .refine(
    ({ core, manifest, renderer }) =>
      new Set([core.artifactId, renderer.artifactId, manifest.artifactId]).size === 3,
    { message: 'Artifact bundle roles must reference distinct stored artifacts.' },
  )

export type ExportLicense = z.infer<typeof exportLicenseSchema>
export type StoredArtifactRole = z.infer<typeof storedArtifactRoleSchema>
export type StoredArtifact = z.infer<typeof storedArtifactSchema>
export type ArtifactBundle = z.infer<typeof artifactBundleSchema>
export type ConceptSpecArtifactBinding = z.infer<typeof conceptSpecArtifactBindingSchema>
export type VerificationReportArtifactBinding = z.infer<
  typeof verificationReportArtifactBindingSchema
>
