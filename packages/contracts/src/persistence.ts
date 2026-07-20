import { z } from 'zod'

import {
  artifactBundleSchema,
  conceptSpecArtifactBindingSchema,
  exportLicenseSchema,
  verificationReportArtifactBindingSchema,
} from './artifact.js'
import { verificationFindingSchema } from './finding.js'
import {
  generationAttemptOutcomeSchema,
  generationRunStatusSchema,
  simulationLifecycleStateSchema,
} from './lifecycle.js'
import { identifierSchema, semverSchema, sha256Schema } from './primitives.js'
import { verificationDependencyBindingSchema } from './validity.js'

const recordIdSchema = z.uuid()
const timestampSchema = z.iso.datetime({ offset: true })
const nullableRecordIdSchema = recordIdSchema.nullable()
const isAtOrAfter = (later: string, earlier: string) => Date.parse(later) >= Date.parse(earlier)
const allPresent = (values: readonly unknown[]) => values.every((value) => value !== null)
const haveMatchingPresence = (left: unknown, right: unknown) => (left === null) === (right === null)

export const simulationSchema = z
  .object({
    id: recordIdSchema,
    title: z.string().trim().min(1).max(120),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(({ createdAt, updatedAt }) => isAtOrAfter(updatedAt, createdAt), {
    message: 'Simulation update timestamp must not precede creation.',
  })

const statesRequiringCurrentEvidence = new Set(['rejected', 'verified', 'stale', 'published'])

export const simulationVersionSchema = z
  .object({
    id: recordIdSchema,
    simulationId: recordIdSchema,
    versionNumber: z.number().int().positive(),
    state: simulationLifecycleStateSchema,
    revision: z.number().int().nonnegative(),
    activeConceptSpecId: nullableRecordIdSchema,
    activeGeneratedArtifactId: nullableRecordIdSchema,
    activeArtifactBundle: artifactBundleSchema.nullable(),
    activeVerificationRunId: nullableRecordIdSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const completeEvidence = [
      record.activeConceptSpecId,
      record.activeGeneratedArtifactId,
      record.activeArtifactBundle,
      record.activeVerificationRunId,
    ]
    if (!haveMatchingPresence(record.activeGeneratedArtifactId, record.activeArtifactBundle)) {
      context.addIssue({
        code: 'custom',
        message: 'Generated artifact identity and exact bundle must be bound together.',
      })
    }
    if (!isAtOrAfter(record.updatedAt, record.createdAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Simulation-version update timestamp must not precede creation.',
      })
    }
    if (record.activeGeneratedArtifactId !== null && record.activeConceptSpecId === null) {
      context.addIssue({
        code: 'custom',
        message: 'Generated candidate content requires its concept specification.',
      })
    }
    if (record.state === 'draft' && record.activeVerificationRunId !== null) {
      context.addIssue({ code: 'custom', message: 'Draft versions cannot bind verification.' })
    }
    if (
      record.state === 'verifying' &&
      !allPresent([
        record.activeConceptSpecId,
        record.activeGeneratedArtifactId,
        record.activeArtifactBundle,
      ])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Verifying versions require a concept specification and candidate artifact.',
      })
    }
    if (statesRequiringCurrentEvidence.has(record.state) && !allPresent(completeEvidence)) {
      context.addIssue({
        code: 'custom',
        message:
          'Evidence-bearing lifecycle states require exact concept, artifact, and run bindings.',
      })
    }
  })

const opaqueSessionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const generationRunSchema = z
  .object({
    id: recordIdSchema,
    simulationVersionId: recordIdSchema,
    status: generationRunStatusSchema,
    maxAttempts: z.number().int().min(1).max(3),
    codexSessionId: opaqueSessionIdSchema.nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine(({ completedAt, createdAt, status }, context) => {
    if (status === 'running' && completedAt !== null) {
      context.addIssue({ code: 'custom', message: 'Running generation runs cannot be completed.' })
    }
    if (status !== 'running' && completedAt === null) {
      context.addIssue({ code: 'custom', message: 'Terminal generation runs require completion.' })
    }
    if (completedAt !== null && !isAtOrAfter(completedAt, createdAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Generation completion cannot precede creation.',
      })
    }
  })

const operationalAttemptOutcomes = new Set(['provider-failed', 'runner-failed', 'invalid-output'])
const activeAttemptOutcomes = new Set(['pending', 'running'])

export const generationAttemptSchema = z
  .object({
    id: recordIdSchema,
    generationRunId: recordIdSchema,
    attemptNumber: z.number().int().min(1).max(3),
    outcome: generationAttemptOutcomeSchema,
    generatedArtifactId: nullableRecordIdSchema,
    stableErrorId: identifierSchema.nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const isActive = activeAttemptOutcomes.has(record.outcome)
    if (isActive === (record.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only terminal generation attempts have a completion timestamp.',
      })
    }
    if (record.completedAt !== null && !isAtOrAfter(record.completedAt, record.createdAt)) {
      context.addIssue({ code: 'custom', message: 'Attempt completion cannot precede creation.' })
    }
    if (
      (record.outcome === 'verified' || record.outcome === 'rejected') &&
      record.generatedArtifactId === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scientific attempt outcomes require a generated artifact.',
      })
    }
    if (operationalAttemptOutcomes.has(record.outcome) !== (record.stableErrorId !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only operational failures require a stable error identifier.',
      })
    }
  })

