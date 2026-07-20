import { readFileSync } from 'node:fs'

import { verificationFindingSchema } from '@simproof/contracts'
import fc from 'fast-check'
import { assert, describe, expect, it } from 'vitest'

import {
  PROJECTILE_BOUNDARY_ERROR_IDS,
  PROJECTILE_FINDING_IDS,
  PROJECTILE_POLICY,
  type ProjectileVerificationResult,
  projectileReference,
  projectileStateAtTime,
  validateProjectileConcept,
  verifyProjectile,
} from './index.js'
import { batchFromFixture, type ProjectileFixture } from './test-fixture.js'

const fixtureRoot = new URL('../../../../../tests/fixtures/', import.meta.url)
const loadFixture = (path: string): ProjectileFixture =>
  JSON.parse(readFileSync(new URL(path, fixtureRoot), 'utf8')) as ProjectileFixture

const fixtures = {
  analytic: loadFixture('correct/projectile-analytic.json'),
  symplectic: loadFixture('correct/projectile-fine-symplectic.json'),
  badOutput: loadFixture('negative-controls/projectile-bad-output.json'),
  badUnits: loadFixture('negative-controls/projectile-bad-units.json'),
  coarseEuler: loadFixture('negative-controls/projectile-coarse-euler.json'),
  droppedFactor: loadFixture('negative-controls/projectile-dropped-factor.json'),
  radians: loadFixture('negative-controls/projectile-radians.json'),
}

const representableBoundaryError = (error: number): number =>
  Math.max(0, error - 4 * Number.EPSILON * Math.max(1, Math.abs(error)))

function findingIds(fixture: ProjectileFixture): Set<string> {
  return findingIdsFromReport(verifyProjectile(batchFromFixture(fixture)))
}

function scientificResult(
  outcome: ReturnType<typeof verifyProjectile>,
): ProjectileVerificationResult {
  assert(outcome.ok)
  return outcome.result
}

describe('projectile trusted references', () => {
  it('matches independently recorded proof vectors', () => {
    const lowArc = projectileReference({ initialSpeedMps: 20, launchAngleDeg: 30 })
    expect(lowArc.rangeM).toBeCloseTo(35.311943069702, 11)
    expect(lowArc.apexHeightM).toBeCloseTo(5.096839959225, 11)
    expect(lowArc.flightTimeS).toBeCloseTo(2.03873598369, 11)
    const maximumRange = projectileReference({ initialSpeedMps: 30, launchAngleDeg: 45 })
    expect(maximumRange.rangeM).toBeCloseTo(91.743119266055, 11)
    expect(maximumRange.apexHeightM).toBeCloseTo(22.935779816514, 11)
    expect(maximumRange.flightTimeS).toBeCloseTo(4.324812117349, 11)
  })

  it('computes verifier-owned trajectory states', () => {
    const input = { initialSpeedMps: 30, launchAngleDeg: 45 }
    const reference = projectileReference(input)
    const apex = projectileStateAtTime(input, reference.flightTimeS / 2)
    expect(apex.xM).toBeCloseTo(reference.rangeM / 2, 12)
    expect(apex.yM).toBeCloseTo(reference.apexHeightM, 12)
    expect(apex.speedMps).toBeCloseTo(30 / Math.sqrt(2), 12)
  })

  it('holds deterministic physical properties across the supported bounds', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 15, max: 40, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 15, max: 75, noNaN: true, noDefaultInfinity: true }),
        (initialSpeedMps, launchAngleDeg) => {
          const input = { initialSpeedMps, launchAngleDeg }
          const reference = projectileReference(input)
          const complement = projectileReference({
            initialSpeedMps,
            launchAngleDeg: 90 - launchAngleDeg,
          })
          const landing = projectileStateAtTime(input, reference.flightTimeS)
          expect(reference.rangeM).toBeCloseTo(complement.rangeM, 10)
          expect(landing.xM).toBeCloseTo(reference.rangeM, 10)
          expect(landing.yM).toBeCloseTo(0, 10)
          expect(0.5 * landing.speedMps ** 2).toBeCloseTo(0.5 * initialSpeedMps ** 2, 9)
        },
      ),
      { seed: 20_260_716, numRuns: 100 },
    )
  })
})

