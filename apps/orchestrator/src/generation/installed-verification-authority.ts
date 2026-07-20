import {
  type RunnerBinding,
  runnerBindingSchema,
  type VerificationDependencyBinding,
  type VerificationRun,
  verificationDependencyBindingSchema,
} from '@simproof/contracts'
import { err, type InstalledEvidenceResolver, ok } from '@simproof/persistence'
import { BUILT_IN_DOMAIN_PACK_REGISTRY, hashCanonicalJson } from '@simproof/verifier'

const AUTHORITY_MISMATCH =
  'Verification run does not match an installed trusted policy and domain pack.'

export interface InstalledVerificationAuthorityOptions {
  readonly runner: RunnerBinding
  readonly dependencies: VerificationDependencyBinding
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function matchesInstalledPair(run: VerificationRun): boolean {
  return BUILT_IN_DOMAIN_PACK_REGISTRY.values.some(
    (pack) =>
      run.policyContentHash === hashCanonicalJson(pack.policy) &&
      run.domainPackContentHash === pack.contentHash,
  )
}

export function createInstalledVerificationAuthorityResolver(
  options: InstalledVerificationAuthorityOptions,
): InstalledEvidenceResolver {
  const runner = deepFreeze(runnerBindingSchema.parse(options.runner))
  const dependencies = deepFreeze(verificationDependencyBindingSchema.parse(options.dependencies))
  return (run) => {
    if (!matchesInstalledPair(run)) return err('invalid-state', AUTHORITY_MISMATCH)
    return ok(
      deepFreeze({
        policyReferenceId: run.policyReferenceId,
        policyContentHash: run.policyContentHash,
        domainPackReferenceId: run.domainPackReferenceId,
        domainPackContentHash: run.domainPackContentHash,
        runnerVersion: runner.version,
        runnerProtocolVersion: runner.protocolVersion,
        dependencies,
      }),
    )
  }
}
