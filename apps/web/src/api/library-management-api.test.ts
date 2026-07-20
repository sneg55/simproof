import type { DuplicateSimulationRequest, StartBlankVersionRequest } from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from '@/api/http-client'
import { createLibraryManagementApi } from '@/api/library-management-api'

const simulationId = '11111111-1111-4111-8111-111111111111'
const leftId = '22222222-2222-4222-8222-222222222222'
const rightId = '33333333-3333-4333-8333-333333333333'
const csrfToken = 'c'.repeat(43)

describe('library management API', () => {
  it('binds commands to canonical resources and exact concurrency fields', async () => {
    const request = vi.fn<HttpClient['request']>().mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', id: 'test.unavailable' },
    })
    const api = createLibraryManagementApi({ request: request as HttpClient['request'] })
    const source: StartBlankVersionRequest = {
      sourceVersionId: leftId,
      expectedSourceRevision: 7,
    }
    const separate: DuplicateSimulationRequest = { ...source, title: 'Lesson copy' }

    await api.createDraft({ title: 'New lesson' }, csrfToken)
    await api.simulationDetail(simulationId)
    await api.versionHistory(simulationId)
    await api.compareVersions(simulationId, leftId, rightId)
    await api.startBlankVersion(simulationId, source, csrfToken)
    await api.duplicateSimulation(simulationId, separate, csrfToken)
    await api.exportSimulation(simulationId, 'current password', csrfToken)
    await api.archiveVersion(leftId, { expectedRevision: 7 }, csrfToken)
    await api.deleteSimulation(simulationId, 'current password', csrfToken)
    await api.reverifyVersion(
      leftId,
      { expectedRevision: 7, idempotencyKey: 'reverify:version:7' },
      csrfToken,
    )

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/simulations',
      `/api/simulations/${simulationId}`,
      `/api/simulations/${simulationId}/versions`,
      `/api/simulations/${simulationId}/compare?left=${leftId}&right=${rightId}`,
      `/api/simulations/${simulationId}/versions`,
      `/api/simulations/${simulationId}/duplicate`,
      `/api/simulations/${simulationId}/export`,
      `/api/versions/${leftId}/archive`,
      '/api/privacy/simulation',
      `/api/versions/${leftId}/reverify`,
    ])
    expect(request.mock.calls[4]?.[2]?.body).toEqual(source)
    expect(request.mock.calls[5]?.[2]?.body).toEqual(separate)
    expect(request.mock.calls[6]?.[2]?.body).toEqual({
      simulationId,
      currentPassword: 'current password',
    })
    expect(request.mock.calls[8]?.[2]?.body).toEqual({
      simulationId,
      currentPassword: 'current password',
      confirmation: 'delete',
    })
    expect(
      request.mock.calls
        .filter(([, , options]) => options?.method !== undefined)
        .every(([, , options]) => options?.csrfToken === csrfToken),
    ).toBe(true)
  })

  it('rejects malformed ids, same-version comparisons, invalid CAS, and invalid passwords', async () => {
    const request = vi.fn<HttpClient['request']>()
    const api = createLibraryManagementApi({ request: request as HttpClient['request'] })
    const results = await Promise.all([
      api.simulationDetail('../private'),
      api.compareVersions(simulationId, leftId, leftId),
      api.startBlankVersion(
        simulationId,
        { sourceVersionId: leftId, expectedSourceRevision: -1 },
        csrfToken,
      ),
      api.duplicateSimulation(
        simulationId,
        { sourceVersionId: leftId, expectedSourceRevision: 0, title: '' },
        csrfToken,
      ),
      api.exportSimulation(simulationId, '', csrfToken),
      api.deleteSimulation(simulationId, `bad\0password`, csrfToken),
      api.reverifyVersion(leftId, { expectedRevision: 0, idempotencyKey: 'short' }, csrfToken),
    ])

    expect(results.every((result) => !result.ok && result.error.kind === 'invalid-request')).toBe(
      true,
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('passes strict response schemas to the shared client', async () => {
    const request = vi.fn<HttpClient['request']>().mockImplementation((_path, schema) => {
      const parsed = schema.safeParse({ injected: '<script>alert(1)</script>' })
      return Promise.resolve(
        parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
      )
    })
    const api = createLibraryManagementApi({ request: request as HttpClient['request'] })

    const [history, deletion, exported] = await Promise.all([
      api.versionHistory(simulationId),
      api.deleteSimulation(simulationId, 'password', csrfToken),
      api.exportSimulation(simulationId, 'password', csrfToken),
    ])

    expect([history, deletion, exported]).toEqual([
      { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
      { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
      { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
    ])
  })

  it('accepts the content-addressed hashes returned by artifact deletion', async () => {
    const deleted = `sha256:${'a'.repeat(64)}`
    const deferred = `sha256:${'b'.repeat(64)}`
    const request: HttpClient['request'] = (_path, schema) => {
      const parsed = schema.safeParse({
        deletedArtifacts: [deleted],
        deferredArtifacts: [deferred],
      })
      return Promise.resolve(
        parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, error: { kind: 'invalid-response', id: 'web.invalid-response' } },
      )
    }
    const result = await createLibraryManagementApi({ request }).deleteSimulation(
      simulationId,
      'password',
      csrfToken,
    )

    expect(result).toEqual({
      ok: true,
      value: { deletedArtifacts: [deleted], deferredArtifacts: [deferred] },
    })
  })
})
