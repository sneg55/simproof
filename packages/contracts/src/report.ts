import { z } from 'zod'

import { verificationFindingSchema } from './finding.js'
import { identifierSchema, parameterRangeSchema, semverSchema, sha256Schema } from './primitives.js'

const versionedContentSchema = z
  .object({
    id: identifierSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  })
  .strict()

export const runnerBindingSchema = z
  .object({
    version: semverSchema,
    protocolVersion: z.literal('1'),
  })
  .strict()

const checkResultSchema = z
  .object({
    id: identifierSchema,
    outcome: z.enum(['passed', 'failed', 'not-applicable']),
    sampleCount: z.number().int().positive(),
  })
  .strict()

const uniqueBy = <T>(values: T[], key: (value: T) => string) =>
  new Set(values.map((value) => key(value))).size === values.length

export const verificationReportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    reportId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    conceptSpecHash: sha256Schema,
    artifact: z.object({ hash: sha256Schema }).strict(),
    policy: versionedContentSchema,
    domainPack: versionedContentSchema,
    runner: runnerBindingSchema,
    observationHash: sha256Schema,
    verdict: z.enum(['verified', 'rejected', 'inapplicable']),
    checks: z
      .array(checkResultSchema)
      .min(1)
      .max(100)
      .refine((checks) => uniqueBy(checks, ({ id }) => id), {
        message: 'Check results must be unique.',
      }),
    findings: z.array(verificationFindingSchema).max(10_000),
    testedScope: z
      .object({
        parameters: z
          .array(parameterRangeSchema)
          .min(1)
          .max(100)
          .refine((parameters) => uniqueBy(parameters, ({ parameter }) => parameter), {
            message: 'Tested parameters must be unique.',
          }),
        sampleCount: z.number().int().positive(),
        samplingGridHash: sha256Schema,
      })
      .strict(),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict()
  .superRefine(({ checks, findings, testedScope, verdict }, context) => {
    const hasError = findings.some(({ severity }) => severity === 'error')
    const hasScientificError = findings.some(
      ({ category, severity }) =>
        severity === 'error' && (category === 'mismatch' || category === 'invariant'),
    )
    const hasApplicabilityError = findings.some(
      ({ category, severity }) => severity === 'error' && category === 'applicability',
    )
    const hasFailedCheck = checks.some(({ outcome }) => outcome === 'failed')

    if (checks.some(({ sampleCount }) => sampleCount > testedScope.sampleCount)) {
      context.addIssue({
        code: 'custom',
        message: 'Check sample counts may not exceed the total tested sample count.',
      })
    }

    if (
      verdict === 'verified' &&
      (hasError || checks.some(({ outcome }) => outcome !== 'passed'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Verified reports may contain only passing checks and no errors.',
      })
    }
    if (verdict === 'rejected' && (!hasFailedCheck || !hasScientificError)) {
      context.addIssue({
        code: 'custom',
        message: 'Rejected reports require a failed check and scientific error.',
      })
    }
    if (
      verdict === 'inapplicable' &&
      (hasFailedCheck || !hasApplicabilityError || hasScientificError)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inapplicable reports require applicability evidence and no scientific failure.',
      })
    }
  })

export type RunnerBinding = z.infer<typeof runnerBindingSchema>
export type VerificationReport = z.infer<typeof verificationReportSchema>
