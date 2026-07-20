import type { PreviewRequest, PublishVersionRequest } from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '@/api/http-client'
import { createReportPreviewApi } from '@/api/report-preview-api'

const versionId = '123e4567-e89b-42d3-a456-426614174000'
const csrfToken = 'c'.repeat(43)

describe('report and preview API', () => {
  it('uses canonical endpoints and passes strict schemas to the shared client', async () => {
    const request = vi.fn<HttpClient['request']>().mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', id: 'test.unavailable' },
    })
    const api = createReportPreviewApi({ request: request as HttpClient['request'] })
    const preview: PreviewRequest = {
      domain: 'pendulum',
      expectedVersionRevision: 2,
      input: { lengthM: 1, amplitudeDeg: 10 },
      sampleCount: 101,
    }
    const publication: PublishVersionRequest = {
      expectedRevision: 2,
      verificationRunId: '223e4567-e89b-42d3-a456-426614174000',
      exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
    }

    await api.versionReport(versionId)
    await api.seedReport('pendulum-period')
    await api.versionPreview(versionId, preview, csrfToken)
    await api.seedPreview('pendulum-period', preview, csrfToken)
    await api.publishVersion(versionId, publication, csrfToken)
    await api.reverifyVersion(
      versionId,
      { expectedRevision: 2, idempotencyKey: 'reverify:version:2' },
      csrfToken,
    )

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/api/versions/${versionId}/report`,
      '/api/seeds/pendulum-period/report',
      `/api/versions/${versionId}/preview`,
      '/api/seeds/pendulum-period/preview',
      `/api/versions/${versionId}/publish`,
      `/api/versions/${versionId}/reverify`,
    ])
    expect(
      request.mock.calls.slice(2).every(([, , options]) => options?.csrfToken === csrfToken),
    ).toBe(true)
  })

  it('rejects malformed identifiers and requests before transport', async () => {
    const request = vi.fn<HttpClient['request']>()
    const api = createReportPreviewApi({ request: request as HttpClient['request'] })
    const badPreview = {
      domain: 'projectile',
      expectedVersionRevision: 0,
      input: { initialSpeedMps: 20, launchAngleDeg: 45 },
      sampleCount: 2_002,
    } as unknown as PreviewRequest

    const [badId, badSeed, badRequest] = await Promise.all([
      api.versionReport('../report'),
      api.seedReport('bad/seed'),
      api.versionPreview(versionId, badPreview, csrfToken),
    ])

    expect(badId).toMatchObject({ ok: false, error: { kind: 'invalid-request' } })
    expect(badSeed).toMatchObject({ ok: false, error: { kind: 'invalid-request' } })
    expect(badRequest).toMatchObject({ ok: false, error: { kind: 'invalid-request' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('lets the shared client reject unknown fields in report and preview responses', async () => {
    const request = vi.fn<HttpClient['request']>().mockImplementation((_path, schema) => {
      const parsed = schema.safeParse({ injected: '<script>alert(1)</script>' })
      return Promise.resolve(
        parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
      )
    })
    const api = createReportPreviewApi({ request: request as HttpClient['request'] })

    const report = await api.versionReport(versionId)
    const preview = await api.versionPreview(
      versionId,
      {
        domain: 'pendulum',
        expectedVersionRevision: 0,
        input: { lengthM: 1, amplitudeDeg: 5 },
        sampleCount: 3,
      },
      csrfToken,
    )

    expect(report).toEqual({
      ok: false,
      error: { kind: 'invalid-response', id: 'web.invalid-response' },
    })
    expect(preview).toEqual({
      ok: false,
      error: { kind: 'invalid-response', id: 'web.invalid-response' },
    })
  })
})
