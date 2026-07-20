import { z } from 'zod'

import { MAX_PERSISTED_ARTIFACT_BYTES, storedArtifactSchema } from './artifact.js'
import { duplicateVersionLineageRecordSchema } from './educator-library.js'
import {
  conceptSpecRecordSchema,
  domainPackReferenceSchema,
  generatedArtifactSchema,
  generationAttemptSchema,
  generationRunSchema,
  publishedArtifactSchema,
  simulationSchema,
  simulationVersionSchema,
  verificationFindingRecordSchema,
  verificationPolicyReferenceSchema,
  verificationRunSchema,
} from './persistence.js'

const MAX_EXPORT_RECORDS = 100_000

const portableArtifactSchema = storedArtifactSchema
  .safeExtend({
    normalizationVersion: z.literal(1),
    content: z.string().max(MAX_PERSISTED_ARTIFACT_BYTES),
  })
  .strict()
  .refine(
    ({ byteLength, content }) => new TextEncoder().encode(content).byteLength === byteLength,
    {
      message: 'Portable artifact content must match its declared byte length.',
    },
  )

const recordsSchema = z
  .object({
    generationRuns: z.array(generationRunSchema).max(MAX_EXPORT_RECORDS),
    generationAttempts: z.array(generationAttemptSchema).max(MAX_EXPORT_RECORDS),
    conceptSpecs: z.array(conceptSpecRecordSchema).max(MAX_EXPORT_RECORDS),
    generatedArtifacts: z.array(generatedArtifactSchema).max(MAX_EXPORT_RECORDS),
    verificationRuns: z.array(verificationRunSchema).max(MAX_EXPORT_RECORDS),
    findings: z.array(verificationFindingRecordSchema).max(MAX_EXPORT_RECORDS),
    publications: z.array(publishedArtifactSchema).max(MAX_EXPORT_RECORDS),
    policyReferences: z.array(verificationPolicyReferenceSchema).max(MAX_EXPORT_RECORDS),
    domainPackReferences: z.array(domainPackReferenceSchema).max(MAX_EXPORT_RECORDS),
    lineages: z.array(duplicateVersionLineageRecordSchema).max(MAX_EXPORT_RECORDS),
  })
  .strict()

export const portableSimulationExportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    simulation: simulationSchema,
    versions: z.array(simulationVersionSchema).max(10_000),
    records: recordsSchema,
    artifacts: z.array(portableArtifactSchema).max(MAX_EXPORT_RECORDS),
  })
  .strict()
  .superRefine((value, context) => {
    const { records } = value
    const orderedCollections = [
      records.generationRuns,
      records.generationAttempts,
      records.conceptSpecs,
      records.generatedArtifacts,
      records.verificationRuns,
      records.findings,
      records.publications,
      records.policyReferences,
      records.domainPackReferences,
      records.lineages,
      value.artifacts,
    ]
    if (orderedCollections.some((records) => !uniqueAndSortedById(records))) {
      context.addIssue({
        code: 'custom',
        message: 'Portable export records must be unique and sorted.',
      })
    }
    if (!versionsAreOrdered(value.versions)) {
      context.addIssue({ code: 'custom', message: 'Portable export versions must be ordered.' })
    }
    const versionIds = new Set(value.versions.map(({ id }) => id))
    if (
      value.versions.some(({ simulationId }) => simulationId !== value.simulation.id) ||
      records.generationRuns.some(
        ({ simulationVersionId }) => !versionIds.has(simulationVersionId),
      ) ||
      records.conceptSpecs.some(
        ({ simulationVersionId }) => !versionIds.has(simulationVersionId),
      ) ||
      records.verificationRuns.some(
        ({ simulationVersionId }) => !versionIds.has(simulationVersionId),
      ) ||
      records.publications.some(
        ({ simulationVersionId }) => !versionIds.has(simulationVersionId),
      ) ||
      records.lineages.some(({ id }) => !versionIds.has(id))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Portable export records cross aggregate boundaries.',
      })
    }
    if (!relationshipsExist(value)) {
      context.addIssue({ code: 'custom', message: 'Portable export relationships are incomplete.' })
    }
  })

function uniqueAndSortedById(records: readonly { readonly id: string }[]): boolean {
  return records.every((record, index) => {
    const previous = records[index - 1]
    return previous === undefined || previous.id < record.id
  })
}

function versionsAreOrdered(
  versions: readonly { readonly id: string; readonly versionNumber: number }[],
): boolean {
  return versions.every((version, index) => {
    const previous = versions[index - 1]
    return (
      previous === undefined ||
      (previous.versionNumber < version.versionNumber && previous.id !== version.id)
    )
  })
}

function relationshipsExist(value: z.infer<typeof portableSimulationExportSchema>): boolean {
  const { records } = value
  const runIds = new Set(records.generationRuns.map(({ id }) => id))
  const attemptIds = new Set(records.generationAttempts.map(({ id }) => id))
  const generatedIds = new Set(records.generatedArtifacts.map(({ id }) => id))
  const verificationIds = new Set(records.verificationRuns.map(({ id }) => id))
  const artifactIds = new Set(value.artifacts.map(({ id }) => id))
  const policyIds = new Set(records.policyReferences.map(({ id }) => id))
  const domainPackIds = new Set(records.domainPackReferences.map(({ id }) => id))
  return (
    records.generationAttempts.every(({ generationRunId }) => runIds.has(generationRunId)) &&
    records.conceptSpecs.every(
      ({ artifact, generationRunId }) =>
        runIds.has(generationRunId) && artifactIds.has(artifact.artifactId),
    ) &&
    records.generatedArtifacts.every(
      ({ artifactBundle, generationAttemptId }) =>
        attemptIds.has(generationAttemptId) &&
        [artifactBundle.core, artifactBundle.renderer, artifactBundle.manifest].every(
          ({ artifactId }) => artifactIds.has(artifactId),
        ),
    ) &&
    records.verificationRuns.every(
      (run) =>
        generatedIds.has(run.generatedArtifactId) &&
        artifactIds.has(run.report.artifactId) &&
        policyIds.has(run.policyReferenceId) &&
        domainPackIds.has(run.domainPackReferenceId),
    ) &&
    records.findings.every(({ verificationRunId }) => verificationIds.has(verificationRunId)) &&
    records.publications.every(
      ({ generatedArtifactId, verificationRunId, verificationReport }) =>
        generatedIds.has(generatedArtifactId) &&
        verificationIds.has(verificationRunId) &&
        artifactIds.has(verificationReport.artifactId),
    )
  )
}

export type PortableSimulationExport = z.infer<typeof portableSimulationExportSchema>
