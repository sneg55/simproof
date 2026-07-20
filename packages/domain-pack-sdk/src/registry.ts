import type { DomainPack, DomainPolicy, RegisteredDomainPack } from './domain-pack.js'
import { domainPackManifestSchema, isSdkVersionCompatible } from './manifest.js'
import { domainPackReviewBindingSchema } from './review-binding.js'

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label} IDs.`)
}

const isPlainContainer = (value: object): boolean => {
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

const deepFreezePackData = <Value>(value: Value): Value => {
  const visited = new WeakSet<object>()
  const freeze = (candidate: unknown): void => {
    if (
      (typeof candidate !== 'object' && typeof candidate !== 'function') ||
      candidate === null ||
      (typeof candidate === 'object' && !isPlainContainer(candidate))
    ) {
      return
    }
    if (visited.has(candidate)) return
    visited.add(candidate)
    for (const nested of Object.values(candidate)) freeze(nested)
    Object.freeze(candidate)
  }
  freeze(value)
  return value
}

const freezeRuntimeSchema = <Value extends object>(schema: Value): Value => Object.freeze(schema)

const freezeRegisteredPack = <Pack extends RegisteredDomainPack>(pack: Pack): Pack => {
  const candidate = pack as unknown as Record<string, unknown>
  if (typeof candidate.conceptSchema === 'object' && candidate.conceptSchema !== null) {
    Object.freeze(candidate.conceptSchema)
  }
  if (typeof candidate.accessible === 'object' && candidate.accessible !== null) {
    const accessible = candidate.accessible as Record<string, unknown>
    if (
      typeof accessible.verifiedOutputSchema === 'object' &&
      accessible.verifiedOutputSchema !== null
    ) {
      Object.freeze(accessible.verifiedOutputSchema)
    }
    if (typeof accessible.sceneSchema === 'object' && accessible.sceneSchema !== null) {
      Object.freeze(accessible.sceneSchema)
    }
  }
  return deepFreezePackData(pack)
}

const validateRegisteredPack = (candidate: RegisteredDomainPack): void => {
  const manifest = domainPackManifestSchema.parse(candidate.manifest)
  const reviewBinding = domainPackReviewBindingSchema.parse(candidate.reviewBinding)
  if (!isSdkVersionCompatible(manifest.sdkCompatibility)) {
    throw new TypeError('The domain pack is incompatible with the installed SDK.')
  }
  if (
    candidate.id !== manifest.id ||
    candidate.version !== manifest.version ||
    candidate.policy.domain !== manifest.id
  ) {
    throw new TypeError('Domain pack, manifest, version, and policy identities must match.')
  }
  if (
    !manifest.policies.some(
      ({ id, version }) => id === candidate.policy.id && version === candidate.policy.version,
    )
  ) {
    throw new TypeError('The active policy must be declared by the domain-pack manifest.')
  }
  const reviewedPolicies = manifest.scientificReview.subject.policies
  if (
    reviewBinding.reviewArtifactId !== manifest.scientificReview.reviewArtifact.id ||
    reviewBinding.pack.id !== candidate.id ||
    reviewBinding.pack.version !== candidate.version ||
    reviewBinding.pack.contentHash !== candidate.contentHash ||
    JSON.stringify(reviewBinding.policies) !== JSON.stringify(reviewedPolicies) ||
    JSON.stringify(reviewBinding.baseRevision) !==
      JSON.stringify(manifest.scientificReview.reviewArtifact.baseRevision) ||
    JSON.stringify(reviewBinding.auditIds) !==
      JSON.stringify(manifest.scientificReview.audits.map(({ id }) => id))
  ) {
    throw new TypeError('The external review binding must match the exact registered pack content.')
  }
}

export const defineDomainPack = <
  Policy extends DomainPolicy,
  Concept,
  ReferenceInput,
  ReferenceOutput,
  VerifiedOutput,
>(
  candidate: DomainPack<Policy, Concept, ReferenceInput, ReferenceOutput, VerifiedOutput>,
): DomainPack<Policy, Concept, ReferenceInput, ReferenceOutput, VerifiedOutput> => {
  const manifest = domainPackManifestSchema.parse(candidate.manifest)
  validateRegisteredPack({ ...candidate, manifest })
  assertUnique(candidate.policy.checks, 'policy check')
  assertUnique(
    manifest.findings.map(({ id }) => id),
    'finding',
  )
  if (candidate.accessible.rendererId !== manifest.capabilities.renderer) {
    throw new TypeError('The accessible adapter must match the declared application renderer.')
  }
  return deepFreezePackData({
    ...candidate,
    manifest: deepFreezePackData(manifest),
    policy: deepFreezePackData(candidate.policy),
    conceptSchema: freezeRuntimeSchema(candidate.conceptSchema),
    accessible: {
      ...candidate.accessible,
      verifiedOutputSchema: freezeRuntimeSchema(candidate.accessible.verifiedOutputSchema),
      sceneSchema: freezeRuntimeSchema(candidate.accessible.sceneSchema),
    },
  })
}

export interface DomainPackRegistry<Packs extends readonly RegisteredDomainPack[]> {
  readonly ids: readonly Packs[number]['id'][]
  readonly values: readonly Packs[number][]
  readonly get: (domain: string) => Packs[number] | undefined
}

export const createDomainPackRegistry = <const Packs extends readonly RegisteredDomainPack[]>(
  packs: Packs,
): DomainPackRegistry<Packs> => {
  for (const pack of packs) validateRegisteredPack(pack)
  assertUnique(
    packs.map(({ id }) => id),
    'domain pack',
  )
  assertUnique(
    packs.map(({ policy }) => policy.id),
    'active policy',
  )
  const values = Object.freeze(packs.map((pack) => freezeRegisteredPack(pack)))
  return deepFreezePackData({
    ids: Object.freeze(values.map(({ id }) => id)),
    values,
    get: (domain: string) => values.find(({ id }) => id === domain),
  })
}
