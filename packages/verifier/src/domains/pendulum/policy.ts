import { pendulumVerificationPolicySchema } from '@simproof/contracts'

export const EARTH_GRAVITY_MPS2 = 9.81
export const PENDULUM_PERIOD_RELATIVE_TOLERANCE = 0.01

export const PENDULUM_FINDING_IDS = Object.freeze({
  invalidCandidate: 'pendulum.candidate.invalid',
  invalidUnits: 'pendulum.units.invalid',
  nonFiniteOutput: 'pendulum.output.non-finite',
  outsideApplicability: 'pendulum.input.out-of-domain',
  periodRelativeError: 'pendulum.period.relative-error',
} as const)

const policy = pendulumVerificationPolicySchema.parse({
  schemaVersion: '1',
  id: 'pendulum.small-angle',
  version: '1.0.0',
  domain: 'pendulum',
  checks: ['pendulum.period'],
  applicability: {
    lengthM: { min: 0.5, max: 2 },
    amplitudeDeg: { minExclusive: 0, max: 15 },
    gravityMps2: EARTH_GRAVITY_MPS2,
    model: 'small-angle',
  },
  sampling: {
    cases: [
      { lengthM: 0.5, amplitudeDeg: 5 },
      { lengthM: 1, amplitudeDeg: 10 },
      { lengthM: 2, amplitudeDeg: 15 },
    ],
  },
  tolerances: {
    periodS: { mode: 'relative', relative: PENDULUM_PERIOD_RELATIVE_TOLERANCE },
  },
  assumptions: [
    'The pendulum is ideal and follows the small-angle approximation.',
    'Gravity is fixed at 9.81 m/s^2.',
  ],
  limitations: [
    'Applicable only to lengths from 0.5 m through 2 m.',
    'Applicable only to amplitudes greater than 0 deg through 15 deg.',
  ],
})

Object.freeze(policy.checks)
Object.freeze(policy.applicability.lengthM)
Object.freeze(policy.applicability.amplitudeDeg)
Object.freeze(policy.applicability)
for (const sample of policy.sampling.cases) Object.freeze(sample)
Object.freeze(policy.sampling.cases)
Object.freeze(policy.sampling)
Object.freeze(policy.tolerances.periodS)
Object.freeze(policy.tolerances)
Object.freeze(policy.assumptions)
Object.freeze(policy.limitations)

export const PENDULUM_POLICY = Object.freeze(policy)

export type PendulumFindingId = (typeof PENDULUM_FINDING_IDS)[keyof typeof PENDULUM_FINDING_IDS]
