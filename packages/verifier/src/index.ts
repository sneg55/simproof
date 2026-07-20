export type { DomainFixtureDescriptor, DomainPack } from './domain-pack.js'
export * from './domains/pendulum/index.js'
export * from './domains/projectile/index.js'
export { hashCanonicalJson, hashNormalizedSource, normalizeSource } from './hashing.js'
export { createPolicyRegistry } from './policy-registry.js'
export {
  createVerificationReport,
  currentBindingsFor,
  type DomainVerificationResult,
  type VerificationReportInput,
} from './report-builder.js'
export { assessReportValidity, isPublishable } from './report-validity.js'
export {
  BUILT_IN_DOMAIN_PACK_REGISTRY,
  getDomainPack,
  PENDULUM_DOMAIN_PACK,
  PROJECTILE_DOMAIN_PACK,
} from './supported-domain-packs.js'
