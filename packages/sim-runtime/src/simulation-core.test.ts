import { describe, expect, it } from 'vitest'

import {
  defineSimulationCore,
  SIMULATION_CORE_PROTOCOL_VERSION,
  SimulationCorePurityError,
} from './simulation-core.js'

describe('simulation core boundary', () => {
  it('defines the narrow deterministic sampling protocol', () => {
    const core = defineSimulationCore<{ value: number }, { doubled: number }>((input) => ({
      doubled: input.value * 2,
    }))

    expect(SIMULATION_CORE_PROTOCOL_VERSION).toBe('1')
    expect(core.protocolVersion).toBe('1')
    expect(core.sample({ value: 4 })).toEqual({ doubled: 8 })
    expect(Object.isFrozen(core)).toBe(true)
  })

  it('does not expose policy or renderer capabilities', () => {
    const core = defineSimulationCore((input: Readonly<{ value: number }>) => input.value)

    expect(Object.keys(core).sort()).toEqual(['protocolVersion', 'sample'])
  })

  const impureSamples: ReadonlyArray<readonly [string, () => unknown]> = [
    ['clock access', () => Date.now()],
    ['randomness', () => Math.random()],
    ['host global access', () => globalThis],
  ]

  it.each(impureSamples)('rejects callback source containing %s', (_capability, sample) => {
    expect(() => defineSimulationCore(sample)).toThrowError(SimulationCorePurityError)
  })

  it('rejects environment, network, and Node loading callback source', () => {
    const process = { env: { SECRET: 'must-not-be-readable' } }
    const fetch = () => Promise.resolve('must-not-run')
    const require = (_specifier: string) => ({})

    // eslint-disable-next-line no-restricted-properties -- This fixture intentionally models forbidden environment access.
    expect(() => defineSimulationCore(() => process.env.SECRET)).toThrowError(
      SimulationCorePurityError,
    )
    expect(() => defineSimulationCore(() => fetch())).toThrowError(SimulationCorePurityError)
    expect(() => defineSimulationCore(() => require('node:fs'))).toThrowError(
      SimulationCorePurityError,
    )
  })
})
