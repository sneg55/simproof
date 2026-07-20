import { z } from 'zod'

import { providerProvenanceSchema } from './generation-provenance.js'

// A plain-language narration of why a verifier rejected a generated artifact.
// It is model-authored commentary on a verdict the application already decided;
// it is never part of the trusted verification report and carries no authority
// over equations, tolerances, or the pass/fail outcome.
export const findingExplanationSchema = z
  .object({
    source: z.literal('model-commentary'),
    narration: z.string().trim().min(1).max(2_000),
    provenance: providerProvenanceSchema,
  })
  .strict()

export type FindingExplanation = z.infer<typeof findingExplanationSchema>
