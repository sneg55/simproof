import { describe, expect, it } from 'vitest'

import {
  createOperationalError,
  OperationalError,
  operationalErrorIdSchema,
  operationalErrorRegistry,
  safeClientErrorSchema,
  toSafeClientError,
} from './index.js'

const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'

describe('operational errors', () => {
  it('provides a unique, immutable, schema-valid stable registry across failure classes', () => {
    const ids = Object.keys(operationalErrorRegistry)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.isFrozen(operationalErrorRegistry)).toBe(true)
    expect(ids.length).toBeGreaterThanOrEqual(12)
    for (const id of ids) expect(operationalErrorIdSchema.safeParse(id).success).toBe(true)
    expect(ids).toEqual(
      expect.arrayContaining([
        'configuration.invalid',
        'generation.budget-exhausted',
        'generation.cancelled',
        'http.csrf-denied',
        'http.session-required',
        'migration.failed',
        'provider.authentication-failed',
        'readiness.database-unavailable',
        'runner.policy-denied',
        'runner.resource-limit',
        'verifier.scientific-rejection',
      ]),
    )
    expect(operationalErrorIdSchema.safeParse('runner.denied.network').success).toBe(true)
    expect(operationalErrorIdSchema.safeParse('runner.runtime.malformed-output').success).toBe(true)
  })

  it('preserves the internal cause while exposing only an allowlisted client error', () => {
    const secret = 'sk-internal-cause-sentinel-123456789'
    const cause = new TypeError(`provider returned ${secret}`)
    const error = createOperationalError('provider.transient-failure', {
      cause,
      correlation: { requestId },
    })

    expect(error).toBeInstanceOf(OperationalError)
    expect(error.cause).toBe(cause)
    expect(error.errorId).toBe('provider.transient-failure')

    const safe = toSafeClientError(error)
    expect(safeClientErrorSchema.parse(safe)).toEqual({
      errorId: 'provider.transient-failure',
      message: 'The model provider is temporarily unavailable.',
      requestId,
    })
    expect(JSON.stringify(safe)).not.toContain(secret)
    expect(safe).not.toHaveProperty('cause')
    expect(safe).not.toHaveProperty('stack')
  })

  it('does not expose a correlation identifier other than requestId to clients', () => {
    const error = createOperationalError('runner.execution-failed', {
      correlation: {
        requestId,
        runId: '119f6bc1-0811-70c1-a139-938a3ad2dee0',
        attemptId: '219f6bc1-0811-70c1-a139-938a3ad2dee0',
        simulationId: '319f6bc1-0811-70c1-a139-938a3ad2dee0',
      },
    })
    expect(toSafeClientError(error)).toEqual({
      errorId: 'runner.execution-failed',
      message: 'The isolated runner could not complete the request.',
      requestId,
    })
  })
})
