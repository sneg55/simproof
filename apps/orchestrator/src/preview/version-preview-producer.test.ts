import type { PreviewRequest, VerificationReportDisplay } from '@simproof/contracts'
import { hashCanonicalJson } from '@simproof/verifier'
import { describe, expect, it } from 'vitest'

import type { EducatorReportProjection } from '../educator/report-projection.js'
import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { createVersionPreviewProducer } from './version-preview-producer.js'

const REQUEST: PreviewRequest = {
  domain: 'projectile',
  expectedVersionRevision: 4,
  input: { initialSpeedMps: 20, launchAngleDeg: 45 },
  sampleCount: 101,
}

function reportsReturning(
  display:
    | { readonly ok: true; readonly value: VerificationReportDisplay }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } },
): EducatorReportProjection {
  return { display: () => Promise.resolve(display) } as unknown as EducatorReportProjection
}

function verifiedDisplay(): VerificationReportDisplay {
  const report = createBundledSeedCatalog().report('projectile.introduction')
  if (!report.ok) throw new Error('Bundled seed report unavailable.')
  return report.value
}

describe('version preview producer', () => {
  it('builds a trusted preview bound to the version report', async () => {
    const display = verifiedDisplay()
    const producer = createVersionPreviewProducer(reportsReturning({ ok: true, value: display }))

    const result = await producer.preview(display.simulationVersionId, REQUEST, 'session')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const preview = result.value
    expect(preview.domain).toBe('projectile')
    expect(preview.samples.length).toBe(REQUEST.sampleCount)
    // Evidence and identity must bind to the verified report, or previewBindingsMatch would reject.
    expect(preview.simulationVersionId).toBe(display.simulationVersionId)
    expect(preview.evidence.verificationRunId).toBe(display.verificationRunId)
    expect(preview.evidence.artifactHash).toBe(display.report.artifact.hash)
    expect(hashCanonicalJson(preview.conceptSpec)).toBe(display.report.conceptSpecHash)
    expect(preview.evidence.assumptions).toEqual(display.report.assumptions)
    expect(preview.evidence.limitations).toEqual(display.report.limitations)
  })

  it('fails closed when the version report cannot be loaded', async () => {
    const producer = createVersionPreviewProducer(
      reportsReturning({ ok: false, error: { code: 'not-found', message: 'gone' } }),
    )

    const result = await producer.preview(
      '40000000-0000-4000-8000-000000000009',
      REQUEST,
      'session',
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('rejects an input outside the reviewed concept bounds as invalid-input', async () => {
    const display = verifiedDisplay()
    if (display.conceptSpec.domain !== 'projectile') throw new Error('Expected a projectile seed.')
    const outOfBounds: PreviewRequest = {
      domain: 'projectile',
      expectedVersionRevision: 4,
      input: {
        initialSpeedMps: display.conceptSpec.parameters.initialSpeed.requestedRange.max + 1,
        launchAngleDeg: display.conceptSpec.parameters.launchAngle.defaultValue,
      },
      sampleCount: 101,
    }
    const producer = createVersionPreviewProducer(reportsReturning({ ok: true, value: display }))

    const result = await producer.preview(display.simulationVersionId, outOfBounds, 'session')

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })
})
