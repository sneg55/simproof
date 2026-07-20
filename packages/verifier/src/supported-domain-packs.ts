import type { ConceptSpec, PendulumInput } from '@simproof/contracts'
import { createDomainPackRegistry, defineDomainPack } from '@simproof/domain-pack-sdk'

import {
  PENDULUM_POLICY,
  pendulumPeriodSeconds,
  validatePendulumConcept,
  verifyPendulumCandidate,
} from './domains/pendulum/index.js'
import { PENDULUM_DOMAIN_MANIFEST } from './domains/pendulum/manifest.js'
import {
  PENDULUM_CONCEPT_SCHEMA,
  PENDULUM_CONFORMANCE_CASES,
  PENDULUM_REPORT_ADAPTER,
  PENDULUM_SCENE_SCHEMA,
  PENDULUM_VERIFIED_OUTPUT_SCHEMA,
  pendulumAccessibleRepresentation,
} from './domains/pendulum/pack-adapters.js'
import { PROJECTILE_CONFORMANCE_CASES } from './domains/projectile/conformance.js'
import {
  PROJECTILE_POLICY,
  projectileReference,
  validateProjectileConcept,
  verifyProjectile,
} from './domains/projectile/index.js'
import { PROJECTILE_DOMAIN_MANIFEST } from './domains/projectile/manifest.js'
import {
  PROJECTILE_CONCEPT_SCHEMA,
  PROJECTILE_REPORT_ADAPTER,
  PROJECTILE_SCENE_SCHEMA,
  PROJECTILE_VERIFIED_OUTPUT_SCHEMA,
  projectileAccessibleRepresentation,
} from './domains/projectile/pack-adapters.js'
import { batchFromFixture } from './domains/projectile/test-fixture.js'
import { DOMAIN_PACK_FINGERPRINTS } from './generated/domain-pack-fingerprints.js'
import { DOMAIN_PACK_REVIEW_BINDINGS } from './generated/domain-pack-review-bindings.js'

export const PROJECTILE_DOMAIN_PACK = defineDomainPack({
  manifest: PROJECTILE_DOMAIN_MANIFEST,
  id: 'projectile',
  version: '1.1.0',
  contentHash: DOMAIN_PACK_FINGERPRINTS.projectile,
  reviewBinding: DOMAIN_PACK_REVIEW_BINDINGS.projectile,
  policy: PROJECTILE_POLICY,
  conceptSchema: PROJECTILE_CONCEPT_SCHEMA,
  validateConcept: validateProjectileConcept,
  reference: projectileReference,
  verify: verifyProjectile,
  materializeFixture: (_fixtureId: string, source: unknown) => batchFromFixture(source),
  report: PROJECTILE_REPORT_ADAPTER,
  accessible: {
    rendererId: 'projectile-trajectory',
    verifiedOutputSchema: PROJECTILE_VERIFIED_OUTPUT_SCHEMA,
    sceneSchema: PROJECTILE_SCENE_SCHEMA,
    fromVerifiedOutput: projectileAccessibleRepresentation,
  },
  conformance: PROJECTILE_CONFORMANCE_CASES,
})

export const PENDULUM_DOMAIN_PACK = defineDomainPack({
  manifest: PENDULUM_DOMAIN_MANIFEST,
  id: 'pendulum',
  version: '1.0.0',
  contentHash: DOMAIN_PACK_FINGERPRINTS.pendulum,
  reviewBinding: DOMAIN_PACK_REVIEW_BINDINGS.pendulum,
  policy: PENDULUM_POLICY,
  conceptSchema: PENDULUM_CONCEPT_SCHEMA,
  validateConcept: validatePendulumConcept,
  reference: (input: PendulumInput) => pendulumPeriodSeconds(input.lengthM),
  verify: verifyPendulumCandidate,
  materializeFixture: (_fixtureId: string, source: unknown) => source,
  report: PENDULUM_REPORT_ADAPTER,
  accessible: {
    rendererId: 'pendulum-bob',
    verifiedOutputSchema: PENDULUM_VERIFIED_OUTPUT_SCHEMA,
    sceneSchema: PENDULUM_SCENE_SCHEMA,
    fromVerifiedOutput: pendulumAccessibleRepresentation,
  },
  conformance: PENDULUM_CONFORMANCE_CASES,
})

type SupportedDomainPack = typeof PENDULUM_DOMAIN_PACK | typeof PROJECTILE_DOMAIN_PACK

export const BUILT_IN_DOMAIN_PACK_REGISTRY = createDomainPackRegistry([
  PENDULUM_DOMAIN_PACK,
  PROJECTILE_DOMAIN_PACK,
] as const)

export const getBuiltInDomainPack = (domain: ConceptSpec['domain']): SupportedDomainPack => {
  const pack = BUILT_IN_DOMAIN_PACK_REGISTRY.get(domain)
  if (pack === undefined)
    throw new TypeError(`No built-in domain pack is registered for ${domain}.`)
  return pack
}

export function getDomainPack(domain: 'projectile'): typeof PROJECTILE_DOMAIN_PACK
export function getDomainPack(domain: 'pendulum'): typeof PENDULUM_DOMAIN_PACK
export function getDomainPack(
  domain: string,
): typeof PROJECTILE_DOMAIN_PACK | typeof PENDULUM_DOMAIN_PACK | undefined
export function getDomainPack(domain: string): SupportedDomainPack | undefined {
  return BUILT_IN_DOMAIN_PACK_REGISTRY.get(domain)
}
