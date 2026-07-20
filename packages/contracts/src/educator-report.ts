import { z } from 'zod'

import { exportLicenseSchema } from './artifact.js'
import { passwordInputSchema } from './auth.js'
import { conceptSpecSchema } from './concept.js'
import { portableSimulationExportSchema } from './export.js'
import { findingExplanationSchema } from './finding-explanation.js'
import { generationIdempotencyKeySchema } from './generation.js'
import { verificationPolicySchema } from './policy.js'
import { sha256Schema } from './primitives.js'
import { verificationReportSchema } from './report.js'
import { reportValiditySchema } from './validity.js'

const timestampSchema = z.iso.datetime({ offset: true })

export const reportPublicationSchema = z.discriminatedUnion('published', [
  z.object({ published: z.literal(false) }).strict(),
  z
    .object({
      published: z.literal(true),
      publishedAt: timestampSchema,
      exportLicense: exportLicenseSchema,
    })
    .strict(),
])

export const verificationReportDisplaySchema = z
  .object({
    simulationVersionId: z.uuid(),
    verificationRunId: z.uuid(),
    reportArtifactHash: sha256Schema,
    versionRevision: z.number().int().nonnegative(),
    conceptSpec: conceptSpecSchema,
    report: verificationReportSchema,
    validity: reportValiditySchema,
    policy: verificationPolicySchema,
    publication: reportPublicationSchema,
    badgeActive: z.boolean(),
    publishable: z.boolean(),
    // Optional model-authored commentary on a rejection. It is derived from the
    // persisted findings and is never part of the trusted verification report.
    narration: findingExplanationSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const { badgeActive, conceptSpec, policy, publication, publishable, report, validity } = value
    if (
      conceptSpec.domain !== policy.domain ||
      report.policy.id !== policy.id ||
      report.policy.version !== policy.version ||
      JSON.stringify(report.assumptions) !== JSON.stringify(policy.assumptions) ||
      JSON.stringify(report.limitations) !== JSON.stringify(policy.limitations)
    ) {
      context.addIssue({ code: 'custom', message: 'Report display bindings differ.' })
    }
    const currentVerified = validity.status === 'current' && report.verdict === 'verified'
    if (badgeActive !== currentVerified || (publishable && !currentVerified)) {
      context.addIssue({ code: 'custom', message: 'Badge or publication authority is invalid.' })
    }
    if (publication.published && !currentVerified) {
      context.addIssue({ code: 'custom', message: 'Published evidence must remain current.' })
    }
    if (publication.published && publishable) {
      context.addIssue({ code: 'custom', message: 'Published evidence cannot be republished.' })
    }
  })

export const publishVersionRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    verificationRunId: z.uuid(),
    exportLicense: exportLicenseSchema,
  })
  .strict()

export const archiveVersionRequestSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict()

export const reverifyVersionRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: generationIdempotencyKeySchema,
  })
  .strict()

export const simulationExportCommandSchema = z
  .object({ simulationId: z.uuid(), currentPassword: passwordInputSchema })
  .strict()

export const simulationExportResponseSchema = portableSimulationExportSchema

export type VerificationReportDisplay = z.infer<typeof verificationReportDisplaySchema>
export type PublishVersionRequest = z.infer<typeof publishVersionRequestSchema>
export type ArchiveVersionRequest = z.infer<typeof archiveVersionRequestSchema>
export type ReverifyVersionRequest = z.infer<typeof reverifyVersionRequestSchema>
export type SimulationExportCommand = z.infer<typeof simulationExportCommandSchema>
