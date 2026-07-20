import { identifierSchema, semverSchema, staleReasonSchema } from '@simproof/contracts'
import { z } from 'zod'

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)

export const citationSchema = z
  .object({
    id: identifierSchema,
    title: boundedText(300),
    authors: z.array(boundedText(160)).max(30),
    issuingBody: boundedText(200).optional(),
    edition: boundedText(120),
    locator: z
      .object({
        source: z
          .string()
          .trim()
          .max(500)
          .refine(
            (value) => value.startsWith('https://') || /^doi:10\.[0-9]{4,9}\/[!-~]+$/u.test(value),
            { message: 'A citation locator must be an HTTPS URL or DOI.' },
          ),
        section: boundedText(200),
        equation: boundedText(120).optional(),
      })
      .strict(),
    supportedEvidenceIds: z.array(identifierSchema).min(1).max(100),
  })
  .strict()
  .refine(({ authors, issuingBody }) => authors.length > 0 || issuingBody !== undefined, {
    message: 'A citation must name authors or an issuing body.',
  })

const reviewActorSchema = z
  .object({
    id: identifierSchema,
    displayName: boundedText(160),
    type: z.enum(['automated', 'human']),
    humanCredentialClaim: z.boolean(),
  })
  .strict()
  .refine(({ humanCredentialClaim, type }) => type === 'human' || !humanCredentialClaim, {
    message: 'An automated actor cannot claim a human credential.',
  })

const exactReviewCheckSchema = z
  .object({
    id: identifierSchema,
    command: boundedText(500),
    outcome: z.literal('passed'),
  })
  .strict()

const reviewAuditSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['accessibility', 'maintainer', 'pedagogical', 'scientific']),
    actor: reviewActorSchema,
    decision: z.literal('accepted'),
    evidenceIds: z.array(identifierSchema).min(1).max(100),
    exactChecks: z.array(exactReviewCheckSchema).min(1).max(100),
  })
  .strict()
  .refine(
    ({ exactChecks }) => new Set(exactChecks.map(({ id }) => id)).size === exactChecks.length,
    { message: 'Exact review check IDs must be unique within an audit.' },
  )

const maintainerSchema = z
  .object({
    id: identifierSchema,
    name: boundedText(160),
    contact: boundedText(320),
    actorType: z.enum(['automated', 'human']),
    humanCredentialClaim: z.boolean(),
  })
  .strict()
  .refine(({ actorType, humanCredentialClaim }) => actorType === 'human' || !humanCredentialClaim, {
    message: 'An automated maintainer cannot claim a human credential.',
  })

const baseRevisionSchema = z
  .object({
    kind: z.literal('git-commit'),
    reference: z.string().regex(/^[0-9a-f]{40}$/u),
  })
  .strict()

const auditKinds = ['accessibility', 'maintainer', 'pedagogical', 'scientific'] as const

export const scientificReviewSchema = z
  .object({
    reviewedAt: z.iso.date(),
    subject: z
      .object({
        pack: z.object({ id: identifierSchema, version: semverSchema }).strict(),
        policies: z
          .array(z.object({ id: identifierSchema, version: semverSchema }).strict())
          .min(1)
          .max(50),
      })
      .strict(),
    reviewArtifact: z
      .object({
        id: identifierSchema,
        baseRevision: baseRevisionSchema,
      })
      .strict(),
    audits: z.array(reviewAuditSchema).min(4).max(30),
    applicabilityDerivation: boundedText(5_000),
    numericalMethodJustification: boundedText(5_000),
    changeControl: z
      .object({
        compatibility: z.enum(['backward-compatible', 'breaking', 'initial']),
        classifications: z
          .array(
            z.enum([
              'accessibility',
              'governance',
              'implementation',
              'pedagogical',
              'scientific',
              'security',
            ]),
          )
          .min(1)
          .max(6),
        staleReasons: z.array(staleReasonSchema).max(7),
      })
      .strict(),
    maintainers: z.array(maintainerSchema).min(1).max(30),
  })
  .strict()
  .superRefine((review, context) => {
    const policyKeys = review.subject.policies.map(({ id, version }) => `${id}@${version}`)
    if (new Set(policyKeys).size !== policyKeys.length) {
      context.addIssue({ code: 'custom', message: 'Reviewed policy identities must be unique.' })
    }
    const auditIds = review.audits.map(({ id }) => id)
    if (new Set(auditIds).size !== auditIds.length) {
      context.addIssue({ code: 'custom', message: 'Review audit IDs must be unique.' })
    }
    if (!auditKinds.every((kind) => review.audits.some((audit) => audit.kind === kind))) {
      context.addIssue({ code: 'custom', message: 'Every required audit kind must be accepted.' })
    }
    const exactCheckIds = review.audits.flatMap(({ exactChecks }) =>
      exactChecks.map(({ id }) => id),
    )
    if (new Set(exactCheckIds).size !== exactCheckIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Exact review check IDs must be globally unique.',
      })
    }
    const maintainerIds = review.maintainers.map(({ id }) => id)
    if (new Set(maintainerIds).size !== maintainerIds.length) {
      context.addIssue({ code: 'custom', message: 'Maintainer IDs must be unique.' })
    }
    if (
      !review.audits
        .filter(({ kind }) => kind === 'maintainer')
        .every(({ actor }) => maintainerIds.includes(actor.id))
    ) {
      context.addIssue({ code: 'custom', message: 'Maintainer audits must name an owner.' })
    }
    if (
      new Set(review.changeControl.classifications).size !==
      review.changeControl.classifications.length
    ) {
      context.addIssue({ code: 'custom', message: 'Change classifications must be unique.' })
    }
    if (
      new Set(review.changeControl.staleReasons).size !== review.changeControl.staleReasons.length
    ) {
      context.addIssue({ code: 'custom', message: 'Stale reasons must be unique.' })
    }
    if (
      (review.changeControl.compatibility === 'initial') !==
      (review.changeControl.staleReasons.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Initial reviews have no stale predecessor; later reviews must name stale reasons.',
      })
    }
  })