describe('projectile concept validation', () => {
  const validConcept = {
    schemaVersion: '1',
    domain: 'projectile',
    title: 'Vacuum projectile',
    parameters: {
      initialSpeed: {
        unit: 'm/s',
        defaultValue: 25,
        requestedRange: { min: 15, max: 40 },
      },
      launchAngle: {
        unit: 'deg',
        defaultValue: 45,
        requestedRange: { min: 15, max: 75 },
      },
    },
    requestedControls: ['initialSpeed', 'launchAngle'],
  } as const

  it('accepts a projectile concept wholly inside trusted applicability', () => {
    expect(validateProjectileConcept(validConcept)).toEqual({ ok: true, value: validConcept })
  })

  it('fails closed when any requested range exceeds policy', () => {
    const outside = {
      ...validConcept,
      parameters: {
        ...validConcept.parameters,
        initialSpeed: {
          ...validConcept.parameters.initialSpeed,
          requestedRange: { min: 10, max: 40 },
        },
      },
    }
    expect(validateProjectileConcept(outside)).toEqual({
      ok: false,
      error: {
        id: 'projectile.concept.out-of-policy',
        message: 'Requested projectile ranges must remain inside the trusted policy bounds.',
      },
    })
    expect(outside.parameters.initialSpeed.requestedRange.min).toBe(10)
  })

  it('rejects malformed and non-projectile concepts', () => {
    expect(validateProjectileConcept({ domain: 'pendulum' })).toMatchObject({
      ok: false,
      error: { id: 'projectile.concept.invalid' },
    })
    expect(validateProjectileConcept({ ...validConcept, extra: true })).toMatchObject({
      ok: false,
      error: { id: 'projectile.concept.invalid' },
    })
  })
})

