import { describe, expect, it } from 'vitest'

import {
  correlationSchema,
  localRetentionConfigSchema,
  operationalEventIdSchema,
  operationalEventIds,
  operationalEventRegistry,
  operationalSignalInputSchema,
  operationalSignalSchema,
  samplingConfigSchema,
} from './index.js'

const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const runId = '119f6bc1-0811-70c1-a139-938a3ad2dee0'
const attemptId = '219f6bc1-0811-70c1-a139-938a3ad2dee0'
const simulationId = '319f6bc1-0811-70c1-a139-938a3ad2dee0'

const signal = {
  schemaVersion: '1',
  occurredAt: '2026-07-17T12:00:00.000Z',
  severity: 'error',
  component: 'orchestrator',
  event: 'provider.call.completed',
  errorId: 'provider.transient-failure',
  correlation: { requestId, runId, attemptId, simulationId },
  attributes: {
    operation: 'concept-compilation',
    failureClass: 'transient',
    retryable: true,
    attemptNumber: 2,
  },
} as const

describe('operational signal contracts', () => {
  it('preserves all bounded correlation identifiers', () => {
    expect(operationalSignalSchema.parse(signal).correlation).toEqual({
      requestId,
      runId,
      attemptId,
      simulationId,
    })
  })

  it.each([
    ['unknown top-level field', { ...signal, detail: 'do not accept arbitrary text' }],
    ['password', { ...signal, password: 'secret' }],
    ['prompt', { ...signal, prompt: 'teacher content' }],
    ['generated content', { ...signal, generatedContent: 'candidate source' }],
    [
      'unknown attribute',
      { ...signal, attributes: { ...signal.attributes, arbitrary: 'unbounded cardinality' } },
    ],
    [
      'sensitive attribute',
      { ...signal, attributes: { ...signal.attributes, accessToken: 'token' } },
    ],
    ['unregistered error ID', { ...signal, errorId: 'provider.mystery' }],
    ['unregistered event ID', { ...signal, event: 'provider.mystery' }],
  ])('rejects %s', (_name, candidate) => {
    expect(operationalSignalSchema.safeParse(candidate).success).toBe(false)
  })

  it('requires correlation objects to contain a supported identifier', () => {
    expect(correlationSchema.safeParse({}).success).toBe(false)
    expect(correlationSchema.safeParse({ requestId, cookie: 'secret' }).success).toBe(false)
    expect(correlationSchema.safeParse({ attemptId }).success).toBe(false)
    expect(correlationSchema.safeParse({ runId, attemptId }).success).toBe(true)
  })

  it('keeps logger input strict and supplies no message or content escape hatch', () => {
    const input = {
      severity: signal.severity,
      component: signal.component,
      event: signal.event,
      errorId: signal.errorId,
      correlation: signal.correlation,
      attributes: signal.attributes,
    }
    expect(operationalSignalInputSchema.safeParse(input).success).toBe(true)
    expect(
      operationalSignalInputSchema.safeParse({ ...input, message: 'password=leak' }).success,
    ).toBe(false)
  })

  it('admits the trusted verifier as an operational component', () => {
    expect(
      operationalSignalInputSchema.safeParse({
        severity: 'info',
        component: 'verifier',
        event: 'verification.completed',
        correlation: { runId },
        attributes: { verdict: 'verified' },
      }).success,
    ).toBe(true)
  })

  it('registers every production operational event and the diagnostic fixture event', () => {
    expect(new Set(operationalEventIds).size).toBe(operationalEventIds.length)
    expect(Object.isFrozen(operationalEventIds)).toBe(true)
    expect(Object.isFrozen(operationalEventRegistry)).toBe(true)
    expect(Object.keys(operationalEventRegistry)).toEqual(operationalEventIds)
    expect(operationalEventIds).toEqual([
      'diagnostics.bundle-created',
      'generation.accepted',
      'generation.attempt.started',
      'generation.run.failed',
      'generation.transition',
      'generation.transition.persisted',
      'http.request.completed',
      'persistence.migration.failed',
      'persistence.recovery.failed',
      'persistence.startup.checked',
      'provider.call.completed',
      'runner.execution.completed',
      'telemetry.export.failed',
      'telemetry.shutdown.failed',
      'verification.completed',
    ])
    for (const eventId of operationalEventIds) {
      expect(operationalEventIdSchema.parse(eventId)).toBe(eventId)
    }
    expect(operationalEventIdSchema.safeParse('diagnostics.unregistered').success).toBe(false)
  })

  it('bounds retention and sampling configuration', () => {
    expect(localRetentionConfigSchema.parse({ maxEntries: 100, maxAgeMs: 60_000 })).toEqual({
      maxEntries: 100,
      maxAgeMs: 60_000,
    })
    expect(localRetentionConfigSchema.safeParse({ maxEntries: 0, maxAgeMs: 60_000 }).success).toBe(
      false,
    )
    expect(localRetentionConfigSchema.safeParse({ maxEntries: 1, maxAgeMs: 0 }).success).toBe(false)
    expect(
      samplingConfigSchema.safeParse({ debug: 0, info: 1, warn: 1, error: 1, secret: 1 }).success,
    ).toBe(false)
  })
})
