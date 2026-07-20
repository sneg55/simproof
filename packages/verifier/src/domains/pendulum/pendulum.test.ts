import { readFile } from 'node:fs/promises'

import { verificationFindingSchema } from '@simproof/contracts'
import * as fc from 'fast-check'
import { assert, describe, expect, it } from 'vitest'
import type { PendulumVerificationResult } from './index.js'
import {
  EARTH_GRAVITY_MPS2,
  isPendulumInputApplicable,
  PENDULUM_CONCEPT_VALIDATION_IDS,
  PENDULUM_FINDING_IDS,
  PENDULUM_POLICY,
  pendulumPeriodSeconds,
  validatePendulumConcept,
  verifyPendulumCandidate,
} from './index.js'

const fixtureRoot = new URL('../../../../../tests/fixtures/', import.meta.url)

const loadFixture = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, fixtureRoot), 'utf8')) as unknown

const scientificResult = (candidate: unknown): PendulumVerificationResult => {
  const outcome = verifyPendulumCandidate(candidate)
  assert(outcome.ok)
  return outcome.result
}

describe('trusted pendulum reference', () => {
  it('uses the exact small-angle period and fixed Earth gravity', () => {
    expect(EARTH_GRAVITY_MPS2).toBe(9.81)
    expect(pendulumPeriodSeconds(1)).toBe(2 * Math.PI * Math.sqrt(1 / 9.81))
    expect(pendulumPeriodSeconds(0.5)).toBe(2 * Math.PI * Math.sqrt(0.5 / 9.81))
    expect(PENDULUM_POLICY.applicability).toEqual({
      lengthM: { min: 0.5, max: 2 },
      amplitudeDeg: { minExclusive: 0, max: 15 },
      gravityMps2: 9.81,
      model: 'small-angle',
    })
  })

  it('satisfies deterministic period relations over the applicable domain', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (firstLength, secondLength) => {
          const ratio = pendulumPeriodSeconds(secondLength) / pendulumPeriodSeconds(firstLength)
          expect(ratio).toBeCloseTo(Math.sqrt(secondLength / firstLength), 12)
        },
      ),
      { seed: 20_260_716, numRuns: 100 },
    )
  })
})

describe('pendulum concept validation', () => {
  const validConcept = {
    schemaVersion: '1',
    domain: 'pendulum',
    title: 'Explore a simple pendulum',
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 0.001, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  } as const

  it('accepts a strict pendulum concept whose whole range is applicable', () => {
    expect(validatePendulumConcept(validConcept)).toEqual({ ok: true, value: validConcept })
  })

  it('rejects malformed and non-pendulum concepts at the shared schema boundary', () => {
    expect(validatePendulumConcept({ ...validConcept, unexpected: true })).toMatchObject({
      ok: false,
      error: { id: PENDULUM_CONCEPT_VALIDATION_IDS.invalid },
    })
    expect(
      validatePendulumConcept({
        schemaVersion: '1',
        domain: 'projectile',
        title: 'Projectile',
        parameters: {
          initialSpeed: { unit: 'm/s', defaultValue: 20, requestedRange: { min: 15, max: 40 } },
          launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
        },
        requestedControls: ['initialSpeed', 'launchAngle'],
      }),
    ).toMatchObject({
      ok: false,
      error: { id: PENDULUM_CONCEPT_VALIDATION_IDS.unsupportedDomain },
    })
  })

  it.each([
    ['length below minimum', 'length', { min: 0.49, max: 2 }],
    ['length above maximum', 'length', { min: 0.5, max: 2.01 }],
    ['zero amplitude', 'amplitude', { min: 0, max: 15 }],
    ['amplitude above maximum', 'amplitude', { min: 0.001, max: 15.01 }],
  ] as const)('fails closed without clamping when %s', (_name, parameter, requestedRange) => {
    const parameters =
      parameter === 'length'
        ? {
            ...validConcept.parameters,
            length: { ...validConcept.parameters.length, requestedRange },
          }
        : {
            ...validConcept.parameters,
            amplitude: { ...validConcept.parameters.amplitude, requestedRange },
          }
    const concept = {
      ...validConcept,
      parameters,
    }

    expect(validatePendulumConcept(concept)).toEqual({
      ok: false,
      error: {
        id: PENDULUM_CONCEPT_VALIDATION_IDS.outOfDomain,
        message: 'The requested pendulum range is outside policy applicability.',
      },
    })
  })
})

