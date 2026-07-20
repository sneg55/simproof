import { describe, expect, it } from 'vitest'

import {
  adminBootstrapRequestSchema,
  loginRequestSchema,
  MIN_REQUEST_BODY_BYTES,
  newPasswordInputSchema,
  passwordInputSchema,
  privacySettingsSchema,
  publicRuntimeConfigSchema,
  sessionRecordSchema,
  sessionTokenSchema,
  simulationDeletionRequestSchema,
  teacherGenerationRequestSchema,
} from '../index.js'

describe('teacher auth and privacy boundary contracts', () => {
  it('accepts only bounded strict authentication inputs and opaque session material', () => {
    expect(loginRequestSchema.safeParse({ password: 'teacher-secret' }).success).toBe(true)
    expect(
      loginRequestSchema.safeParse({ password: 'teacher-secret', username: 'student' }).success,
    ).toBe(false)
    expect(loginRequestSchema.safeParse({ password: 'x'.repeat(1_025) }).success).toBe(false)
    expect(passwordInputSchema.safeParse('é'.repeat(512)).success).toBe(true)
    expect(passwordInputSchema.safeParse('é'.repeat(513)).success).toBe(false)
    expect(newPasswordInputSchema.safeParse('é'.repeat(6)).success).toBe(true)
    expect(newPasswordInputSchema.safeParse('é'.repeat(5)).success).toBe(false)
    expect(newPasswordInputSchema.safeParse('valid-password\0').success).toBe(false)
    expect(
      adminBootstrapRequestSchema.safeParse({
        bootstrapSecret: '0123456789abcdef'.repeat(64),
        newPassword: 'correct horse battery staple',
      }).success,
    ).toBe(true)
    expect(
      adminBootstrapRequestSchema.safeParse({
        bootstrapSecret: `${'0123456789abcdef'.repeat(64)}x`,
        newPassword: 'correct horse battery staple',
      }).success,
    ).toBe(false)
    expect(sessionTokenSchema.safeParse('a'.repeat(43)).success).toBe(true)
    expect(sessionTokenSchema.safeParse('short').success).toBe(false)
  })

  it('requires internally consistent bounded server-side session records', () => {
    const record = {
      id: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
      administratorId: 1,
      tokenHash: 'a'.repeat(64),
      csrfHash: 'b'.repeat(64),
      credentialVersion: 1,
      createdAt: '2026-07-16T12:00:00.000Z',
      lastActivityAt: '2026-07-16T12:00:00.000Z',
      expiresAt: '2026-07-16T20:00:00.000Z',
      rotatedFromId: null,
      revokedAt: null,
    }
    expect(sessionRecordSchema.safeParse(record).success).toBe(true)
    expect(sessionRecordSchema.safeParse({ ...record, expiresAt: record.createdAt }).success).toBe(
      false,
    )
    expect(
      sessionRecordSchema.safeParse({ ...record, lastActivityAt: record.expiresAt }).success,
    ).toBe(false)
    expect(sessionRecordSchema.safeParse({ ...record, rawToken: 'forbidden' }).success).toBe(false)
  })

  it('defaults privacy export switches off and rejects student or secret-shaped extras', () => {
    expect(privacySettingsSchema.parse({})).toEqual({
      promptRetention: 'discard',
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    })
    expect(
      teacherGenerationRequestSchema.safeParse({
        prompt: 'Create a pendulum simulation.',
        externalProviderDisclosureAccepted: true,
        promptRetention: 'discard',
        studentId: 'not-collected',
      }).success,
    ).toBe(false)
    expect(
      simulationDeletionRequestSchema.safeParse({
        simulationId: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
        confirmation: 'delete',
      }).success,
    ).toBe(true)
  })

  it('keeps the browser-safe config strict and incapable of carrying server secrets', () => {
    const publicConfig = {
      deploymentMode: 'network',
      providerConfigured: true,
      maxRequestBytes: 65_536,
      maxPromptCharacters: 16_384,
      promptRetentionDefault: 'discard',
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    }
    expect(publicRuntimeConfigSchema.safeParse(publicConfig).success).toBe(true)
    expect(
      publicRuntimeConfigSchema.safeParse({
        ...publicConfig,
        maxRequestBytes: MIN_REQUEST_BODY_BYTES - 1,
      }).success,
    ).toBe(false)
    expect(
      publicRuntimeConfigSchema.safeParse({ ...publicConfig, openaiApiKey: 'must-not-ship' })
        .success,
    ).toBe(false)
  })
})
