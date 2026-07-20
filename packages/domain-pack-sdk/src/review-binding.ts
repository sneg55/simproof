import { identifierSchema, semverSchema, sha256Schema } from '@simproof/contracts'
import { z } from 'zod'

export const domainPackReviewBindingSchema = z
  .object({
    schemaVersion: z.literal('1'),
    reviewArtifactId: identifierSchema,
    pack: z
      .object({ id: identifierSchema, version: semverSchema, contentHash: sha256Schema })
      .strict(),
    policies: z
      .array(z.object({ id: identifierSchema, version: semverSchema }).strict())
      .min(1)
      .max(50),
    baseRevision: z
      .object({ kind: z.literal('git-commit'), reference: z.string().regex(/^[0-9a-f]{40}$/u) })
      .strict(),
    auditIds: z.array(identifierSchema).min(4).max(30),
  })
  .strict()

export type DomainPackReviewBinding = z.infer<typeof domainPackReviewBindingSchema>
