import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  conceptSpecSchema,
  rendererDataSchema,
  rendererFeaturesAreImplemented,
  type StaleReason,
  verificationRunSchema,
} from '@simproof/contracts'
import {
  type DomainPack,
  type DomainPackConformanceHarness,
  type DomainPackConformanceResult,
  type DomainPolicy,
  evaluateDomainPackConformance,
} from '@simproof/domain-pack-sdk'
import { compareEvidence, evidenceFromRun } from '@simproof/persistence'
import { BUILT_IN_DOMAIN_PACK_REGISTRY, isPublishable } from '@simproof/verifier'

import { attacksAreRejected, contentHash, inspectCandidate, inventoryFor } from './fingerprint.js'
import { incompleteFixtureCoversEveryGate } from './incomplete-fixture.js'

const repositoryRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))
const supportedPackIds = ['pendulum', 'projectile'] as const
type SupportedPackId = (typeof supportedPackIds)[number]
type RegisteredPack = (typeof BUILT_IN_DOMAIN_PACK_REGISTRY.values)[number]

const productionTypeScript = (root: string): readonly string[] => {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.startsWith('test-')
      ) {
        files.push(path)
      }
    }
  }
  visit(resolve(repositoryRoot, root))
  return files.sort()
}

const sdkIsDomainNeutral = (): boolean => {
  const source = productionTypeScript('packages/domain-pack-sdk/src')
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
  return (
    !/\b(projectile|pendulum|circuits|graphing)\b/iu.test(source) &&
    !/Math\.(?:cos|sin|sqrt|tan)|Math\.PI|9\.81/gu.test(source)
  )
}