describe('projectile controls', () => {
  it.each([fixtures.analytic, fixtures.symplectic])('accepts positive $id', (fixture) => {
    const report = verifyProjectile(batchFromFixture(fixture))
    expect(report.ok).toBe(true)
    if (!report.ok) return
    expect(report.result).toEqual({ verdict: 'verified', findings: [], sampleCount: 9 })
  })

  it('rejects the radians negative control', () => {
    expect(findingIds(fixtures.radians)).toEqual(
      new Set([
        PROJECTILE_FINDING_IDS.rangeMismatch,
        PROJECTILE_FINDING_IDS.apexMismatch,
        PROJECTILE_FINDING_IDS.flightTimeMismatch,
        PROJECTILE_FINDING_IDS.trajectoryResidual,
        PROJECTILE_FINDING_IDS.sampleLocationMismatch,
        PROJECTILE_FINDING_IDS.energyDrift,
      ]),
    )
  })

  it('rejects coarse Euler across all scientific checks', () => {
    expect(findingIds(fixtures.coarseEuler)).toEqual(
      new Set([
        PROJECTILE_FINDING_IDS.rangeMismatch,
        PROJECTILE_FINDING_IDS.apexMismatch,
        PROJECTILE_FINDING_IDS.flightTimeMismatch,
        PROJECTILE_FINDING_IDS.trajectoryResidual,
        PROJECTILE_FINDING_IDS.energyDrift,
        PROJECTILE_FINDING_IDS.rangeMaximumViolation,
      ]),
    )
  })

  it('rejects the dropped-factor negative control', () => {
    expect(findingIds(fixtures.droppedFactor)).toEqual(
      new Set([
        PROJECTILE_FINDING_IDS.rangeMismatch,
        PROJECTILE_FINDING_IDS.trajectoryResidual,
        PROJECTILE_FINDING_IDS.energyDrift,
        PROJECTILE_FINDING_IDS.rangeMaximumViolation,
        PROJECTILE_FINDING_IDS.sampleLocationMismatch,
      ]),
    )
  })

  it('returns a boundary failure for non-finite output before comparisons', () => {
    const report = verifyProjectile(batchFromFixture(fixtures.badOutput))
    expect(report).toEqual({
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        message:
          'Runner observations must be finite and satisfy the projectile observation schema.',
      },
    })
  })

  it.each([
    {
      name: 'a missing policy input',
      mutate: (observations: ReturnType<typeof batchFromFixture>['observations']) =>
        observations.slice(1),
    },
    {
      name: 'a duplicate policy input',
      mutate: (observations: ReturnType<typeof batchFromFixture>['observations']) => [
        ...observations,
        observations[0]!,
      ],
    },
    {
      name: 'an extra non-policy input',
      mutate: (observations: ReturnType<typeof batchFromFixture>['observations']) => [
        ...observations,
        {
          ...observations[0]!,
          input: { initialSpeedMps: 20, launchAngleDeg: 31 },
          summary: { ...observations[0]!.summary, rangeM: 1_000_000 },
        },
      ],
    },
  ])('rejects $name before scientific checks', ({ mutate }) => {
    const batch = batchFromFixture(fixtures.analytic)

    expect(verifyProjectile({ ...batch, observations: mutate(batch.observations) })).toEqual({
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        message:
          'Runner output must contain each verifier-requested projectile observation exactly once.',
      },
    })
  })

  it('reports the number of exact policy observations consumed', () => {
    const batch = batchFromFixture(fixtures.analytic)
    const report = verifyProjectile({ ...batch, observations: [...batch.observations].reverse() })

    expect(scientificResult(report).sampleCount).toBe(batch.observations.length)
  })

  it('requires every verifier-owned trajectory sample', () => {
    const batch = batchFromFixture(fixtures.analytic)
    const first = batch.observations[0]!
    const report = verifyProjectile({
      ...batch,
      observations: [
        { ...first, trajectory: first.trajectory.slice(1) },
        ...batch.observations.slice(1),
      ],
    })
    expect(findingIdsFromReport(report)).toContain(
      PROJECTILE_FINDING_IDS.sampleCoverageInsufficient,
    )
  })

  it('does not use candidate sample locations as trusted reference inputs', () => {
    const batch = batchFromFixture(fixtures.analytic)
    const first = batch.observations[0]!
    const trajectory = first.trajectory.map((sample, index) =>
      index === 2 ? { ...sample, xM: sample.xM + 10 } : sample,
    )
    const report = verifyProjectile({
      ...batch,
      observations: [{ ...first, trajectory }, ...batch.observations.slice(1)],
    })
    expect(findingIdsFromReport(report)).toContain(PROJECTILE_FINDING_IDS.sampleLocationMismatch)
  })

  it.each([
    {
      name: 'trajectory time matching',
      findingId: PROJECTILE_FINDING_IDS.sampleCoverageInsufficient,
      mutate: (relativeError: number) => {
        const batch = batchFromFixture(fixtures.analytic)
        const first = batch.observations[0]!
        return {
          ...batch,
          observations: [
            {
              ...first,
              trajectory: first.trajectory.map((sample, index) =>
                index === 1
                  ? {
                      ...sample,
                      timeS: sample.timeS + Math.max(1, sample.timeS) * relativeError,
                    }
                  : sample,
              ),
            },
            ...batch.observations.slice(1),
          ],
        }
      },
      threshold: PROJECTILE_POLICY.tolerances.trajectoryTimeS.relativeScale,
    },
    {
      name: 'trajectory horizontal location',
      findingId: PROJECTILE_FINDING_IDS.sampleLocationMismatch,
      mutate: (relativeError: number) => {
        const batch = batchFromFixture(fixtures.analytic)
        const first = batch.observations[0]!
        return {
          ...batch,
          observations: [
            {
              ...first,
              trajectory: first.trajectory.map((sample, index) =>
                index === 1
                  ? { ...sample, xM: sample.xM + first.summary.rangeM * relativeError }
                  : sample,
              ),
            },
            ...batch.observations.slice(1),
          ],
        }
      },
      threshold: PROJECTILE_POLICY.tolerances.trajectoryXM.relative,
    },
  ])('enforces the promoted $name threshold below, at, and above its policy value', (control) => {
    for (const error of [
      control.threshold * 0.999,
      representableBoundaryError(control.threshold),
    ]) {
      expect(findingIdsFromReport(verifyProjectile(control.mutate(error)))).not.toContain(
        control.findingId,
      )
    }
    expect(
      findingIdsFromReport(verifyProjectile(control.mutate(control.threshold * 1.001))),
    ).toContain(control.findingId)
  })

  it('applies a one-percent ordering tolerance to the 45-degree maximum', () => {
    const batch = batchFromFixture(fixtures.analytic)
    const at45 = batch.observations.find(
      ({ input }) => input.initialSpeedMps === 30 && input.launchAngleDeg === 45,
    )!
    const withExcessAt40 = (relativeExcess: number) => ({
      ...batch,
      observations: batch.observations.map((observation) =>
        observation.input.initialSpeedMps === 30 && observation.input.launchAngleDeg === 40
          ? {
              ...observation,
              summary: {
                ...observation.summary,
                rangeM: at45.summary.rangeM * (1 + relativeExcess),
              },
            }
          : observation,
      ),
    })
    expect(findingIdsFromReport(verifyProjectile(withExcessAt40(0.009)))).not.toContain(
      PROJECTILE_FINDING_IDS.rangeMaximumViolation,
    )
    expect(findingIdsFromReport(verifyProjectile(withExcessAt40(0.011)))).toContain(
      PROJECTILE_FINDING_IDS.rangeMaximumViolation,
    )
  })
})

function findingIdsFromReport(report: ReturnType<typeof verifyProjectile>): Set<string> {
  const result = scientificResult(report)
  for (const finding of result.findings) {
    expect(verificationFindingSchema.safeParse(finding).success).toBe(true)
  }
  return new Set(result.findings.map(({ id }) => id))
}
