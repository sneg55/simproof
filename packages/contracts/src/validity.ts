import { z } from 'zod'

import { identifierSchema, semverSchema, sha256Schema } from './primitives.js'
import { runnerBindingSchema } from './report.js'

const versionedContentSchema = z
  .object({
    id: identifierSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  })
  .strict()

export const MAX_VERIFICATION_DEPENDENCIES = 64

export const verificationDependencyEntrySchema = z
  .object({
    id: identifierSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  })
  .strict()

export const verificationDependencyBindingSchema = z
  .object({
    schemaVersion: z.literal('1'),
    entries: z
      .array(verificationDependencyEntrySchema)
      .max(MAX_VERIFICATION_DEPENDENCIES)
      .refine(
        (entries) =>
          entries.every(
            (entry, index) => index === 0 || entries[index - 1]?.id.localeCompare(entry.id) === -1,
          ),
        { message: 'Verification dependencies must be unique and sorted by identifier.' },
      ),
    contentHash: sha256Schema,
  })
  .strict()

export const currentVerificationBindingsSchema = z
  .object({
    conceptSpecHash: sha256Schema,
    artifactHash: sha256Schema,
    observationHash: sha256Schema,
    policy: versionedContentSchema,
    domainPack: versionedContentSchema,
    runner: runnerBindingSchema,
  })
  .strict()

export const staleReasonSchema = z.enum([
  'concept-changed',
  'artifact-changed',
  'observations-changed',
  'policy-changed',
  'domain-pack-changed',
  'runner-changed',
  'dependencies-changed',
])

const currentReportValiditySchema = z.object({ status: z.literal('current') }).strict()
const staleReportValiditySchema = z
  .object({
    status: z.literal('stale'),
    reasons: z
      .array(staleReasonSchema)
      .min(1)
      .max(7)
      .refine((reasons) => new Set(reasons).size === reasons.length, {
        message: 'Staleness reasons must be unique.',
      }),
  })
  .strict()

export const reportValiditySchema = z.discriminatedUnion('status', [
  currentReportValiditySchema,
  staleReportValiditySchema,
])

export type CurrentVerificationBindings = z.infer<typeof currentVerificationBindingsSchema>
export type VerificationDependencyEntry = z.infer<typeof verificationDependencyEntrySchema>
export type VerificationDependencyBinding = z.infer<typeof verificationDependencyBindingSchema>
export type StaleReason = z.infer<typeof staleReasonSchema>
export type ReportValidity = z.infer<typeof reportValiditySchema>