export const conceptSpecRecordSchema = z
  .object({
    id: recordIdSchema,
    simulationVersionId: recordIdSchema,
    generationRunId: recordIdSchema,
    schemaVersion: z.literal('1'),
    domain: z.enum(['projectile', 'pendulum']),
    artifact: conceptSpecArtifactBindingSchema,
    createdAt: timestampSchema,
  })
  .strict()

export const generatedArtifactSchema = z
  .object({
    id: recordIdSchema,
    generationAttemptId: recordIdSchema,
    artifactBundle: artifactBundleSchema,
    exportLicense: exportLicenseSchema,
    createdAt: timestampSchema,
  })
  .strict()

const versionedReferenceFields = {
  id: recordIdSchema,
  version: semverSchema,
  contentHash: sha256Schema,
  createdAt: timestampSchema,
}

export const verificationPolicyReferenceSchema = z
  .object({ ...versionedReferenceFields, policyId: identifierSchema })
  .strict()

export const domainPackReferenceSchema = z
  .object({ ...versionedReferenceFields, domainPackId: identifierSchema })
  .strict()

export const persistenceEvidenceBindingsSchema = z
  .object({
    conceptSpecId: recordIdSchema,
    conceptSpecArtifact: conceptSpecArtifactBindingSchema,
    generatedArtifactId: recordIdSchema,
    artifactBundle: artifactBundleSchema,
    policyReferenceId: recordIdSchema,
    domainPackReferenceId: recordIdSchema,
    policyContentHash: sha256Schema,
    domainPackContentHash: sha256Schema,
    runnerVersion: semverSchema,
    runnerProtocolVersion: z.literal('1'),
    dependencies: verificationDependencyBindingSchema,
    observationHash: sha256Schema,
    report: verificationReportArtifactBindingSchema,
  })
  .strict()

export const verificationRunSchema = persistenceEvidenceBindingsSchema
  .extend({
    id: recordIdSchema,
    simulationVersionId: recordIdSchema,
    verdict: z.enum(['verified', 'rejected', 'inapplicable']),
    createdAt: timestampSchema,
  })
  .strict()

export const verificationFindingRecordSchema = z
  .object({
    id: recordIdSchema,
    verificationRunId: recordIdSchema,
    ordinal: z.number().int().min(0).max(9_999),
    finding: verificationFindingSchema,
    createdAt: timestampSchema,
  })
  .strict()

export const publishedArtifactSchema = z
  .object({
    id: recordIdSchema,
    simulationVersionId: recordIdSchema,
    generatedArtifactId: recordIdSchema,
    artifactBundle: artifactBundleSchema,
    verificationRunId: recordIdSchema,
    verificationReport: verificationReportArtifactBindingSchema,
    exportLicense: exportLicenseSchema,
    publishedAt: timestampSchema,
  })
  .strict()

export type Simulation = z.infer<typeof simulationSchema>
export type SimulationVersion = z.infer<typeof simulationVersionSchema>
export type GenerationRun = z.infer<typeof generationRunSchema>
export type GenerationAttempt = z.infer<typeof generationAttemptSchema>
export type ConceptSpecRecord = z.infer<typeof conceptSpecRecordSchema>
export type GeneratedArtifact = z.infer<typeof generatedArtifactSchema>
export type VerificationPolicyReference = z.infer<typeof verificationPolicyReferenceSchema>
export type DomainPackReference = z.infer<typeof domainPackReferenceSchema>
export type PersistenceEvidenceBindings = z.infer<typeof persistenceEvidenceBindingsSchema>
export type VerificationRun = z.infer<typeof verificationRunSchema>
export type VerificationFindingRecord = z.infer<typeof verificationFindingRecordSchema>
export type PublishedArtifact = z.infer<typeof publishedArtifactSchema>
