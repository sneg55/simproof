import { z } from 'zod'

import { conceptSpecSchema } from './concept.js'
import { identifierSchema, semverSchema, sha256Schema } from './primitives.js'

const opaqueProviderIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)

export const redactedProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    requestCount: z.number().int().positive().max(20),
    costMicrousd: z.number().int().nonnegative().max(10_000_000_000),
  })
  .strict()

export const providerProvenanceSchema = z
  .object({
    provider: z.enum(['openai-responses', 'codex-sdk', 'fake']),
    model: opaqueProviderIdentifierSchema,
    templateVersion: semverSchema,
    requestIds: z.array(opaqueProviderIdentifierSchema).max(20),
    threadId: opaqueProviderIdentifierSchema.nullable(),
    usage: redactedProviderUsageSchema,
  })
  .strict()
  .superRefine(({ provider, requestIds, threadId }, context) => {
    if ((provider === 'codex-sdk') !== (threadId !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Codex provenance requires a thread ID; other providers must not supply one.',
      })
    }
    if (provider !== 'codex-sdk' && requestIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Non-Codex provenance requires at least one provider request ID.',
      })
    }
  })

export const conceptCompilationResultSchema = z
  .object({
    conceptSpec: conceptSpecSchema,
    provenance: providerProvenanceSchema,
  })
  .strict()
  .superRefine(({ provenance }, context) => {
    if (provenance.provider === 'codex-sdk') {
      context.addIssue({
        code: 'custom',
        message: 'Codex is not a supported concept compilation provider.',
      })
    }
  })

export const generationProvenanceSchema = z
  .object({
    schemaVersion: z.literal('1'),
    conceptCompiler: providerProvenanceSchema,
    codeGenerator: providerProvenanceSchema,
    conceptSpecHash: sha256Schema,
    artifactHashes: z.array(sha256Schema).min(1).max(20),
    verification: z
      .object({
        policyId: identifierSchema,
        policyVersion: semverSchema,
        policyHash: sha256Schema,
        domainPackId: identifierSchema,
        domainPackVersion: semverSchema,
        domainPackHash: sha256Schema,
        runnerVersion: semverSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(({ codeGenerator, conceptCompiler }, context) => {
    if (conceptCompiler.provider === 'codex-sdk') {
      context.addIssue({ code: 'custom', message: 'Concept compilation cannot use Codex.' })
    }
    if (codeGenerator.provider === 'openai-responses') {
      context.addIssue({ code: 'custom', message: 'Code generation cannot use Responses.' })
    }
  })

export type RedactedProviderUsage = z.infer<typeof redactedProviderUsageSchema>
export type ProviderProvenance = z.infer<typeof providerProvenanceSchema>
export type ConceptCompilationResult = z.infer<typeof conceptCompilationResultSchema>
export type GenerationProvenance = z.infer<typeof generationProvenanceSchema>
