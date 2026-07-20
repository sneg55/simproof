import {
  type VerificationReportDisplay,
  verificationReportDisplaySchema,
} from '@simproof/contracts'
import { pendulumSeedCore, projectileSeedCore } from '@simproof/sim-runtime'
import {
  assessReportValidity,
  createVerificationReport,
  currentBindingsFor,
  getDomainPack,
  hashCanonicalJson,
  isPublishable,
  PROJECTILE_VERIFICATION_INPUTS,
} from '@simproof/verifier'

import {
  BUNDLED_SEED_TIMESTAMP,
  BUNDLED_SEED_VERSION_REVISION,
  type BundledSeedDefinition,
} from './bundled-seed-definitions.js'

const BUNDLED_RUNNER = Object.freeze({ version: '1.0.0', protocolVersion: '1' as const })

function observationsFor(definition: BundledSeedDefinition): readonly unknown[] {
  if (definition.metadata.domain === 'pendulum') {
    return getDomainPack('pendulum').policy.sampling.cases.map((input) =>
      pendulumSeedCore.sample(input),
    )
  }
  return PROJECTILE_VERIFICATION_INPUTS.map((input) => projectileSeedCore.sample(input))
}

function inputFor(definition: BundledSeedDefinition) {
  const policy =
    definition.metadata.domain === 'pendulum'
      ? getDomainPack('pendulum').policy
      : getDomainPack('projectile').policy
  return {
    reportId: definition.identity.reportId,
    createdAt: BUNDLED_SEED_TIMESTAMP,
    conceptSpec: definition.conceptSpec,
    artifactSource: definition.artifactSource,
    policy,
    runner: BUNDLED_RUNNER,
    observations: observationsFor(definition),
  }
}

export function verificationDisplayFor(
  definition: BundledSeedDefinition,
): VerificationReportDisplay {
  const input = inputFor(definition)
  const report = createVerificationReport(input)
  const validity = assessReportValidity(report, currentBindingsFor(input))
  const publishable = isPublishable(report, validity)
  return verificationReportDisplaySchema.parse({
    simulationVersionId: definition.identity.versionId,
    verificationRunId: definition.identity.verificationRunId,
    reportArtifactHash: hashCanonicalJson(report),
    versionRevision: BUNDLED_SEED_VERSION_REVISION,
    conceptSpec: definition.conceptSpec,
    report,
    validity,
    policy: input.policy,
    publication: { published: false },
    badgeActive: publishable,
    publishable: false,
  })
}

export function reportHash(display: VerificationReportDisplay) {
  return hashCanonicalJson(display.report)
}
