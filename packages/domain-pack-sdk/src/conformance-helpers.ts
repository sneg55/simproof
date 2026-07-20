import type { StaleReason } from '@simproof/contracts'
import type { DomainPackConformanceHarness } from './conformance-types.js'
import type { AccessibleDomainRepresentation, DomainPack, DomainPolicy } from './domain-pack.js'
import type { DomainPackManifest } from './manifest.js'

const expectedStaleReasons = [
  'concept-changed',
  'artifact-changed',
  'observations-changed',
  'policy-changed',
  'domain-pack-changed',
  'runner-changed',
  'dependencies-changed',
] as const satisfies readonly StaleReason[]

const finiteTree = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteTree)
  if (typeof value === 'object' && value !== null) return Object.values(value).every(finiteTree)
  return true
}

const dataTree = (value: unknown, ancestors: ReadonlySet<object> = new Set()): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  const nestedAncestors = new Set(ancestors).add(value)
  if (Array.isArray(value)) return value.every((entry) => dataTree(entry, nestedAncestors))
  if (Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.values(value).every((entry) => dataTree(entry, nestedAncestors))
}

export const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const deepFrozen = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return true
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen)
}

const actualFixtureOutcome = (outcome: ReturnType<DomainPack['verify']>) =>
  outcome.ok
    ? {
        kind: 'scientific' as const,
        verdict: outcome.result.verdict,
        findingIds: outcome.result.findings.map(({ id }) => id),
        sampleCount: outcome.result.sampleCount,
      }
    : { kind: 'boundary-failure' as const, errorId: outcome.error.id }

export const fixtureClassPasses = <
  Policy extends DomainPolicy,
  Concept,
  Input,
  Output,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, Input, Output, VerifiedOutput>,
  harness: DomainPackConformanceHarness,
  controls: DomainPackManifest['controls']['positive' | 'negative'],
): boolean => {
  try {
    return controls.every((control) => {
      const fixture = pack.materializeFixture(control.id, harness.readFixture(control.path))
      return same(actualFixtureOutcome(pack.verify(fixture)), control.expected)
    })
  } catch {
    return false
  }
}

export const referencePasses = <
  Policy extends DomainPolicy,
  Concept,
  Input,
  Output,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, Input, Output, VerifiedOutput>,
): { deterministic: boolean; finite: boolean } => {
  if (pack.conformance.referenceInputs.length === 0) {
    return { deterministic: false, finite: false }
  }
  let deterministic = true
  let finite = true
  try {
    for (const input of pack.conformance.referenceInputs) {
      const first = pack.reference(input)
      const second = pack.reference(input)
      deterministic &&= same(first, second)
      finite &&= finiteTree(first)
    }
  } catch {
    return { deterministic: false, finite: false }
  }
  return { deterministic, finite }
}

export const staleEvidencePasses = (harness: DomainPackConformanceHarness): boolean => {
  try {
    const evidence = harness.staleEvidence()
    return (
      same(
        evidence.individual,
        expectedStaleReasons.map((reason) => [reason]),
      ) &&
      same(evidence.combined, expectedStaleReasons) &&
      evidence.blocksBadge &&
      evidence.blocksPreview &&
      evidence.blocksPublish
    )
  } catch {
    return false
  }
}

const tableColumnsCoverRows = (table: AccessibleDomainRepresentation['table']): boolean => {
  const columnKeys = table.columns.map(({ key }) => key)
  return (
    columnKeys.length > 0 &&
    new Set(columnKeys).size === columnKeys.length &&
    table.columns.every(
      ({ key, label, quantity, unit }) =>
        key.trim().length > 0 &&
        label.trim().length > 0 &&
        ((quantity === null && unit === null) ||
          (quantity !== null && quantity.trim().length > 0 && unit !== null)),
    ) &&
    table.rows.every(
      (row) =>
        Object.keys(row).length === columnKeys.length &&
        columnKeys.every((key) => Object.hasOwn(row, key)),
    )
  )
}

export const presentationPasses = <
  Policy extends DomainPolicy,
  Concept,
  Input,
  Output,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, Input, Output, VerifiedOutput>,
): boolean =>
  pack.conformance.accessibleInputs.length > 0 &&
  pack.conformance.accessibleInputs.every((input) => {
    try {
      const presentation = pack.accessible.fromVerifiedOutput(input)
      return (
        pack.accessible.verifiedOutputSchema.safeParse(input).success &&
        dataTree(presentation) &&
        presentation.summary.trim().length > 0 &&
        presentation.table.caption.trim().length > 0 &&
        tableColumnsCoverRows(presentation.table) &&
        presentation.table.rows.length > 0 &&
        presentation.scene.renderer === pack.accessible.rendererId &&
        pack.accessible.sceneSchema.safeParse(presentation.scene).success &&
        same(presentation.scene.rows, presentation.table.rows) &&
        same(presentation.scene.assumptions, presentation.assumptions) &&
        same(presentation.scene.limitations, presentation.limitations) &&
        presentation.assumptions.length > 0 &&
        presentation.limitations.length > 0
      )
    } catch {
      return false
    }
  })

export const unitIntegrityPasses = <
  Policy extends DomainPolicy,
  Concept,
  Input,
  Output,
  VerifiedOutput,
>(
  pack: DomainPack<Policy, Concept, Input, Output, VerifiedOutput>,
): boolean => {
  try {
    const units = new Map(pack.manifest.units.map(({ quantity, symbol }) => [quantity, symbol]))
    const declaredUnits = new Set(pack.manifest.units.map(({ symbol }) => symbol))
    const quantityUses = [
      ...pack.manifest.applicability.bounds.map(({ quantity, unit }) => ({ quantity, unit })),
      ...pack.manifest.policies.flatMap(({ thresholds }) => thresholds),
      ...pack.manifest.controls.property.flatMap(({ generator }) => generator.ranges),
      ...pack.manifest.controls.boundary.map(({ threshold }) => threshold),
    ]
    return (
      quantityUses.every(({ quantity, unit }) => units.get(quantity) === unit) &&
      pack.manifest.controls.property.every(({ allowedError }) =>
        declaredUnits.has(allowedError.unit),
      ) &&
      pack.conformance.accessibleInputs.every((input) =>
        pack.accessible
          .fromVerifiedOutput(input)
          .table.columns.every(({ quantity, unit }) =>
            quantity === null ? unit === null : units.get(quantity) === unit,
          ),
      )
    )
  } catch {
    return false
  }
}

export const controlsCover = (
  manifest: DomainPackManifest,
  kind: DomainPackManifest['controls']['boundary'][number]['covers']['kind'],
  expectedIds: readonly string[],
): boolean => {
  const covered = manifest.controls.boundary
    .filter(({ covers }) => covers.kind === kind)
    .map(({ covers }) => covers.id)
    .sort()
  return same(covered, [...expectedIds].sort())
}

export const safeBoolean = (operation: () => boolean): boolean => {
  try {
    return operation()
  } catch {
    return false
  }
}
