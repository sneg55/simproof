import { describe, expect, it } from 'vitest'

import { PENDULUM_CONFORMANCE_CASES } from './pack-adapters.js'

const singularityControl = {
  id: 'pendulum-zero-length',
  evidenceId: 'pendulum.controls',
  threshold: { quantity: 'length', unit: 'm', value: 0 },
  covers: { kind: 'singularity' as const, id: 'pendulum.zero-length' },
  cases: { below: -0.000_001, equal: 0, above: 0.000_001 },
  expected: 'passed' as const,
}

describe('pendulum pack conformance adapter', () => {
  it('evaluates the below, equal, and above sides of the zero-length singularity', () => {
    const run = PENDULUM_CONFORMANCE_CASES.runBoundaryControl

    expect(run(singularityControl)).toBe(true)
    expect(run({ ...singularityControl, cases: { ...singularityControl.cases, below: 0 } })).toBe(
      false,
    )
    expect(run({ ...singularityControl, cases: { ...singularityControl.cases, equal: 1 } })).toBe(
      false,
    )
    expect(run({ ...singularityControl, cases: { ...singularityControl.cases, above: 0 } })).toBe(
      false,
    )
  })
})