const registrationIsStatic = (): boolean => {
  const source = readFileSync(
    resolve(repositoryRoot, 'packages/verifier/src/supported-domain-packs.ts'),
    'utf8',
  )
  return (
    source.includes('createDomainPackRegistry([') &&
    source.includes('PENDULUM_DOMAIN_PACK') &&
    source.includes('PROJECTILE_DOMAIN_PACK') &&
    !/\b(?:eval|Function)\s*\(|\bimport\s*\(|node:fs|readdir|process\.env|https?:\/\//u.test(source)
  )
}

const rendererEvidence = (
  packId: SupportedPackId,
  rendererId: string,
  featureIds: readonly string[],
): boolean => {
  const parsed = rendererDataSchema.safeParse({
    schemaVersion: '1',
    domain: packId,
    renderer: rendererId,
    features: featureIds,
  })
  return parsed.success && rendererFeaturesAreImplemented(packId, rendererId, parsed.data.features)
}

const unitIntegrity = (pack: RegisteredPack): boolean => {
  const units = new Map(pack.manifest.units.map((unit) => [unit.quantity, unit.symbol]))
  const symbols = new Set(pack.manifest.units.map(({ symbol }) => symbol))
  const quantityUses = [
    ...pack.manifest.applicability.bounds.map(({ quantity, unit }) => ({ quantity, unit })),
    ...pack.manifest.policies.flatMap(({ thresholds }) => thresholds),
    ...pack.manifest.controls.property.flatMap(({ generator }) => generator.ranges),
    ...pack.manifest.controls.boundary.map(({ threshold }) => threshold),
  ]
  if (quantityUses.some(({ quantity, unit }) => units.get(quantity) !== unit)) return false
  if (pack.manifest.controls.property.some(({ allowedError }) => !symbols.has(allowedError.unit))) {
    return false
  }
  const columns =
    pack.id === 'pendulum'
      ? pack.conformance.accessibleInputs.flatMap(
          (input) => pack.accessible.fromVerifiedOutput(input).table.columns,
        )
      : pack.conformance.accessibleInputs.flatMap(
          (input) => pack.accessible.fromVerifiedOutput(input).table.columns,
        )
  return columns.every(({ quantity, unit }) =>
    quantity === null ? unit === null : units.get(quantity) === unit,
  )
}

const sha = (character: string) => `sha256:${character.repeat(64)}`
const uuid = (character: string) =>
  `${character.repeat(8)}-${character.repeat(4)}-4${character.repeat(3)}-8${character.repeat(3)}-${character.repeat(12)}`

const staleEvidence = () => {
  const run = verificationRunSchema.parse({
    id: uuid('1'),
    simulationVersionId: uuid('2'),
    conceptSpecId: uuid('3'),
    conceptSpecArtifact: { artifactId: uuid('4'), role: 'concept-spec', contentHash: sha('1') },
    generatedArtifactId: uuid('5'),
    artifactBundle: {
      core: { artifactId: uuid('6'), role: 'core-source', contentHash: sha('2') },
      renderer: { artifactId: uuid('7'), role: 'renderer-data', contentHash: sha('3') },
      manifest: { artifactId: uuid('8'), role: 'manifest', contentHash: sha('4') },
    },
    policyReferenceId: uuid('9'),
    domainPackReferenceId: uuid('a'),
    policyContentHash: sha('5'),
    domainPackContentHash: sha('6'),
    runnerVersion: '1.0.0',
    runnerProtocolVersion: '1',
    dependencies: { schemaVersion: '1', entries: [], contentHash: sha('7') },
    observationHash: sha('8'),
    report: { artifactId: uuid('b'), role: 'verification-report', contentHash: sha('9') },
    verdict: 'verified',
    createdAt: '2026-07-17T00:00:00.000Z',
  })
  const recorded = evidenceFromRun(run)
  const changes = [
    { conceptSpecId: uuid('c') },
    { generatedArtifactId: uuid('d') },
    { observationHash: sha('a') },
    { policyContentHash: sha('b') },
    { domainPackContentHash: sha('c') },
    { runnerVersion: '1.0.1' },
    { dependencies: { ...recorded.dependencies, contentHash: sha('d') } },
  ] as const
  const reasonsFor = (current: unknown): readonly StaleReason[] => {
    const result = compareEvidence(run, current)
    if (!result.ok || result.value.status !== 'stale') return []
    return result.value.reasons
  }
  const individual = changes.map((change) => reasonsFor({ ...recorded, ...change }))
  const combinedInput = Object.assign({}, recorded, ...changes)
  const combined = reasonsFor(combinedInput)
  const validity = { status: 'stale' as const, reasons: [...combined] }
  const trustedAccess = isPublishable(run, validity)
  return {
    individual,
    combined,
    blocksBadge: !trustedAccess,
    blocksPreview: !trustedAccess,
    blocksPublish: !trustedAccess,
  }
}

export function createRepositoryConformanceHarness(packId: string): DomainPackConformanceHarness {
  if (!supportedPackIds.includes(packId as SupportedPackId)) {
    throw new TypeError(`Unsupported built-in domain pack: ${packId}`)
  }
  const id = packId as SupportedPackId
  const pack = BUILT_IN_DOMAIN_PACK_REGISTRY.get(id)
  if (pack === undefined) throw new TypeError(`Unregistered built-in domain pack: ${id}`)
  const expectedInventory = inventoryFor(repositoryRoot, id)
  const harness: DomainPackConformanceHarness = {
    readFixture: (path) =>
      JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as unknown,
    inspectInventory: (paths) => ({
      ...inspectCandidate(repositoryRoot, paths, expectedInventory),
      attacksRejected: attacksAreRejected(),
    }),
    computeContentHash: (paths) => {
      const inspected = inspectCandidate(repositoryRoot, paths, expectedInventory)
      if (
        !inspected.canonical ||
        !inspected.complete ||
        !inspected.inRoot ||
        !inspected.regularFiles
      ) {
        throw new TypeError(`Cannot hash an invalid ${id} inventory.`)
      }
      return contentHash(repositoryRoot, paths)
    },
    registrationValid: () =>
      JSON.stringify(BUILT_IN_DOMAIN_PACK_REGISTRY.ids) === JSON.stringify(supportedPackIds) &&
      new Set(BUILT_IN_DOMAIN_PACK_REGISTRY.values.map(({ policy }) => policy.id)).size ===
        supportedPackIds.length &&
      BUILT_IN_DOMAIN_PACK_REGISTRY.get(id) === pack,
    unitIntegrity: () => unitIntegrity(pack),
    rendererRegistered: (rendererId) => rendererEvidence(id, rendererId, []),
    rendererFeaturesValid: (rendererId, featureIds) => rendererEvidence(id, rendererId, featureIds),
    sdkIsDomainNeutral,
    registrationIsStatic,
    incompleteFixtureCoverage: () => incompleteFixtureCoversEveryGate(pack, harness),
    unsupportedDomainsAbsent: () =>
      BUILT_IN_DOMAIN_PACK_REGISTRY.get('circuits') === undefined &&
      BUILT_IN_DOMAIN_PACK_REGISTRY.get('graphing') === undefined &&
      !conceptSpecSchema.safeParse({ schemaVersion: '1', domain: 'circuits' }).success &&
      !conceptSpecSchema.safeParse({ schemaVersion: '1', domain: 'graphing' }).success,
    staleEvidence,
  }
  return harness
}

export function evaluateBuiltInDomainPack<
  Policy extends DomainPolicy,
  Concept,
  ReferenceInput,
  ReferenceOutput,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, ReferenceInput, ReferenceOutput, VerifiedOutput>,
): DomainPackConformanceResult {
  const registered = BUILT_IN_DOMAIN_PACK_REGISTRY.get(pack.id)
  if ((registered as unknown) !== (pack as unknown)) {
    throw new TypeError(`Domain pack ${pack.id} is not the registered instance.`)
  }
  return evaluateDomainPackConformance(pack, createRepositoryConformanceHarness(pack.id))
}
