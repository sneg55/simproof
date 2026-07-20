import { describe, expect, it } from 'vitest'

import {
  normalizedPendulumPreviewSchema,
  normalizedPreviewSchema,
  normalizedProjectilePreviewSchema,
  previewRequestSchema,
  rendererDataSchema,
} from '../index.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
const hash = `sha256:${'a'.repeat(64)}`

const concept = {
  schemaVersion: '1',
  domain: 'projectile',
  title: 'Projectile motion',
  parameters: {
    initialSpeed: { unit: 'm/s', defaultValue: 20, requestedRange: { min: 10, max: 30 } },
    launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
  },
  requestedControls: ['initialSpeed', 'launchAngle'],
} as const

const renderer = {
  schemaVersion: '1',
  domain: 'projectile',
  renderer: 'projectile-trajectory',
  features: ['trail', 'apex-marker', 'impact-marker'],
} as const

const evidence = {
  verificationRunId: id,
  artifactHash: hash,
  validity: { status: 'current' },
  assumptions: ['Uniform gravity.'],
  limitations: ['No aerodynamic drag.'],
} as const

const preview = {
  schemaVersion: '1',
  domain: 'projectile',
  simulationVersionId: id,
  conceptSpec: concept,
  renderer,
  input: { initialSpeedMps: 20, launchAngleDeg: 45 },
  evidence,
  samples: [
    { index: 0, timeS: 0, xM: 0, yM: 0, speedMps: 20 },
    { index: 1, timeS: 1, xM: 14, yM: 9, speedMps: 15 },
    { index: 2, timeS: 3, xM: 42, yM: 0, speedMps: 20 },
  ],
  events: [
    { kind: 'launch', sampleIndex: 0 },
    { kind: 'apex', sampleIndex: 1 },
    { kind: 'impact', sampleIndex: 2 },
  ],
} as const

const pendulumPreview = {
  schemaVersion: '1',
  domain: 'pendulum',
  simulationVersionId: id,
  conceptSpec: {
    schemaVersion: '1',
    domain: 'pendulum',
    title: 'Simple pendulum',
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  },
  renderer: {
    schemaVersion: '1',
    domain: 'pendulum',
    renderer: 'pendulum-bob',
    features: ['equilibrium-line', 'turning-points'],
  },
  input: { lengthM: 1, amplitudeDeg: 10 },
  periodS: 2,
  evidence,
  samples: [
    { index: 0, timeS: 0, angleDeg: 10 },
    { index: 1, timeS: 0.5, angleDeg: 0 },
    { index: 2, timeS: 1, angleDeg: -10 },
  ],
  events: [
    { kind: 'left-turning-point', sampleIndex: 0 },
    { kind: 'equilibrium-crossing', sampleIndex: 1 },
    { kind: 'right-turning-point', sampleIndex: 2 },
  ],
} as const

describe('renderer and preview contracts', () => {
  it('accepts only fixed non-executable renderer vocabulary', () => {
    expect(rendererDataSchema.safeParse(renderer).success).toBe(true)
    for (const injection of [
      { html: '<script>alert(1)</script>' },
      { onload: 'alert(1)' },
      { url: 'javascript:alert(1)' },
      { css: 'body{display:none}' },
      { source: 'eval("bad")' },
    ]) {
      expect(rendererDataSchema.safeParse({ ...renderer, ...injection }).success).toBe(false)
    }
    expect(
      rendererDataSchema.safeParse({ ...renderer, features: ['trail', 'trail'] }).success,
    ).toBe(false)
  })

  it('bounds preview requests and rejects unknown execution material', () => {
    const request = {
      domain: 'projectile',
      expectedVersionRevision: 4,
      input: { initialSpeedMps: 20, launchAngleDeg: 45 },
      sampleCount: 501,
    } as const
    expect(previewRequestSchema.safeParse(request).success).toBe(true)
    expect(previewRequestSchema.safeParse({ ...request, sampleCount: 2_002 }).success).toBe(false)
    expect(
      previewRequestSchema.safeParse({ ...request, coreSource: 'export default {}' }).success,
    ).toBe(false)
  })

  it('requires contiguous samples, monotonic time, and in-bounds events', () => {
    expect(normalizedPreviewSchema.safeParse(preview).success).toBe(true)
    expect(
      normalizedPreviewSchema.safeParse({
        ...preview,
        events: [{ kind: 'apex', sampleIndex: preview.samples.length }],
      }).success,
    ).toBe(false)
    expect(
      normalizedPreviewSchema.safeParse({
        ...preview,
        samples: [preview.samples[0], { ...preview.samples[1], index: 4 }],
        events: [],
      }).success,
    ).toBe(false)
    expect(
      normalizedPreviewSchema.safeParse({
        ...preview,
        samples: [preview.samples[0], { ...preview.samples[1], timeS: -1 }],
        events: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a preview input outside the reviewed concept bounds', () => {
    expect(
      normalizedPreviewSchema.safeParse({
        ...preview,
        input: { initialSpeedMps: 40, launchAngleDeg: 45 },
      }).success,
    ).toBe(false)
  })

  it('supports the strict pendulum renderer and normalized time-series variant', () => {
    expect(normalizedPreviewSchema.safeParse(pendulumPreview).success).toBe(true)
    expect(
      normalizedPreviewSchema.safeParse({
        ...pendulumPreview,
        events: [{ kind: 'equilibrium-crossing', sampleIndex: 3 }],
      }).success,
    ).toBe(false)
  })

  it('keeps domain-specific normalized schemas behind the shared normalization checks', () => {
    expect(normalizedProjectilePreviewSchema.safeParse(preview).success).toBe(true)
    expect(normalizedPendulumPreviewSchema.safeParse(pendulumPreview).success).toBe(true)

    expect(
      normalizedProjectilePreviewSchema.safeParse({
        ...preview,
        samples: [preview.samples[1], preview.samples[0]],
      }).success,
    ).toBe(false)
    expect(
      normalizedProjectilePreviewSchema.safeParse({
        ...preview,
        events: [{ kind: 'impact', sampleIndex: preview.samples.length }],
      }).success,
    ).toBe(false)
    expect(
      normalizedProjectilePreviewSchema.safeParse({
        ...preview,
        input: { initialSpeedMps: 31, launchAngleDeg: 45 },
      }).success,
    ).toBe(false)

    expect(
      normalizedPendulumPreviewSchema.safeParse({
        ...pendulumPreview,
        samples: [pendulumPreview.samples[1], pendulumPreview.samples[0]],
      }).success,
    ).toBe(false)
    expect(
      normalizedPendulumPreviewSchema.safeParse({
        ...pendulumPreview,
        events: [{ kind: 'equilibrium-crossing', sampleIndex: pendulumPreview.samples.length }],
      }).success,
    ).toBe(false)
    expect(
      normalizedPendulumPreviewSchema.safeParse({
        ...pendulumPreview,
        input: { lengthM: 2.01, amplitudeDeg: 10 },
      }).success,
    ).toBe(false)
  })
})
