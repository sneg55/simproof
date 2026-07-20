import { describe, expect, it } from 'vitest'

import { pendulumDomainSceneSchema, projectileDomainSceneSchema } from '../index.js'

const assumptions = ['Application-owned constant-gravity model.']
const limitations = ['Only verified normalized values are represented.']

describe('domain scene contracts', () => {
  it('accepts complete projectile evidence rows and rejects partial or executable data', () => {
    const scene = {
      renderer: 'projectile-trajectory',
      rows: [
        {
          initialSpeedMps: 30,
          launchAngleDeg: 45,
          timeS: 0,
          xM: 0,
          yM: 0,
          speedMps: 30,
          velocityXMps: 21.213,
          velocityYMps: 21.213,
          event: 'launch',
        },
      ],
      assumptions,
      limitations,
    } as const

    expect(projectileDomainSceneSchema.safeParse(scene).success).toBe(true)
    const { yM: _missing, ...partialRow } = scene.rows[0]
    expect(projectileDomainSceneSchema.safeParse({ ...scene, rows: [partialRow] }).success).toBe(
      false,
    )
    expect(
      projectileDomainSceneSchema.safeParse({
        ...scene,
        rows: [{ ...scene.rows[0], onload: 'alert(1)' }],
      }).success,
    ).toBe(false)
    expect(
      projectileDomainSceneSchema.safeParse({
        ...scene,
        rows: [{ ...scene.rows[0], speedMps: Number.POSITIVE_INFINITY }],
      }).success,
    ).toBe(false)
  })

  it('accepts complete pendulum evidence rows and rejects invalid state vocabulary', () => {
    const scene = {
      renderer: 'pendulum-bob',
      rows: [
        {
          lengthM: 1,
          amplitudeDeg: 10,
          periodS: 2.006,
          timeS: 0,
          angleDeg: 10,
          angularVelocityDegPerS: 'not-provided',
          event: 'left-turning-point',
        },
      ],
      assumptions,
      limitations,
    } as const

    expect(pendulumDomainSceneSchema.safeParse(scene).success).toBe(true)
    expect(
      pendulumDomainSceneSchema.safeParse({
        ...scene,
        rows: [{ ...scene.rows[0], event: 'teleport' }],
      }).success,
    ).toBe(false)
    expect(pendulumDomainSceneSchema.safeParse({ ...scene, assumptions: [] }).success).toBe(false)
    expect(projectileDomainSceneSchema.safeParse(scene).success).toBe(false)
  })
})
