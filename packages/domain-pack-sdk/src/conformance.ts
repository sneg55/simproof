import { sha256Schema } from '@simproof/contracts'
import {
  controlsCover,
  deepFrozen,
  fixtureClassPasses,
  presentationPasses,
  referencePasses,
  safeBoolean,
  staleEvidencePasses,
  unitIntegrityPasses,
} from './conformance-helpers.js'
import {
  DOMAIN_PACK_CONFORMANCE_IDS,
  type DomainPackConformanceHarness,
  type DomainPackConformanceId,
  type DomainPackConformanceResult,
} from './conformance-types.js'
import type { DomainPack, DomainPolicy, RegisteredDomainPack } from './domain-pack.js'
import {
  type DomainPackManifest,
  domainPackManifestSchema,
  isSdkVersionCompatible,
} from './manifest.js'

export {
  DOMAIN_PACK_CONFORMANCE_IDS,
  type DomainPackConformanceHarness,
  type DomainPackConformanceId,
  type DomainPackConformanceResult,
} from './conformance-types.js'

const allGateIds = Object.freeze(Object.values(DOMAIN_PACK_CONFORMANCE_IDS))

const recordGate = (
  failures: DomainPackConformanceId[],
  id: DomainPackConformanceId,
  passes: boolean,
): void => {
  if (!passes) failures.push(id)
}

const identityPasses = (pack: RegisteredDomainPack, manifest: DomainPackManifest): boolean =>
  pack.id === manifest.id &&
  pack.version === manifest.version &&
  pack.policy.domain === pack.id &&
  pack.reviewBinding.pack.id === pack.id &&
  pack.reviewBinding.pack.version === pack.version &&
  pack.reviewBinding.pack.contentHash === pack.contentHash &&
  pack.reviewBinding.reviewArtifactId === manifest.scientificReview.reviewArtifact.id &&
  manifest.policies.some(
    ({ id, version }) => id === pack.policy.id && version === pack.policy.version,
  )

const evidenceLinksPass = (manifest: DomainPackManifest): boolean => {
  const citationEvidence = new Set(
    manifest.citations.flatMap(({ supportedEvidenceIds }) => supportedEvidenceIds),
  )
  const governingEvidence = manifest.evidence
    .filter(({ kind }) => ['applicability', 'derivation', 'tolerance-calibration'].includes(kind))
    .map(({ id }) => id)
  const reviewedScientificEvidence = new Set(
    manifest.scientificReview.audits
      .filter(({ kind }) => kind === 'scientific')
      .flatMap(({ evidenceIds }) => evidenceIds),
  )
  return (
    manifest.claims.every(({ evidenceIds }) =>
      evidenceIds.some((id) => citationEvidence.has(id)),
    ) &&
    governingEvidence.every((id) => citationEvidence.has(id) || reviewedScientificEvidence.has(id))
  )
}

const inventoryPasses = (
  manifest: DomainPackManifest,
  harness: DomainPackConformanceHarness,
): boolean =>
  safeBoolean(() => {
    const inspected = harness.inspectInventory(manifest.contentInventory)
    return inspected.canonical && inspected.complete && inspected.inRoot && inspected.regularFiles
  })

const hashesPass = (
  pack: RegisteredDomainPack,
  manifest: DomainPackManifest,
  harness: DomainPackConformanceHarness,
): boolean =>
  safeBoolean(() => {
    const first = harness.computeContentHash(manifest.contentInventory)
    const second = harness.computeContentHash(manifest.contentInventory)
    return (
      sha256Schema.safeParse(first).success &&
      sha256Schema.safeParse(pack.contentHash).success &&
      first === second &&
      first === pack.contentHash &&
      deepFrozen(pack.policy)
    )
  })

const applicabilityPasses = <Input>(conformance: {
  readonly supportedInputs: readonly Input[]
  readonly unsupportedInputs: readonly Input[]
  readonly isApplicable: (input: Input) => boolean
}): boolean =>
  safeBoolean(
    () =>
      conformance.supportedInputs.length > 0 &&
      conformance.unsupportedInputs.length > 0 &&
      conformance.supportedInputs.every(conformance.isApplicable) &&
      conformance.unsupportedInputs.every((input) => !conformance.isApplicable(input)),
  )

const stableIdsPass = (pack: RegisteredDomainPack, manifest: DomainPackManifest): boolean =>
  new Set(pack.policy.checks).size === pack.policy.checks.length &&
  pack.policy.checks.every((id) => id.startsWith(`${pack.id}.`)) &&
  manifest.findings.every(
    ({ checkId, id, lifecycle }) =>
      id.startsWith(`${pack.id}.`) &&
      (lifecycle === 'boundary-failure'
        ? checkId === null
        : checkId !== null && pack.policy.checks.includes(checkId)),
  )

