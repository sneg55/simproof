import { EARTH_GRAVITY_MPS2, PENDULUM_POLICY } from './policy.js'

export const pendulumPeriodSeconds = (lengthM: number): number =>
  2 * Math.PI * Math.sqrt(lengthM / EARTH_GRAVITY_MPS2)

export const isPendulumInputApplicable = (lengthM: number, amplitudeDeg: number): boolean => {
  const { applicability } = PENDULUM_POLICY
  return (
    Number.isFinite(lengthM) &&
    Number.isFinite(amplitudeDeg) &&
    lengthM >= applicability.lengthM.min &&
    lengthM <= applicability.lengthM.max &&
    amplitudeDeg > applicability.amplitudeDeg.minExclusive &&
    amplitudeDeg <= applicability.amplitudeDeg.max
  )
}

export const relativeError = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.abs(expected)