describe('pendulum verification controls', () => {
  it('accepts the known-correct control with explicit units', async () => {
    const result = scientificResult(await loadFixture('correct/pendulum-correct.json'))

    expect(result).toMatchObject({ verdict: 'verified', findings: [], sampleCount: 3 })
  })

  it('rejects the inverted-ratio control with a stable finding ID', async () => {
    const result = scientificResult(
      await loadFixture('negative-controls/pendulum-inverted-ratio.json'),
    )

    expect(result.verdict).toBe('rejected')
    expect(result.findings.map(({ id }) => id)).toEqual([
      PENDULUM_FINDING_IDS.periodRelativeError,
      PENDULUM_FINDING_IDS.periodRelativeError,
      PENDULUM_FINDING_IDS.periodRelativeError,
    ])
    for (const finding of result.findings) {
      expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
    }
  })

  it('rejects non-canonical units before comparing periods', async () => {
    const outcome = verifyPendulumCandidate(
      await loadFixture('negative-controls/pendulum-bad-units.json'),
    )

    expect(outcome).toEqual({
      ok: false,
      error: {
        id: PENDULUM_FINDING_IDS.invalidUnits,
        message: 'Pendulum observations must use m, deg, and s.',
      },
    })
  })

  it('rejects non-finite output with its own stable finding ID', async () => {
    const fixture = await loadFixture('negative-controls/pendulum-nonfinite-output.json')
    const outcome = verifyPendulumCandidate(fixture)

    expect(outcome).toMatchObject({
      ok: false,
      error: { id: PENDULUM_FINDING_IDS.nonFiniteOutput, observationIndex: 0 },
    })

    for (const periodS of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const directOutcome = verifyPendulumCandidate({
        domain: 'pendulum',
        units: { length: 'm', amplitude: 'deg', period: 's' },
        observations: [{ input: { lengthM: 1, amplitudeDeg: 5 }, periodS }],
      })
      expect(directOutcome).toMatchObject({
        ok: false,
        error: { id: PENDULUM_FINDING_IDS.nonFiniteOutput, observationIndex: 0 },
      })
    }
  })

  it('marks inputs beyond the supported small-angle policy inapplicable', async () => {
    const result = scientificResult(
      await loadFixture('negative-controls/pendulum-out-of-domain.json'),
    )

    expect(result.verdict).toBe('inapplicable')
    expect(result.findings.map(({ id }) => id)).toEqual([
      PENDULUM_FINDING_IDS.outsideApplicability,
      PENDULUM_FINDING_IDS.outsideApplicability,
      PENDULUM_FINDING_IDS.outsideApplicability,
    ])
    for (const finding of result.findings) {
      expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
    }
  })

  it('treats both amplitude endpoints exactly as documented', () => {
    expect(isPendulumInputApplicable(1, Number.MIN_VALUE)).toBe(true)
    expect(isPendulumInputApplicable(1, 15)).toBe(true)
    expect(isPendulumInputApplicable(1, 0)).toBe(false)
    expect(isPendulumInputApplicable(1, 15.000_001)).toBe(false)
  })

  it('requires the exact verifier-owned sampling grid', async () => {
    const fixture = await loadFixture('correct/pendulum-correct.json')
    if (
      typeof fixture !== 'object' ||
      fixture === null ||
      !('observations' in fixture) ||
      !Array.isArray(fixture.observations)
    ) {
      throw new Error('Expected the correct pendulum fixture shape.')
    }

    expect(
      verifyPendulumCandidate({ ...fixture, observations: fixture.observations.slice(1) }),
    ).toEqual({
      ok: false,
      error: {
        id: PENDULUM_FINDING_IDS.invalidCandidate,
        message: 'Runner output must contain the exact verifier-requested pendulum sampling grid.',
      },
    })
  })

  it('publishes stable lower-case namespaced finding IDs', () => {
    expect(PENDULUM_FINDING_IDS).toEqual({
      invalidCandidate: 'pendulum.candidate.invalid',
      invalidUnits: 'pendulum.units.invalid',
      nonFiniteOutput: 'pendulum.output.non-finite',
      outsideApplicability: 'pendulum.input.out-of-domain',
      periodRelativeError: 'pendulum.period.relative-error',
    })
  })
})