export const evaluateDomainPackConformance = <
  Policy extends DomainPolicy,
  Concept,
  Input,
  Output,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, Input, Output, VerifiedOutput>,
  harness: DomainPackConformanceHarness,
): DomainPackConformanceResult => {
  const failures: DomainPackConformanceId[] = []
  const parsedManifest = domainPackManifestSchema.safeParse(pack.manifest)
  if (!parsedManifest.success) {
    return { ok: false, failures: allGateIds, passed: [] }
  }
  const manifest = parsedManifest.data
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.registration,
    safeBoolean(harness.registrationValid),
  )
  recordGate(failures, DOMAIN_PACK_CONFORMANCE_IDS.identity, identityPasses(pack, manifest))
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.compatibility,
    isSdkVersionCompatible(manifest.sdkCompatibility),
  )
  recordGate(failures, DOMAIN_PACK_CONFORMANCE_IDS.evidenceLinks, evidenceLinksPass(manifest))
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.inventoryCanonical,
    inventoryPasses(manifest, harness),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.inventoryAttacks,
    safeBoolean(() => harness.inspectInventory(manifest.contentInventory).attacksRejected),
  )
  const computedHashes = hashesPass(pack, manifest, harness)
  const reference = referencePasses(pack)
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.fingerprint,
    computedHashes && reference.deterministic && reference.finite,
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.unitIntegrity,
    unitIntegrityPasses(pack) && safeBoolean(harness.unitIntegrity),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.applicabilitySemantics,
    applicabilityPasses(pack.conformance),
  )
  const singularityIds = manifest.applicability.singularities.map(({ id }) => id)
  const declaredFindingIds = new Set(manifest.findings.map(({ id }) => id))
  recordGate(failures, DOMAIN_PACK_CONFORMANCE_IDS.stableIds, stableIdsPass(pack, manifest))
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.fixtureParity,
    fixtureClassPasses(pack, harness, manifest.controls.positive) &&
      fixtureClassPasses(pack, harness, manifest.controls.negative),
  )
  const emittedIds = manifest.controls.positive
    .concat(manifest.controls.negative)
    .flatMap(({ expected }) =>
      expected.kind === 'scientific' ? expected.findingIds : [expected.errorId],
    )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.stableIds,
    emittedIds.every((id) => declaredFindingIds.has(id)),
  )
  const toleranceIds = manifest.policies.flatMap(({ thresholds }) => thresholds.map(({ id }) => id))
  const endpointIds = manifest.applicability.bounds.flatMap(({ quantity }) => [
    `${quantity}.minimum`,
    `${quantity}.maximum`,
  ])
  const failingBoundaryKinds = new Set(
    manifest.controls.boundary
      .filter((control) => !safeBoolean(() => pack.conformance.runBoundaryControl(control)))
      .map(({ covers }) => covers.kind),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.singularityCoverage,
    controlsCover(manifest, 'singularity', singularityIds) &&
      !failingBoundaryKinds.has('singularity'),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.toleranceBoundaries,
    controlsCover(manifest, 'tolerance-threshold', toleranceIds) &&
      !failingBoundaryKinds.has('tolerance-threshold'),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.applicabilityBoundaries,
    controlsCover(manifest, 'applicability-endpoint', endpointIds) &&
      !failingBoundaryKinds.has('applicability-endpoint'),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.propertyControls,
    safeBoolean(() =>
      manifest.controls.property.every((control) => pack.conformance.runPropertyControl(control)),
    ),
  )
  const presentation = presentationPasses(pack)
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.adapterSchema,
    safeBoolean(() => harness.rendererRegistered(pack.accessible.rendererId)) && presentation,
  )
  recordGate(failures, DOMAIN_PACK_CONFORMANCE_IDS.accessibleEquivalent, presentation)
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.rendererFeatures,
    safeBoolean(() =>
      harness.rendererFeaturesValid(pack.accessible.rendererId, manifest.capabilities.features),
    ),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.sdkDomainNeutral,
    safeBoolean(harness.sdkIsDomainNeutral),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.staticRegistration,
    safeBoolean(harness.registrationIsStatic),
  )
  recordGate(failures, DOMAIN_PACK_CONFORMANCE_IDS.staleEvidence, staleEvidencePasses(harness))
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.incompleteFixture,
    safeBoolean(harness.incompleteFixtureCoverage),
  )
  recordGate(
    failures,
    DOMAIN_PACK_CONFORMANCE_IDS.unsupportedDomains,
    safeBoolean(harness.unsupportedDomainsAbsent),
  )
  const uniqueFailures = [...new Set(failures)]
  const passed = allGateIds.filter((id) => !uniqueFailures.includes(id))
  return uniqueFailures.length === 0
    ? { ok: true, failures: [], passed }
    : { ok: false, failures: uniqueFailures, passed }
}
