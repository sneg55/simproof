import type { DomainPackConformanceHarness } from './index.js'

export const staleReasons = [
  'concept-changed',
  'artifact-changed',
  'observations-changed',
  'policy-changed',
  'domain-pack-changed',
  'runner-changed',
  'dependencies-changed',
] as const

export const conformanceHarness = (): DomainPackConformanceHarness => ({
  readFixture: (path) => (path.endsWith('wrong.json') ? 'wrong' : 'correct'),
  inspectInventory: () => ({
    canonical: true,
    complete: true,
    inRoot: true,
    regularFiles: true,
    attacksRejected: true,
  }),
  computeContentHash: () => `sha256:${'1'.repeat(64)}`,
  registrationValid: () => true,
  unitIntegrity: () => true,
  rendererRegistered: (id) => id === 'example-line',
  rendererFeaturesValid: (_id, features) => features.length === 0,
  sdkIsDomainNeutral: () => true,
  registrationIsStatic: () => true,
  incompleteFixtureCoverage: () => true,
  unsupportedDomainsAbsent: () => true,
  staleEvidence: () => ({
    individual: staleReasons.map((reason) => [reason]),
    combined: [...staleReasons],
    blocksBadge: true,
    blocksPreview: true,
    blocksPublish: true,
  }),
})

export const counterReferenceReplacement = () => {
  let value = 0
  return { reference: () => ({ output: (value += 1) }) }
}
