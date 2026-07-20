export type {
  DomainPack,
  DomainScientificResult,
  DomainVerificationOutcome,
} from '@simproof/domain-pack-sdk'

export type DomainFixtureOutcome = 'boundary-failure' | 'inapplicable' | 'rejected' | 'verified'

export interface DomainFixtureDescriptor {
  readonly path: string
  readonly expectedOutcome: DomainFixtureOutcome
  readonly expectedFindingIds: readonly string[]
  readonly expectedErrorIds: readonly string[]
}
