import {
  type ConceptSpec,
  conceptSpecSchema,
  type RendererData,
  rendererDataSchema,
  type SeedMetadata,
  seedMetadataSchema,
} from '@simproof/contracts'
import { bundledCoreArtifactSource } from '@simproof/sim-runtime'
import { hashCanonicalJson } from '@simproof/verifier'

export const BUNDLED_SEED_TIMESTAMP = '2026-07-16T00:00:00.000Z'
export const BUNDLED_SEED_VERSION_REVISION = 4

interface SeedIdentity {
  readonly simulationId: string
  readonly versionId: string
  readonly verificationRunId: string
  readonly reportId: string
}

export interface BundledSeedDefinition {
  readonly identity: SeedIdentity
  readonly metadata: SeedMetadata
  readonly conceptSpec: ConceptSpec
  readonly renderer: RendererData
  readonly artifactSource: string
}

const descriptions = {
  pendulumIntroduction: {
    seedId: 'pendulum.small-angle',
    bundledVersion: '1.0.0',
    domain: 'pendulum',
    title: 'Small-angle pendulum',
    description: 'Explore how pendulum length changes period in the trusted small-angle model.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Small-angle pendulum bundled example.',
  },
  projectileIntroduction: {
    seedId: 'projectile.introduction',
    bundledVersion: '1.0.0',
    domain: 'projectile',
    title: 'Projectile motion',
    description: 'Explore a vacuum projectile trajectory by changing launch speed and angle.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Projectile motion bundled example.',
  },
  projectileMaximumRange: {
    seedId: 'projectile.maximum-range',
    bundledVersion: '1.0.0',
    domain: 'projectile',
    title: 'Why 45° wins',
    description: 'Adjust launch angle to find the maximum range in the trusted vacuum model.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Why 45 degrees wins bundled example.',
  },
  projectileComplementaryAngles: {
    seedId: 'projectile.complementary-angles',
    bundledVersion: '1.0.0',
    domain: 'projectile',
    title: 'Same range, different arc',
    description: 'Compare complementary launch angles with equal range but different paths.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Same range different arc bundled example.',
  },
  projectileSpeedScaling: {
    seedId: 'projectile.speed-scaling',
    bundledVersion: '1.0.0',
    domain: 'projectile',
    title: 'Double the speed',
    description: 'Explore how launch speed changes range, apex height, and flight time.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Double the speed bundled example.',
  },
  pendulumLengthLaw: {
    seedId: 'pendulum.length-law',
    bundledVersion: '1.0.0',
    domain: 'pendulum',
    title: 'Four times longer, twice the period',
    description: 'Test the square-root relationship between pendulum length and period.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Pendulum length law bundled example.',
  },
  pendulumAmplitudeAssumption: {
    seedId: 'pendulum.amplitude-assumption',
    bundledVersion: '1.0.0',
    domain: 'pendulum',
    title: 'Does amplitude change the period?',
    description: 'Probe amplitude within the trusted small-angle model and inspect its limits.',
    contentLicense: 'CC-BY-4.0',
    attribution: 'SimProof contributors, Pendulum amplitude assumption bundled example.',
  },
} as const

const concepts = {
  pendulumIntroduction: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'pendulum',
    title: descriptions.pendulumIntroduction.title,
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  }),
  projectileIntroduction: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'projectile',
    title: descriptions.projectileIntroduction.title,
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 15, max: 40 } },
      launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
    },
    requestedControls: ['initialSpeed', 'launchAngle'],
  }),
  projectileMaximumRange: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'projectile',
    title: descriptions.projectileMaximumRange.title,
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 30, max: 30 } },
      launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
    },
    requestedControls: ['launchAngle'],
  }),
  projectileComplementaryAngles: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'projectile',
    title: descriptions.projectileComplementaryAngles.title,
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 30, requestedRange: { min: 30, max: 30 } },
      launchAngle: { unit: 'deg', defaultValue: 30, requestedRange: { min: 30, max: 60 } },
    },
    requestedControls: ['launchAngle'],
  }),
  projectileSpeedScaling: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'projectile',
    title: descriptions.projectileSpeedScaling.title,
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 20, requestedRange: { min: 20, max: 40 } },
      launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 45, max: 45 } },
    },
    requestedControls: ['initialSpeed'],
  }),
  pendulumLengthLaw: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'pendulum',
    title: descriptions.pendulumLengthLaw.title,
    parameters: {
      length: { unit: 'm', defaultValue: 0.5, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 5, max: 5 } },
    },
    requestedControls: ['length'],
  }),
  pendulumAmplitudeAssumption: conceptSpecSchema.parse({
    schemaVersion: '1',
    domain: 'pendulum',
    title: descriptions.pendulumAmplitudeAssumption.title,
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 1, max: 1 } },
      amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 1, max: 15 } },
    },
    requestedControls: ['amplitude'],
  }),
} as const

