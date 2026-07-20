import { evaluateBuiltInDomainPack } from '@simproof/domain-pack-conformance'
import {
  CURRENT_DOMAIN_PACK_SDK_VERSION,
  createDomainPackRegistry,
  domainPackManifestSchema,
  isSdkVersionCompatible,
} from '@simproof/domain-pack-sdk'
import { PENDULUM_DOMAIN_PACK } from '@simproof/verifier'

export const inspectPendulumAuthoringExample = () => {
  const manifest = domainPackManifestSchema.parse(PENDULUM_DOMAIN_PACK.manifest)
  const registry = createDomainPackRegistry([PENDULUM_DOMAIN_PACK] as const)
  const citationsById = new Map(manifest.citations.map((citation) => [citation.id, citation]))
  const conformance = evaluateBuiltInDomainPack(PENDULUM_DOMAIN_PACK)

  return {
    currentSdkVersion: CURRENT_DOMAIN_PACK_SDK_VERSION,
    isCompatible: isSdkVersionCompatible(manifest.sdkCompatibility),
    manifest,
    registry,
    citationsById,
    conformance,
  }
}
