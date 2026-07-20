import type {
  ArtifactBundle,
  DomainPackReference,
  ExportLicense,
  GeneratedArtifact,
  PortableSimulationExport,
  ReportValidity,
  Sha256,
  Simulation,
  SimulationLifecycleState,
  SimulationVersion,
  StaleReason,
  StoredArtifact,
  VerificationDependencyBinding,
  VerificationPolicyReference,
  VerificationRun,
} from '@simproof/contracts'

export type PersistenceErrorCode =
  | 'conflict'
  | 'corrupt-artifact'
  | 'database-error'
  | 'hash-mismatch'
  | 'immutable-record'
  | 'invalid-backup'
  | 'invalid-hash'
  | 'invalid-input'
  | 'invalid-state'
  | 'invalid-transition'
  | 'not-found'

export interface PersistenceError {
  readonly code: PersistenceErrorCode
  readonly message: string
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PersistenceError }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = (code: PersistenceErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
})

export interface CurrentVerificationEvidence {
  readonly conceptSpecHash: Sha256
  readonly artifactBundle: ArtifactBundle
  readonly observationHash: Sha256
  readonly policy: Pick<VerificationPolicyReference, 'policyId' | 'version' | 'contentHash'>
  readonly domainPack: Pick<DomainPackReference, 'domainPackId' | 'version' | 'contentHash'>
  readonly runner: { readonly version: string; readonly protocolVersion: '1' }
  readonly dependencies: VerificationDependencyBinding
}

export interface TrustedVerificationEnvironment {
  readonly policyReferenceId: string
  readonly policyContentHash: Sha256
  readonly domainPackReferenceId: string
  readonly domainPackContentHash: Sha256
  readonly runnerVersion: string
  readonly runnerProtocolVersion: '1'
  readonly dependencies: VerificationDependencyBinding
}

export type InstalledEvidenceResolver = (
  run: VerificationRun,
) => Result<TrustedVerificationEnvironment>

export type ExportedSimulation = PortableSimulationExport

export type {
  ArtifactBundle,
  ExportLicense,
  GeneratedArtifact,
  ReportValidity,
  Sha256,
  Simulation,
  SimulationLifecycleState,
  SimulationVersion,
  StaleReason,
  StoredArtifact,
  VerificationRun,
}
