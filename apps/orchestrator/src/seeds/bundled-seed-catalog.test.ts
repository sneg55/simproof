import {
  libraryPageSchema,
  type NormalizedPreview,
  normalizedPreviewSchema,
  seedMetadataSchema,
  simulationDetailSchema,
  verificationReportDisplaySchema,
} from '@simproof/contracts'
import { bundledCoreArtifactSource } from '@simproof/sim-runtime'
import { assessReportValidity, hashNormalizedSource } from '@simproof/verifier'
import { describe, expect, it, vi } from 'vitest'

import { createBundledSeedCatalog } from './bundled-seed-catalog.js'

const SEED_IDS = [
  'pendulum.small-angle',
  'projectile.introduction',
  'projectile.maximum-range',
  'projectile.complementary-angles',
  'projectile.speed-scaling',
  'pendulum.length-law',
  'pendulum.amplitude-assumption',
] as const

describe('offline bundled seed catalog', () => {
  it('exposes seven fixed projectile and pendulum seeds without configuration', () => {
    const catalog = createBundledSeedCatalog()
    const page = catalog.list()

    expect(libraryPageSchema.parse(page)).toEqual(page)
    expect(page.items.map(({ source }) => source.kind === 'seed' && source.seed.seedId)).toEqual(
      SEED_IDS,
    )
    expect(page.items.map(({ source }) => source.kind === 'seed' && source.seed.domain)).toEqual([
      'pendulum',
      'projectile',
      'projectile',
      'projectile',
      'projectile',
      'pendulum',
      'pendulum',
    ])
    for (const item of page.items) {
      if (item.source.kind !== 'seed') throw new TypeError('Expected a seed item.')
      expect(seedMetadataSchema.safeParse(item.source.seed).success).toBe(true)
      expect(item.source.seed).toMatchObject({ contentLicense: 'CC-BY-4.0' })
      expect(item.currentVersion).toMatchObject({
        state: 'verified',
        verification: { status: 'current', verdict: 'verified' },
      })
    }
  })

  it('returns strict detail and trusted, current verification displays', () => {
    const catalog = createBundledSeedCatalog()
    for (const seedId of SEED_IDS) {
      const detail = catalog.detail(seedId)
      const report = catalog.report(seedId)
      expect(detail.ok).toBe(true)
      expect(report.ok).toBe(true)
      if (!detail.ok || !report.ok) continue
      expect(simulationDetailSchema.parse(detail.value)).toEqual(detail.value)
      expect(verificationReportDisplaySchema.parse(report.value)).toEqual(report.value)
      expect(report.value).toMatchObject({
        validity: { status: 'current' },
        report: { verdict: 'verified' },
        badgeActive: true,
        publishable: false,
      })
      expect(detail.value.selectedVersion.summary.verification).toMatchObject({
        status: 'current',
        verificationRunId: report.value.verificationRunId,
      })
      expect(detail.value.selectedVersion.availableActions).toEqual(['preview', 'view-report'])
      expect(report.value.verificationRunId).not.toBe(report.value.report.reportId)
      expect(report.value.report.checks.every(({ outcome }) => outcome === 'passed')).toBe(true)
    }
  })

  it('invalidates evidence when the exact installed core implementation changes', () => {
    const display = createBundledSeedCatalog().report('projectile.introduction')
    expect(display.ok).toBe(true)
    if (!display.ok) return
    const report = display.value.report
    const installedSource = bundledCoreArtifactSource('projectile')
    expect(report.artifact.hash).toBe(hashNormalizedSource(installedSource))
    expect(
      assessReportValidity(report, {
        conceptSpecHash: report.conceptSpecHash,
        artifactHash: hashNormalizedSource(`${installedSource}\nchanged implementation`),
        observationHash: report.observationHash,
        policy: report.policy,
        domainPack: report.domainPack,
        runner: report.runner,
      }),
    ).toEqual({ status: 'stale', reasons: ['artifact-changed'] })
  })

  it('generates deterministic, bounded previews through strict requests', () => {
    const catalog = createBundledSeedCatalog()
    const projectileRequest = {
      domain: 'projectile',
      expectedVersionRevision: 4,
      input: { initialSpeedMps: 30, launchAngleDeg: 45 },
      sampleCount: 101,
    } as const
    const pendulumRequest = {
      domain: 'pendulum',
      expectedVersionRevision: 4,
      input: { lengthM: 1, amplitudeDeg: 10 },
      sampleCount: 201,
    } as const

    for (const [seedId, request] of [
      ['projectile.introduction', projectileRequest],
      ['pendulum.small-angle', pendulumRequest],
      [
        'projectile.maximum-range',
        { ...projectileRequest, input: { initialSpeedMps: 30, launchAngleDeg: 45 } },
      ],
      [
        'projectile.complementary-angles',
        { ...projectileRequest, input: { initialSpeedMps: 30, launchAngleDeg: 60 } },
      ],
      [
        'projectile.speed-scaling',
        { ...projectileRequest, input: { initialSpeedMps: 40, launchAngleDeg: 45 } },
      ],
      ['pendulum.length-law', { ...pendulumRequest, input: { lengthM: 2, amplitudeDeg: 5 } }],
      [
        'pendulum.amplitude-assumption',
        { ...pendulumRequest, input: { lengthM: 1, amplitudeDeg: 15 } },
      ],
    ] as const) {
      const first = catalog.preview(seedId, request)
      const second = catalog.preview(seedId, structuredClone(request))
      expect(first).toEqual(second)
      expect(first.ok).toBe(true)
      if (!first.ok) continue
      expect(normalizedPreviewSchema.parse(first.value)).toEqual(first.value)
      expect(first.value.samples).toHaveLength(request.sampleCount)
      expect(first.value.samples.length).toBeLessThanOrEqual(2_001)
      const report = catalog.report(seedId)
      expect(report.ok).toBe(true)
      if (report.ok) {
        expect(first.value.evidence.verificationRunId).toBe(report.value.verificationRunId)
        expect(first.value.evidence.verificationRunId).not.toBe(report.value.report.reportId)
      }
    }
  })

  it.each([2, 3, 4, 5, 6, 9])(
    'labels only scientifically exact event samples for adversarial sample count %i',
    (sampleCount) => {
      const catalog = createBundledSeedCatalog()
      const projectile = catalog.preview('projectile.introduction', {
        domain: 'projectile',
        expectedVersionRevision: 4,
        input: { initialSpeedMps: 30, launchAngleDeg: 45 },
        sampleCount,
      })
      const pendulum = catalog.preview('pendulum.small-angle', {
        domain: 'pendulum',
        expectedVersionRevision: 4,
        input: { lengthM: 1, amplitudeDeg: 10 },
        sampleCount,
      })
      expect(projectile.ok).toBe(true)
      expect(pendulum.ok).toBe(true)
      if (
        !projectile.ok ||
        !pendulum.ok ||
        projectile.value.domain !== 'projectile' ||
        pendulum.value.domain !== 'pendulum'
      ) {
        return
      }
      expectProjectileEvents(projectile.value, sampleCount)
      expectPendulumEvents(pendulum.value)
    },
  )

  it.each([
    [
      'unknown seed',
      'missing.seed',
      {
        domain: 'pendulum',
        expectedVersionRevision: 4,
        input: { lengthM: 1, amplitudeDeg: 10 },
        sampleCount: 10,
      },
    ],
    [
      'wrong domain',
      'pendulum.small-angle',
      {
        domain: 'projectile',
        expectedVersionRevision: 4,
        input: { initialSpeedMps: 20, launchAngleDeg: 45 },
        sampleCount: 10,
      },
    ],
    [
      'stale revision',
      'projectile.introduction',
      {
        domain: 'projectile',
        expectedVersionRevision: 3,
        input: { initialSpeedMps: 20, launchAngleDeg: 45 },
        sampleCount: 10,
      },
    ],
    [
      'outside concept',
      'projectile.introduction',
      {
        domain: 'projectile',
        expectedVersionRevision: 4,
        input: { initialSpeedMps: 100, launchAngleDeg: 45 },
        sampleCount: 10,
      },
    ],
    [
      'oversized',
      'pendulum.small-angle',
      {
        domain: 'pendulum',
        expectedVersionRevision: 4,
        input: { lengthM: 1, amplitudeDeg: 10 },
        sampleCount: 2_002,
      },
    ],
    [
      'unknown key',
      'pendulum.small-angle',
      {
        domain: 'pendulum',
        expectedVersionRevision: 4,
        input: { lengthM: 1, amplitudeDeg: 10 },
        sampleCount: 10,
        apiKey: 'secret',
      },
    ],
  ] as const)('rejects malformed preview input: %s', (_label, seedId, request) => {
    expect(createBundledSeedCatalog().preview(seedId, request).ok).toBe(false)
  })

  it('requires no credentials, provider port, or network access', () => {
    const network = vi.fn(() => Promise.reject(new TypeError('Network must remain unused.')))
    vi.stubGlobal('fetch', network)
    try {
      expect(createBundledSeedCatalog).toHaveLength(0)
      expect(createBundledSeedCatalog().list().items).toHaveLength(SEED_IDS.length)
      expect(network).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

function expectProjectileEvents(
  preview: Extract<NormalizedPreview, { domain: 'projectile' }>,
  sampleCount: number,
): void {
  for (const event of preview.events) {
    const sample = preview.samples.at(event.sampleIndex)
    if (sample === undefined) continue
    if (event.kind === 'launch') expect(sample.timeS).toBe(0)
    if (event.kind === 'apex') expect(Math.abs(sample.velocityYMps ?? Infinity)).toBeLessThan(1e-12)
    if (event.kind === 'impact') expect(sample.yM).toBe(0)
  }
  expect(preview.events.some(({ kind }) => kind === 'apex')).toBe(sampleCount % 2 === 1)
}

function expectPendulumEvents(preview: Extract<NormalizedPreview, { domain: 'pendulum' }>): void {
  for (const event of preview.events) {
    const sample = preview.samples.at(event.sampleIndex)
    if (sample === undefined) continue
    if (event.kind === 'equilibrium-crossing') expect(Math.abs(sample.angleDeg)).toBeLessThan(1e-12)
    if (event.kind === 'left-turning-point') expect(sample.angleDeg).toBeCloseTo(-10, 12)
    if (event.kind === 'right-turning-point') expect(sample.angleDeg).toBeCloseTo(10, 12)
    if (event.kind.includes('turning-point')) {
      expect(Math.abs(sample.angularVelocityDegPerS ?? Infinity)).toBeLessThan(1e-12)
    }
  }
}
