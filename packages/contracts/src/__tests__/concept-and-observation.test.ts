import { describe, expect, it } from 'vitest'

import {
  conceptSpecSchema,
  numericRangeSchema,
  pendulumInputSchema,
  pendulumObservationSchema,
  projectileInputSchema,
  projectileObservationSchema,
  sha256Schema,
  toleranceSchema,
} from '../index.js'

const projectileConcept = {
  schemaVersion: '1',
  domain: 'projectile',
  title: 'Explore projectile motion',
  parameters: {
    initialSpeed: {
      unit: 'm/s',
      defaultValue: 30,
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

describe('contract primitives', () => {
  it('accepts canonical hashes, ordered finite ranges, and explicit tolerances', () => {
    expect(sha256Schema.safeParse(`sha256:${'a'.repeat(64)}`).success).toBe(true)
    expect(numericRangeSchema.safeParse({ min: -1, max: 1 }).success).toBe(true)
    expect(toleranceSchema.safeParse({ mode: 'relative', relative: 0.01 }).success).toBe(true)
  })

  it.each([
    ['short hash', sha256Schema, 'sha256:abc'],
    ['non-finite range', numericRangeSchema, { min: 0, max: Number.POSITIVE_INFINITY }],
    ['inverted range', numericRangeSchema, { min: 2, max: 1 }],
    [
      'relative tolerance with unit',
      toleranceSchema,
      { mode: 'relative', relative: 0.01, unit: 'm' },
    ],
    ['negative tolerance', toleranceSchema, { mode: 'absolute', absolute: -1, unit: 'm' }],
    ['unknown tolerance key', toleranceSchema, { mode: 'relative', relative: 0.01, epsilon: 1 }],
  ])('rejects %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
})

describe('conceptSpecSchema', () => {
  it('accepts an exact projectile concept', () => {
    expect(conceptSpecSchema.parse(projectileConcept)).toEqual(projectileConcept)
  })

  it('accepts an exact pendulum concept', () => {
    const result = conceptSpecSchema.safeParse({
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Explore a simple pendulum',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 0, max: 10 } },
      },
      requestedControls: ['length', 'amplitude'],
    })

    expect(result.success).toBe(true)
  })

  it.each([
    ['unknown domain', { ...projectileConcept, domain: 'circuits' }],
    [
      'wrong unit',
      {
        ...projectileConcept,
        parameters: {
          ...projectileConcept.parameters,
          initialSpeed: { ...projectileConcept.parameters.initialSpeed, unit: 'km/h' },
        },
      },
    ],
    [
      'default outside range',
      {
        ...projectileConcept,
        parameters: {
          ...projectileConcept.parameters,
          launchAngle: { ...projectileConcept.parameters.launchAngle, defaultValue: 90 },
        },
      },
    ],
    [
      'duplicate controls',
      { ...projectileConcept, requestedControls: ['initialSpeed', 'initialSpeed'] },
    ],
    ['unknown key', { ...projectileConcept, tolerance: 0.1 }],
    [
      'non-finite parameter',
      {
        ...projectileConcept,
        parameters: {
          ...projectileConcept.parameters,
          initialSpeed: { ...projectileConcept.parameters.initialSpeed, defaultValue: Number.NaN },
        },
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(conceptSpecSchema.safeParse(value).success).toBe(false)
  })
})

describe('normalized observations', () => {
  it('accepts exact projectile and pendulum observations', () => {
    const projectileInput = { initialSpeedMps: 30, launchAngleDeg: 45 }
    expect(projectileInputSchema.safeParse(projectileInput).success).toBe(true)
    expect(
      projectileObservationSchema.safeParse({
        input: projectileInput,
        summary: {
          rangeM: 91.74,
          apexHeightM: 22.94,
          flightTimeS: 4.32,
          initialSpeedMps: 30,
        },
        trajectory: [
          { timeS: 0, xM: 0, yM: 0, speedMps: 30 },
          { timeS: 1, xM: 21.21, yM: 16.31, speedMps: 24.05 },
        ],
      }).success,
    ).toBe(true)

    const pendulumInput = { lengthM: 1, amplitudeDeg: 5 }
    expect(pendulumInputSchema.safeParse(pendulumInput).success).toBe(true)
    expect(
      pendulumObservationSchema.safeParse({ input: pendulumInput, periodS: 2.006 }).success,
    ).toBe(true)
  })

  it.each([
    [
      'extra input key',
      projectileInputSchema,
      { initialSpeedMps: 30, launchAngleDeg: 45, g: 9.81 },
    ],
    [
      'infinite input',
      projectileInputSchema,
      { initialSpeedMps: Number.POSITIVE_INFINITY, launchAngleDeg: 45 },
    ],
    [
      'decreasing sample time',
      projectileObservationSchema,
      {
        input: { initialSpeedMps: 30, launchAngleDeg: 45 },
        summary: { rangeM: 90, apexHeightM: 20, flightTimeS: 4, initialSpeedMps: 30 },
        trajectory: [
          { timeS: 1, xM: 1, yM: 1, speedMps: 20 },
          { timeS: 0.5, xM: 2, yM: 2, speedMps: 18 },
        ],
      },
    ],
    [
      'non-positive period',
      pendulumObservationSchema,
      { input: { lengthM: 1, amplitudeDeg: 5 }, periodS: 0 },
    ],
    ['zero amplitude input', pendulumInputSchema, { lengthM: 1, amplitudeDeg: 0 }],
  ])('rejects %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
})
