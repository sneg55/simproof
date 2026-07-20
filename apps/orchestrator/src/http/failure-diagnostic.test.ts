import { describe, expect, it } from 'vitest'

import { diagnosticAttributes, operationDiagnostic } from './failure-diagnostic.js'

describe('operationDiagnostic', () => {
  it('classifies a fail-closed operation-failed as an internal-error server fault', () => {
    expect(operationDiagnostic('operation-failed', undefined)).toEqual({
      failureClass: 'internal-error',
    })
  })

  it('pairs the internal-error class with a specific detail id when present', () => {
    expect(operationDiagnostic('operation-failed', 'educator.preview-evidence-mismatch')).toEqual({
      detail: 'educator.preview-evidence-mismatch',
      failureClass: 'internal-error',
    })
  })

  it('carries only the detail for client-tier codes, without a failure class', () => {
    expect(operationDiagnostic('conflict', 'educator.version-revision-conflict')).toEqual({
      detail: 'educator.version-revision-conflict',
    })
  })

  it('returns undefined when a client-tier failure carries no detail', () => {
    expect(operationDiagnostic('conflict', undefined)).toBeUndefined()
    expect(operationDiagnostic('invalid-input', undefined)).toBeUndefined()
    expect(operationDiagnostic('not-found', undefined)).toBeUndefined()
  })
})

describe('diagnosticAttributes', () => {
  it('projects a valid diagnostic into signal attributes', () => {
    expect(
      diagnosticAttributes({
        detail: 'educator.preview-out-of-bounds',
        failureClass: 'internal-error',
      }),
    ).toEqual({ detail: 'educator.preview-out-of-bounds', failureClass: 'internal-error' })
  })

  it('returns empty attributes when there is no diagnostic', () => {
    expect(diagnosticAttributes(undefined)).toEqual({})
  })

  it('drops a detail that violates the bounded-identifier contract instead of crashing', () => {
    // A malformed detail would make the logger throw at emit time; the boundary must never let a
    // logging concern fail the request, so the guard silently drops it.
    expect(diagnosticAttributes({ detail: 'Not A Bounded Id!' })).toEqual({})
  })
})
