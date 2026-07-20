import type { StaleReason } from '@simproof/contracts'

export const DOMAIN_PACK_CONFORMANCE_IDS = Object.freeze({
  manifest: 'PACK-001',
  registration: 'PACK-002',
  identity: 'PACK-003',
  compatibility: 'PACK-004',
  inventoryCanonical: 'PACK-005',
  inventoryAttacks: 'PACK-006',
  fingerprint: 'PACK-007',
  evidenceLinks: 'PACK-008',
  unitIntegrity: 'PACK-009',
  applicabilitySemantics: 'PACK-010',
  singularityCoverage: 'PACK-011',
  stableIds: 'PACK-012',
  fixtureParity: 'PACK-013',
  toleranceBoundaries: 'PACK-014',
  applicabilityBoundaries: 'PACK-015',
  propertyControls: 'PACK-016',
  adapterSchema: 'PACK-017',
  rendererFeatures: 'PACK-018',
  accessibleEquivalent: 'PACK-019',
  sdkDomainNeutral: 'PACK-020',
  staticRegistration: 'PACK-021',
  staleEvidence: 'PACK-022',
  incompleteFixture: 'PACK-023',
  unsupportedDomains: 'PACK-024',
} as const)

export type DomainPackConformanceId =
  (typeof DOMAIN_PACK_CONFORMANCE_IDS)[keyof typeof DOMAIN_PACK_CONFORMANCE_IDS]

export interface DomainPackConformanceHarness {
  readonly readFixture: (path: string) => unknown
  readonly inspectInventory: (paths: readonly string[]) => Readonly<{
    canonical: boolean
    complete: boolean
    inRoot: boolean
    regularFiles: boolean
    attacksRejected: boolean
  }>
  readonly computeContentHash: (paths: readonly string[]) => string
  readonly registrationValid: () => boolean
  readonly unitIntegrity: () => boolean
  readonly rendererRegistered: (rendererId: string) => boolean
  readonly rendererFeaturesValid: (rendererId: string, featureIds: readonly string[]) => boolean
  readonly sdkIsDomainNeutral: () => boolean
  readonly registrationIsStatic: () => boolean
  readonly incompleteFixtureCoverage: () => boolean
  readonly unsupportedDomainsAbsent: () => boolean
  readonly staleEvidence: () => Readonly<{
    individual: readonly (readonly StaleReason[])[]
    combined: readonly StaleReason[]
    blocksBadge: boolean
    blocksPreview: boolean
    blocksPublish: boolean
  }>
}

export type DomainPackConformanceResult =
  | Readonly<{
      ok: true
      failures: readonly []
      passed: readonly DomainPackConformanceId[]
    }>
  | Readonly<{
      ok: false
      failures: readonly DomainPackConformanceId[]
      passed: readonly DomainPackConformanceId[]
    }>