const renderers = {
  pendulum: rendererDataSchema.parse({
    schemaVersion: '1',
    domain: 'pendulum',
    renderer: 'pendulum-bob',
    features: ['equilibrium-line', 'turning-points', 'period-markers'],
  }),
  projectile: rendererDataSchema.parse({
    schemaVersion: '1',
    domain: 'projectile',
    renderer: 'projectile-trajectory',
    features: ['trail', 'velocity-vector', 'apex-marker', 'impact-marker'],
  }),
} as const

function definition(
  domain: 'pendulum' | 'projectile',
  description: (typeof descriptions)[keyof typeof descriptions],
  conceptSpec: ConceptSpec,
  identity: SeedIdentity,
): BundledSeedDefinition {
  if (description.domain !== domain || conceptSpec.domain !== domain) {
    throw new TypeError('Bundled seed domain does not match its description and concept.')
  }
  const renderer = domain === 'pendulum' ? renderers.pendulum : renderers.projectile
  const artifactSource = bundledCoreArtifactSource(domain)
  const metadata = seedMetadataSchema.parse({
    ...description,
    contentHash: hashCanonicalJson({ description, conceptSpec, renderer, artifactSource }),
  })
  return Object.freeze({
    identity: Object.freeze(identity),
    metadata,
    conceptSpec,
    renderer,
    artifactSource,
  })
}

export const BUNDLED_SEED_DEFINITIONS = Object.freeze([
  definition('pendulum', descriptions.pendulumIntroduction, concepts.pendulumIntroduction, {
    simulationId: '11111111-1111-4111-8111-111111111111',
    versionId: '11111111-1111-4111-8111-111111111112',
    verificationRunId: '11111111-1111-4111-8111-111111111114',
    reportId: '11111111-1111-4111-8111-111111111113',
  }),
  definition('projectile', descriptions.projectileIntroduction, concepts.projectileIntroduction, {
    simulationId: '22222222-2222-4222-8222-222222222221',
    versionId: '22222222-2222-4222-8222-222222222222',
    verificationRunId: '22222222-2222-4222-8222-222222222224',
    reportId: '22222222-2222-4222-8222-222222222223',
  }),
  definition('projectile', descriptions.projectileMaximumRange, concepts.projectileMaximumRange, {
    simulationId: '33333333-3333-4333-8333-333333333331',
    versionId: '33333333-3333-4333-8333-333333333332',
    verificationRunId: '33333333-3333-4333-8333-333333333334',
    reportId: '33333333-3333-4333-8333-333333333333',
  }),
  definition(
    'projectile',
    descriptions.projectileComplementaryAngles,
    concepts.projectileComplementaryAngles,
    {
      simulationId: '44444444-4444-4444-8444-444444444441',
      versionId: '44444444-4444-4444-8444-444444444442',
      verificationRunId: '44444444-4444-4444-8444-444444444444',
      reportId: '44444444-4444-4444-8444-444444444443',
    },
  ),
  definition('projectile', descriptions.projectileSpeedScaling, concepts.projectileSpeedScaling, {
    simulationId: '55555555-5555-4555-8555-555555555551',
    versionId: '55555555-5555-4555-8555-555555555552',
    verificationRunId: '55555555-5555-4555-8555-555555555554',
    reportId: '55555555-5555-4555-8555-555555555553',
  }),
  definition('pendulum', descriptions.pendulumLengthLaw, concepts.pendulumLengthLaw, {
    simulationId: '66666666-6666-4666-8666-666666666661',
    versionId: '66666666-6666-4666-8666-666666666662',
    verificationRunId: '66666666-6666-4666-8666-666666666664',
    reportId: '66666666-6666-4666-8666-666666666663',
  }),
  definition(
    'pendulum',
    descriptions.pendulumAmplitudeAssumption,
    concepts.pendulumAmplitudeAssumption,
    {
      simulationId: '77777777-7777-4777-8777-777777777771',
      versionId: '77777777-7777-4777-8777-777777777772',
      verificationRunId: '77777777-7777-4777-8777-777777777774',
      reportId: '77777777-7777-4777-8777-777777777773',
    },
  ),
])
