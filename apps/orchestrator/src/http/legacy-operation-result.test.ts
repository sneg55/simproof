import { describe, expect, it } from 'vitest'

import {
  generationOperationResult,
  internalError,
  privacyResult,
} from './legacy-operation-result.js'

describe('privacyResult', () => {
  it('attaches a fail-closed diagnostic to the generic 500 without leaking the message', () => {
    const response = privacyResult(
      {
        ok: false,
        error: {
          code: 'operation-failed',
          message: 'private storage path',
          detail: 'persistence.failed-closed',
        },
      },
      undefined,
    )

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      ok: false,
      error: { id: 'http.internal-error', message: 'Request could not be completed.' },
    })
    expect(response.diagnostic).toEqual({
      detail: 'persistence.failed-closed',
      failureClass: 'internal-error',
    })
    expect(JSON.stringify(response.body)).not.toContain('private storage path')
  })

  it('records the specific cause for a client-tier conflict', () => {
    const response = privacyResult(
      { ok: false, error: { code: 'conflict', message: 'x', detail: 'persistence.conflict' } },
      undefined,
    )

    expect(response.status).toBe(409)
    expect(response.diagnostic).toEqual({ detail: 'persistence.conflict' })
  })

  it('leaves success responses undiagnosed', () => {
    const response = privacyResult({ ok: true, value: { done: true } }, undefined)
    expect(response.status).toBe(200)
    expect(response.diagnostic).toBeUndefined()
  })
})

describe('generationOperationResult', () => {
  it('classifies a fail-closed generation error even without a specific detail', () => {
    const response = generationOperationResult(
      { ok: false, error: { code: 'operation-failed', message: 'x' } },
      undefined,
    )

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ error: { id: 'http.generation-unavailable' } })
    expect(response.diagnostic).toEqual({ failureClass: 'internal-error' })
  })
})

describe('internalError', () => {
  it('emits a stable detail for an internal fault behind the generic 500', () => {
    const response = internalError(undefined, 'auth.logout-failed')
    expect(response.status).toBe(500)
    expect(response.diagnostic).toEqual({
      detail: 'auth.logout-failed',
      failureClass: 'internal-error',
    })
  })
})
