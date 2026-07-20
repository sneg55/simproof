import type { ParameterRange, Sha256, VerificationFinding } from '@simproof/contracts'

import type { DomainPackManifest } from './manifest.js'
import type { DomainPackReviewBinding } from './review-binding.js'

export interface RuntimeSchema<Value> {
  readonly safeParse: (
    input: unknown,
  ) =>
    | { readonly success: true; readonly data: Value }
    | { readonly success: false; readonly error: unknown }
}

export interface DomainScientificResult {
  readonly verdict: 'inapplicable' | 'rejected' | 'verified'
  readonly findings: readonly VerificationFinding[]
  readonly sampleCount: number
}

export interface DomainPolicy {
  readonly domain: string
  readonly id: string
  readonly version: string
  readonly checks: readonly string[]
  readonly sampling: unknown
  readonly assumptions: readonly string[]
  readonly limitations: readonly string[]
}

export type DomainVerificationOutcome =
  | Readonly<{ ok: false; error: Readonly<{ id: string; message: string }> }>
  | Readonly<{ ok: true; result: DomainScientificResult }>

export interface AccessibleDomainRepresentation {
  readonly scene: Readonly<{
    renderer: string
    rows: readonly Readonly<Record<string, number | string>>[]
    assumptions: readonly string[]
    limitations: readonly string[]
  }>
  readonly assumptions: readonly string[]
  readonly limitations: readonly string[]
  readonly summary: string
  readonly table: Readonly<{
    caption: string
    columns: readonly Readonly<{
      key: string
      label: string
      quantity: string | null
      unit: string | null
    }>[]
    rows: readonly Readonly<Record<string, number | string>>[]
  }>
}

export interface DomainReportAdapter {
  readonly validateObservations: (observations: readonly unknown[]) => readonly unknown[]
  readonly verifyObservations: (observations: readonly unknown[]) => DomainScientificResult
  readonly expectedInputs: () => readonly unknown[]
  readonly observationInput: (observation: unknown) => unknown
  readonly testedParameters: (observations: readonly unknown[]) => readonly ParameterRange[]
  readonly sampleCountForCheck: (checkId: string, result: DomainScientificResult) => number
}

export interface DomainPackConformanceCases<ReferenceInput, VerifiedOutput> {
  readonly referenceInputs: readonly ReferenceInput[]
  readonly supportedInputs: readonly ReferenceInput[]
  readonly unsupportedInputs: readonly ReferenceInput[]
  readonly accessibleInputs: readonly VerifiedOutput[]
  readonly isApplicable: (input: ReferenceInput) => boolean
  readonly runPropertyControl: (
    control: DomainPackManifest['controls']['property'][number],
  ) => boolean
  readonly runBoundaryControl: (
    control: DomainPackManifest['controls']['boundary'][number],
  ) => boolean
}

export interface DomainPack<
  Policy extends DomainPolicy = DomainPolicy,
  Concept = unknown,
  ReferenceInput = unknown,
  ReferenceOutput = unknown,
  VerifiedOutput = unknown,
> {
  readonly manifest: DomainPackManifest
  readonly id: Policy['domain']
  readonly version: string
  readonly contentHash: Sha256
  readonly reviewBinding: DomainPackReviewBinding
  readonly policy: Policy
  readonly conceptSchema: RuntimeSchema<Concept>
  readonly validateConcept: (input: unknown) => { readonly ok: boolean }
  readonly reference: (input: ReferenceInput) => ReferenceOutput
  readonly verify: (candidate: unknown) => DomainVerificationOutcome
  readonly materializeFixture: (fixtureId: string, source: unknown) => unknown
  readonly report: DomainReportAdapter
  readonly accessible: Readonly<{
    rendererId: string
    verifiedOutputSchema: RuntimeSchema<VerifiedOutput>
    sceneSchema: RuntimeSchema<AccessibleDomainRepresentation['scene']>
    fromVerifiedOutput: (output: VerifiedOutput) => AccessibleDomainRepresentation
  }>
  readonly conformance: DomainPackConformanceCases<ReferenceInput, VerifiedOutput>
}

export interface RegisteredDomainPack {
  readonly id: string
  readonly version: string
  readonly manifest: DomainPackManifest
  readonly policy: DomainPolicy
  readonly contentHash: Sha256
  readonly reviewBinding: DomainPackReviewBinding
}
