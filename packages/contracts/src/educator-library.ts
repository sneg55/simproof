import { z } from 'zod'
import { exportLicenseSchema } from './artifact.js'
import { conceptSpecSchema } from './concept.js'
import { redactedProviderUsageSchema } from './generation-provenance.js'
import { simulationLifecycleStateSchema } from './lifecycle.js'
import { identifierSchema, semverSchema, sha256Schema } from './primitives.js'
import { staleReasonSchema } from './validity.js'

const recordIdSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })
const unique = <T>(values: T[]) => new Set(values).size === values.length

export const seedMetadataSchema = z
  .object({
    seedId: identifierSchema,
    bundledVersion: semverSchema,
    contentHash: sha256Schema,
    domain: z.enum(['projectile', 'pendulum']),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    contentLicense: z.literal('CC-BY-4.0'),
    attribution: z.string().trim().min(1).max(500),
  })
  .strict()

export const simulationSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('teacher') }).strict(),
  z.object({ kind: z.literal('seed'), seed: seedMetadataSchema }).strict(),
])

export const browserVerificationSummarySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }).strict(),
  z
    .object({
      status: z.literal('current'),
      verificationRunId: recordIdSchema,
      verdict: z.enum(['verified', 'rejected', 'inapplicable']),
      artifactHash: sha256Schema,
      reportHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      status: z.literal('stale'),
      verificationRunId: recordIdSchema,
      verdict: z.enum(['verified', 'rejected', 'inapplicable']),
      artifactHash: sha256Schema,
      reportHash: sha256Schema,
      reasons: z.array(staleReasonSchema).min(1).max(7).refine(unique),
    })
    .strict(),
])

export const educatorActionSchema = z.enum([
  'start-generation',
  'cancel-generation',
  'preview',
  'view-report',
  'publish',
  'reverify',
  'start-blank-version',
  'duplicate',
  'export',
  'archive',
  'delete',
])

export const libraryVersionSummarySchema = z
  .object({
    id: recordIdSchema,
    versionNumber: z.number().int().positive(),
    state: simulationLifecycleStateSchema,
    revision: z.number().int().nonnegative(),
    domain: z.enum(['projectile', 'pendulum']).nullable(),
    verification: browserVerificationSummarySchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine(({ state, verification }, context) => {
    const invalid =
      (state === 'draft' && verification.status !== 'none') ||
      (state === 'stale' && verification.status !== 'stale') ||
      ((state === 'verified' || state === 'published') &&
        (verification.status !== 'current' || verification.verdict !== 'verified')) ||
      (state === 'rejected' &&
        (verification.status !== 'current' || verification.verdict !== 'rejected'))
    if (invalid) {
      context.addIssue({
        code: 'custom',
        message: 'Lifecycle state and browser verification summary are inconsistent.',
      })
    }
  })

export const librarySimulationSummarySchema = z
  .object({
    id: recordIdSchema,
    title: z.string().trim().min(1).max(120),
    source: simulationSourceSchema,
    currentVersion: libraryVersionSummarySchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(({ createdAt, updatedAt }) => Date.parse(updatedAt) >= Date.parse(createdAt), {
    message: 'Simulation update cannot precede creation.',
  })
  .superRefine(({ currentVersion, source }, context) => {
    if (
      source.kind === 'seed' &&
      currentVersion.domain !== null &&
      source.seed.domain !== currentVersion.domain
    ) {
      context.addIssue({ code: 'custom', message: 'Seed and version domains must match.' })
    }
  })

export const libraryQuerySchema = z
  .object({
    search: z.string().trim().max(120).default(''),
    domains: z
      .array(z.enum(['projectile', 'pendulum']))
      .max(2)
      .refine(unique)
      .default([]),
    states: z.array(simulationLifecycleStateSchema).max(8).refine(unique).default([]),
    sources: z
      .array(z.enum(['seed', 'teacher']))
      .max(2)
      .refine(unique)
      .default([]),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

export const libraryPageSchema = z
  .object({
    items: z.array(librarySimulationSummarySchema).max(100),
    nextCursor: z.string().min(1).max(500).nullable(),
  })
  .strict()
  .refine(({ items }) => unique(items.map(({ id }) => id)), {
    message: 'A library page cannot repeat a simulation.',
  })

export const publicProviderProvenanceSchema = z
  .object({
    provider: z.enum(['openai-responses', 'codex-sdk', 'fake']),
    model: z.string().trim().min(1).max(200),
    templateVersion: semverSchema,
    usage: redactedProviderUsageSchema,
  })
  .strict()

export const duplicateVersionLineageSchema = z
  .object({
    kind: z.literal('duplicate'),
    sourceSimulationId: recordIdSchema,
    sourceVersionId: recordIdSchema,
    sourceVersionNumber: z.number().int().positive(),
    sourceRevision: z.number().int().nonnegative(),
    duplicatedAt: timestampSchema,
  })
  .strict()

export const duplicateVersionLineageRecordSchema = duplicateVersionLineageSchema
  .extend({ id: recordIdSchema })
  .strict()

export const educatorVersionDetailSchema = z
  .object({
    summary: libraryVersionSummarySchema,
    conceptSpec: conceptSpecSchema.nullable(),
    exportLicense: exportLicenseSchema.nullable(),
    generationProvenance: z
      .object({
        conceptCompiler: publicProviderProvenanceSchema,
        codeGenerator: publicProviderProvenanceSchema,
      })
      .strict()
      .nullable(),
    lineage: duplicateVersionLineageSchema.nullable(),
    availableActions: z.array(educatorActionSchema).max(11).refine(unique),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine(({ conceptSpec, summary }, context) => {
    if (conceptSpec !== null && summary.domain !== conceptSpec.domain) {
      context.addIssue({ code: 'custom', message: 'Concept and version domains must match.' })
    }
  })

export const simulationDetailSchema = z
  .object({
    simulation: librarySimulationSummarySchema,
    selectedVersion: educatorVersionDetailSchema,
  })
  .strict()

export const createDraftRequestSchema = z
  .object({ title: z.string().trim().min(1).max(120) })
  .strict()

/** Starts an evidence-free draft in the same simulation lineage. */
export const startBlankVersionRequestSchema = z
  .object({
    sourceVersionId: recordIdSchema,
    expectedSourceRevision: z.number().int().nonnegative(),
  })
  .strict()

/** Duplicates editable concept/candidate content while resetting verification and publication. */
export const duplicateSimulationRequestSchema = startBlankVersionRequestSchema
  .extend({ title: z.string().trim().min(1).max(120) })
  .strict()

export const versionHistorySchema = z
  .object({
    simulationId: recordIdSchema,
    versions: z.array(educatorVersionDetailSchema).max(10_000),
  })
  .strict()
  .refine(({ versions }) => unique(versions.map(({ summary }) => summary.id)), {
    message: 'Version history cannot repeat a version.',
  })

export type SeedMetadata = z.infer<typeof seedMetadataSchema>
export type LibraryQuery = z.infer<typeof libraryQuerySchema>
export type LibraryPage = z.infer<typeof libraryPageSchema>
export type SimulationDetail = z.infer<typeof simulationDetailSchema>
export type EducatorVersionDetail = z.infer<typeof educatorVersionDetailSchema>
export type CreateDraftRequest = z.infer<typeof createDraftRequestSchema>
export type StartBlankVersionRequest = z.infer<typeof startBlankVersionRequestSchema>
export type DuplicateSimulationRequest = z.infer<typeof duplicateSimulationRequestSchema>
export type VersionHistory = z.infer<typeof versionHistorySchema>
