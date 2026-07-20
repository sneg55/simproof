import { identifierSchema, semverSchema } from '@simproof/contracts'
import { z } from 'zod'

import { controlEvidenceSchema, relativeFilePathSchema } from './manifest-controls.js'
import { citationSchema, scientificReviewSchema } from './manifest-governance.js'

export const CURRENT_DOMAIN_PACK_SDK_VERSION = '1.0.0' as const

const stableSemverSchema = semverSchema.regex(/^\d+\.\d+\.\d+$/u, {
  message: 'Compatibility boundaries must use stable semantic versions.',
})
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)
const uniqueBy = <T>(values: readonly T[], key: (value: T) => string): boolean =>
  new Set(values.map(key)).size === values.length
const sameStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value))

const compareStableSemver = (left: string, right: string): number => {
  const [leftMajor = 0, leftMinor = 0, leftPatch = 0] = left.split('.').map(Number)
  const [rightMajor = 0, rightMinor = 0, rightPatch = 0] = right.split('.').map(Number)
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch
}

export const sdkCompatibilityRangeSchema = z
  .object({
    minimum: stableSemverSchema,
    maximumExclusive: stableSemverSchema,
  })
  .strict()
  .refine(({ maximumExclusive, minimum }) => compareStableSemver(minimum, maximumExclusive) < 0, {
    message: 'The SDK compatibility minimum must be below its exclusive maximum.',
  })

export type SdkCompatibilityRange = z.infer<typeof sdkCompatibilityRangeSchema>

export const isSdkVersionCompatible = (
  range: SdkCompatibilityRange,
  sdkVersion: string = CURRENT_DOMAIN_PACK_SDK_VERSION,
): boolean => {
  if (!stableSemverSchema.safeParse(sdkVersion).success) return false
  return (
    compareStableSemver(sdkVersion, range.minimum) >= 0 &&
    compareStableSemver(sdkVersion, range.maximumExclusive) < 0
  )
}

const unitSchema = z
  .object({
    quantity: identifierSchema,
    symbol: boundedText(24),
    dimension: identifierSchema,
  })
  .strict()

