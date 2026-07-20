import { describe, expect, it } from 'vitest'

import {
  bundledCoreArtifactSource,
  pendulumSeedCore,
  pendulumTimeSeries,
  projectileSeedCore,
  projectileTimeSeries,
} from './bundled-cores.js'

describe('bundled deterministic simulation cores', () => {
  it('evaluates the projectile governing equations deterministically', () => {
    const input = { initialSpeedMps: 30, launchAngleDeg: 45 }
    const first = projectileSeedCore.sample(input)
    const second = projectileSeedCore.sample({ ...input })

    expect(first).toEqual(second)
    expect(first.summary.rangeM).toBeCloseTo(91.74311926605503)
    expect(first.trajectory).toHaveLength(5)
    expect(projectileTimeSeries(input, 101)).toHaveLength(101)
    expect(projectileTimeSeries(input, 1_001)).toEqual(projectileTimeSeries(input, 1_001))
  })

  it('mechanically fingerprints the installed core implementations', () => {
    const projectile = bundledCoreArtifactSource('projectile')
    const pendulum = bundledCoreArtifactSource('pendulum')
    expect(projectile).toBe(bundledCoreArtifactSource('projectile'))
    expect(pendulum).toBe(bundledCoreArtifactSource('pendulum'))
    expect(projectile).not.toBe(pendulum)
    expect(projectile).toContain('projectileTimeSeries')
    expect(pendulum).toContain('pendulumPeriodSeconds')
  })

  it('evaluates the small-angle pendulum core and bounded time series deterministically', () => {
    const input = { lengthM: 1, amplitudeDeg: 10 }
    expect(pendulumSeedCore.sample(input)).toEqual(pendulumSeedCore.sample({ ...input }))
    expect(pendulumSeedCore.sample(input).periodS).toBeCloseTo(2.0060666807106475)
    expect(pendulumTimeSeries(input, 201)).toHaveLength(201)
    expect(pendulumTimeSeries(input, 201)[0]).toMatchObject({ timeS: 0, angleDeg: 10 })
  })

  it.each([
    [
      'projectile non-finite',
      () => projectileSeedCore.sample({ initialSpeedMps: 20, launchAngleDeg: Number.NaN }),
    ],
    [
      'projectile zero speed',
      () => projectileTimeSeries({ initialSpeedMps: 0, launchAngleDeg: 45 }, 10),
    ],
    ['pendulum zero length', () => pendulumSeedCore.sample({ lengthM: 0, amplitudeDeg: 10 })],
    ['pendulum zero amplitude', () => pendulumTimeSeries({ lengthM: 1, amplitudeDeg: 0 }, 10)],
    [
      'sample count too low',
      () => projectileTimeSeries({ initialSpeedMps: 20, launchAngleDeg: 45 }, 1),
    ],
    ['sample count too high', () => pendulumTimeSeries({ lengthM: 1, amplitudeDeg: 10 }, 2_002)],
  ])('rejects malformed core input: %s', (_label, operation) => {
    expect(operation).toThrow(TypeError)
  })
})
