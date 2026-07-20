import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CANONICAL_PROJECTILE_UNITS,
  isWithinProjectileAbsoluteTolerance,
  PROJECTILE_BOUNDARY_ERROR_IDS,
  PROJECTILE_FINDING_IDS,
  PROJECTILE_MAIN_GRID,
  PROJECTILE_PEAK_ANGLE_GRID,
  PROJECTILE_POLICY,
  PROJECTILE_SAMPLE_FRACTIONS,
  PROJECTILE_VERIFICATION_INPUTS,
  projectileApplicability,
  projectileReference,
  verifyProjectile,
} from './index.js'
import { batchFromFixture, type ProjectileFixture } from './test-fixture.js'

const badUnits = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../tests/fixtures/negative-controls/projectile-bad-units.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ProjectileFixture

describe('projectile policy governance', () => {
  it('owns bounded applicability, grids, checks, and quantity tolerances', () => {
    expect(PROJECTILE_POLICY).toMatchObject({
      id: 'projectile-vacuum-level-earth',
      version: '1.1.0',
      domain: 'projectile',
      applicability: {
        initialSpeedMps: { min: 15, max: 40 },
        launchAngleDeg: { min: 15, max: 75 },
      },
      tolerances: {
        rangeM: { mode: 'relative', relative: 0.01 },
        apexHeightM: { mode: 'relative', relative: 0.01 },
        flightTimeS: { mode: 'relative', relative: 0.01 },
        trajectoryYM: { relativeTo: 'apexHeightM', relative: 0.02 },
        trajectoryTimeS: { relativeScale: 1e-10 },
        trajectoryXM: { relativeTo: 'rangeM', relative: 1e-10 },
        specificEnergy: { mode: 'relative', relative: 0.02 },
        rangeMaximum: { expectedAngleDeg: 45, relativeOrdering: 0.01 },
      },
    })
    expect(PROJECTILE_MAIN_GRID).toHaveLength(5)
    expect(PROJECTILE_PEAK_ANGLE_GRID).toEqual([30, 40, 45, 50, 60])
    expect(PROJECTILE_SAMPLE_FRACTIONS).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(Object.isFrozen(PROJECTILE_POLICY)).toBe(true)
  })

  it('removes the unreachable trajectory floor only after proving relative dominance', () => {
    const formerAbsoluteFloorM = 0.02
    const relativeAllowances = PROJECTILE_VERIFICATION_INPUTS.map(
      (input) =>
        projectileReference(input).apexHeightM * PROJECTILE_POLICY.tolerances.trajectoryYM.relative,
    )

    expect(relativeAllowances).toHaveLength(9)
    expect(Math.min(...relativeAllowances)).toBeGreaterThan(formerAbsoluteFloorM)
    expect(PROJECTILE_POLICY.tolerances.trajectoryYM).toEqual({
      relativeTo: 'apexHeightM',
      relative: 0.02,
    })
    expect(PROJECTILE_POLICY.tolerances.trajectoryYM).not.toHaveProperty('absoluteFloorM')
  })

  it('fails closed outside policy bounds or canonical units', () => {
    expect(
      projectileApplicability(
        { initialSpeedMps: 14.99, launchAngleDeg: 30 },
        CANONICAL_PROJECTILE_UNITS,
      ),
    ).toMatchObject({
      applicable: false,
      findingId: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
    })
    expect(
      projectileApplicability(
        { initialSpeedMps: 20, launchAngleDeg: 75.01 },
        CANONICAL_PROJECTILE_UNITS,
      ),
    ).toMatchObject({
      applicable: false,
      findingId: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
    })
    expect(verifyProjectile(batchFromFixture(badUnits))).toEqual({
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.unsupportedUnits,
        message: "Runner observations must use the projectile policy's canonical units.",
      },
    })

    const analytic = batchFromFixture({ id: 'applicability-lifecycle', implementation: 'analytic' })
    const first = analytic.observations[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(
      verifyProjectile({
        ...analytic,
        observations: [
          { ...first, input: { ...first.input, initialSpeedMps: 14.99 } },
          ...analytic.observations.slice(1),
        ],
      }),
    ).toEqual({
      ok: false,
      error: {
        id: PROJECTILE_BOUNDARY_ERROR_IDS.invalidObservation,
        message:
          'Runner output must contain each verifier-requested projectile observation exactly once.',
      },
    })
  })

  it('publishes stable finding identifiers', () => {
    expect(PROJECTILE_FINDING_IDS).toEqual({
      rangeMismatch: 'projectile.range.relative-error',
      apexMismatch: 'projectile.apex-height.relative-error',
      flightTimeMismatch: 'projectile.flight-time.relative-error',
      trajectoryResidual: 'projectile.trajectory.curve-residual',
      energyDrift: 'projectile.energy.non-conservation',
      rangeMaximumViolation: 'projectile.range.maximum-angle',
      sampleCoverageInsufficient: 'projectile.trajectory.sample-coverage',
      sampleLocationMismatch: 'projectile.trajectory.sample-location',
    })
    expect(PROJECTILE_BOUNDARY_ERROR_IDS).toEqual({
      invalidObservation: 'projectile.boundary.invalid-observation',
      unsupportedUnits: 'projectile.boundary.unsupported-units',
    })
  })

  it('uses the exact declared absolute boundary with no hidden acceptance margin', () => {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    const adjacent = (value: number, direction: -1 | 1): number => {
      view.setFloat64(0, value)
      const bits = view.getBigUint64(0)
      view.setBigUint64(0, direction < 0 ? bits - 1n : bits + 1n)
      return view.getFloat64(0)
    }
    const allowedError = 0.02

    expect(isWithinProjectileAbsoluteTolerance(adjacent(allowedError, -1), 0, allowedError)).toBe(
      true,
    )
    expect(isWithinProjectileAbsoluteTolerance(allowedError, 0, allowedError)).toBe(true)
    expect(isWithinProjectileAbsoluteTolerance(adjacent(allowedError, 1), 0, allowedError)).toBe(
      false,
    )
  })
})