export const domainPackManifestSchema = z
  .object({
    schemaVersion: z.literal('1'),
    id: identifierSchema,
    version: semverSchema,
    title: boundedText(160),
    description: boundedText(1_000),
    learningScope: z.array(boundedText(500)).min(1).max(50),
    evidence: z
      .array(
        z
          .object({
            id: identifierSchema,
            kind: z.enum([
              'applicability',
              'derivation',
              'pedagogy',
              'tolerance-calibration',
              'verification-control',
            ]),
            description: boundedText(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    claims: z
      .array(
        z
          .object({
            id: identifierSchema,
            kind: z.enum(['assumption', 'constant', 'equation', 'numerical-method']),
            subject: boundedText(300),
            statement: boundedText(1_000),
            evidenceIds: z.array(identifierSchema).min(1).max(100),
          })
          .strict(),
      )
      .min(4)
      .max(300)
      .refine(
        (claims) =>
          ['assumption', 'constant', 'equation', 'numerical-method'].every((kind) =>
            claims.some((claim) => claim.kind === kind),
          ),
        { message: 'Claims must cover equations, constants, assumptions, and numerical methods.' },
      ),
    citations: z.array(citationSchema).min(1).max(100),
    units: z.array(unitSchema).min(1).max(100),
    applicability: z
      .object({
        description: boundedText(2_000),
        bounds: z
          .array(
            z
              .object({
                quantity: identifierSchema,
                unit: boundedText(24),
                minimum: z.object({ value: z.number().finite(), inclusive: z.boolean() }).strict(),
                maximum: z.object({ value: z.number().finite(), inclusive: z.boolean() }).strict(),
                outOfRange: z.enum(['boundary-failure', 'inapplicable']),
              })
              .strict()
              .refine(({ maximum, minimum }) => minimum.value < maximum.value),
          )
          .min(1)
          .max(100),
        singularities: z
          .array(
            z
              .object({
                id: identifierSchema,
                condition: boundedText(500),
                disposition: z.enum(['boundary-failure', 'inapplicable']),
              })
              .strict(),
          )
          .max(100),
        evidenceIds: z.array(identifierSchema).min(1).max(100),
      })
      .strict(),
    policies: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: semverSchema,
            evidenceIds: z.array(identifierSchema).min(1).max(100),
            toleranceEvidenceIds: z.array(identifierSchema).min(1).max(100),
            thresholds: z
              .array(
                z
                  .object({
                    id: identifierSchema,
                    quantity: identifierSchema,
                    unit: boundedText(24),
                    value: z.number().finite(),
                    evidenceIds: z.array(identifierSchema).min(1).max(100),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    findings: z
      .array(
        z
          .object({
            id: identifierSchema,
            classification: z.enum(['concept-boundary', 'candidate-boundary', 'scientific']),
            checkId: identifierSchema.nullable(),
            category: z.enum(['applicability', 'boundary', 'invariant', 'reference']),
            severity: z.enum(['error', 'warning']),
            lifecycle: z.enum(['boundary-failure', 'finding']),
            explanation: boundedText(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    controls: controlEvidenceSchema,
    capabilities: z
      .object({
        renderer: identifierSchema,
        features: z.array(identifierSchema).max(50),
        accessibleRepresentation: z
          .object({ summary: z.literal(true), table: z.literal(true) })
          .strict(),
      })
      .strict(),
    sdkCompatibility: sdkCompatibilityRangeSchema,
    scientificReview: scientificReviewSchema,
    contentInventory: z.array(relativeFilePathSchema).min(1).max(500),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [label, identifiers] of [
      ['evidence', manifest.evidence.map(({ id }) => id)],
      ['claim', manifest.claims.map(({ id }) => id)],
      ['citation', manifest.citations.map(({ id }) => id)],
      ['unit quantity', manifest.units.map(({ quantity }) => quantity)],
      ['policy', manifest.policies.map(({ id }) => id)],
      ['finding', manifest.findings.map(({ id }) => id)],
    ] as const) {
      if (!uniqueBy(identifiers, (value) => value)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate ${label} identifiers are forbidden.`,
        })
      }
    }
    const dimensionsBySymbol = new Map<string, string>()
    for (const unit of manifest.units) {
      const prior = dimensionsBySymbol.get(unit.symbol)
      if (prior !== undefined && prior !== unit.dimension) {
        context.addIssue({
          code: 'custom',
          message: 'A unit symbol cannot name multiple dimensions.',
        })
      }
      dimensionsBySymbol.set(unit.symbol, unit.dimension)
    }
    if (new Set(manifest.contentInventory).size !== manifest.contentInventory.length) {
      context.addIssue({ code: 'custom', message: 'Content inventory paths must be unique.' })
    }
    const allControlIds = Object.values(manifest.controls).flatMap((controls) =>
      controls.map(({ id }) => id),
    )
    if (new Set(allControlIds).size !== allControlIds.length) {
      context.addIssue({ code: 'custom', message: 'Control identifiers must be globally unique.' })
    }
    const evidenceIds = new Set(manifest.evidence.map(({ id }) => id))
    const reviewedPolicyKeys = manifest.scientificReview.subject.policies.map(
      ({ id, version }) => `${id}@${version}`,
    )
    const declaredPolicyKeys = manifest.policies.map(({ id, version }) => `${id}@${version}`)
    if (
      manifest.scientificReview.subject.pack.id !== manifest.id ||
      manifest.scientificReview.subject.pack.version !== manifest.version ||
      !sameStringSet(reviewedPolicyKeys, declaredPolicyKeys)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The review subject must exactly bind the manifest pack and policy identities.',
      })
    }
    const reviewIds = [
      manifest.scientificReview.reviewArtifact.id,
      ...manifest.scientificReview.audits.flatMap(({ exactChecks, id }) => [
        id,
        ...exactChecks.map((check) => check.id),
      ]),
    ]
    if (reviewIds.some((id) => !id.startsWith(`${manifest.id}.`))) {
      context.addIssue({
        code: 'custom',
        message: 'Review artifact, audit, and exact-check IDs must use the pack namespace.',
      })
    }
    const referencedEvidenceIds = [
      ...manifest.citations.flatMap(({ supportedEvidenceIds }) => supportedEvidenceIds),
      ...manifest.claims.flatMap(({ evidenceIds: ids }) => ids),
      ...manifest.applicability.evidenceIds,
      ...manifest.policies.flatMap(({ evidenceIds: ids, toleranceEvidenceIds }) => [
        ...ids,
        ...toleranceEvidenceIds,
      ]),
      ...manifest.policies.flatMap(({ thresholds }) =>
        thresholds.flatMap(({ evidenceIds: ids }) => ids),
      ),
      ...Object.values(manifest.controls).flatMap((controls) =>
        controls.map(({ evidenceId }) => evidenceId),
      ),
      ...manifest.scientificReview.audits.flatMap(({ evidenceIds: ids }) => ids),
    ]
    if (referencedEvidenceIds.some((id) => !evidenceIds.has(id))) {
      context.addIssue({ code: 'custom', message: 'Every evidence reference must be declared.' })
    }
  })

export type DomainPackManifest = z.infer<typeof domainPackManifestSchema>
