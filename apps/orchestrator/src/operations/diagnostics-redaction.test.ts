import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDiagnosticBundle, diagnosticBundleSchema } from './diagnostics-bundle.js'

const BUNDLE_ID = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
const RUN_ID = '099f6bc1-0811-70c1-a139-938a3ad2dee0'
const NOW = '2026-07-17T12:00:00.000Z'

interface SensitiveFixture {
  readonly apiKey: string
  readonly accessToken: string
  readonly password: string
  readonly cookie: string
  readonly prompt: string
  readonly generatedContent: string
  readonly providerResponse: string
  readonly reasoning: string
  readonly databasePath: string
  readonly artifactPath: string
}

async function fixture(): Promise<SensitiveFixture> {
  const path = resolve(process.cwd(), '../../tests/fixtures/security/diagnostic-redaction.json')
  return JSON.parse(await readFile(path, 'utf8')) as SensitiveFixture
}

const versions = {
  simproof: '0.0.0',
  orchestrator: '0.0.0',
  observability: '0.0.0',
  persistence: '0.0.0',
  runner: '0.0.0',
  verifier: '0.0.0',
  node: '24.15.0',
  runnerProtocol: '1' as const,
  databaseSchema: 5,
}

describe('diagnostic bundle redaction boundary', () => {
  it('property-builds an allowlisted bundle with no sensitive environment or log values', async () => {
    const sensitive = await fixture()
    const bundle = createDiagnosticBundle({
      bundleId: BUNDLE_ID,
      createdAt: NOW,
      versions,
      configurationValid: true,
      environment: {
        SIMPROOF_DATABASE_PATH: sensitive.databasePath,
        SIMPROOF_ARTIFACT_ROOT: sensitive.artifactPath,
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: sensitive.password,
        SIMPROOF_SESSION_SECRET: sensitive.accessToken,
        OPENAI_API_KEY: sensitive.apiKey,
        SIMPROOF_ALLOWED_ORIGINS: 'https://private-origin.invalid',
        SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES: '1048576',
        SIMPROOF_DIAGNOSTIC_LOG_FILES: '4',
        SIMPROOF_UNKNOWN_VALUE: sensitive.reasoning,
      },
      migration: {
        status: 'current',
        expectedVersion: 5,
        appliedVersions: [1, 2, 3, 4, 5],
        checksumValid: true,
      },
      readiness: { status: 'ready' },
      recentStableErrors: [
        { stableErrorId: 'provider.transient-failure', count: 2, lastObservedAt: NOW },
        { stableErrorId: sensitive.providerResponse, count: 7, lastObservedAt: NOW },
      ],
      recentLogs: [
        {
          schemaVersion: '1',
          occurredAt: NOW,
          severity: 'error',
          component: 'provider',
          event: 'provider.call.completed',
          errorId: 'provider.transient-failure',
          correlation: { runId: RUN_ID },
          attributes: { operation: 'code-generate', retryable: true },
        },
        {
          schemaVersion: '1',
          occurredAt: NOW,
          severity: 'error',
          component: 'provider',
          event: 'provider.raw-error',
          message: `${sensitive.prompt} ${sensitive.generatedContent}`,
          cause: `${sensitive.providerResponse} ${sensitive.reasoning}`,
        },
      ],
      includeLogs: true,
      maxLogEvents: 20,
      sensitiveValues: {
        apiKeys: [sensitive.apiKey],
        accessTokens: [sensitive.accessToken],
        passwords: [sensitive.password],
        cookies: [sensitive.cookie],
        prompts: [sensitive.prompt, sensitive.providerResponse, sensitive.reasoning],
        generatedContent: [sensitive.generatedContent],
      },
    })

    expect(diagnosticBundleSchema.parse(bundle)).toEqual(bundle)
    expect(bundle.stableErrors).toMatchObject({ unregisteredCount: 7 })
    expect(bundle.logs?.events).toHaveLength(1)
    expect(bundle.configuration.presence).toMatchObject({
      databasePathConfigured: true,
      artifactRootConfigured: true,
      adminBootstrapSecretPresent: true,
      sessionSecretPresent: true,
      openaiCredentialPresent: true,
      diagnosticLogMaxBytesConfigured: true,
      diagnosticLogFilesConfigured: true,
      unknownSimproofKeyPresent: true,
    })
    const serialized = JSON.stringify(bundle)
    for (const value of Object.values(sensitive)) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('private-origin.invalid')
    expect(serialized).not.toMatch(/SIMPROOF_(?:DATABASE|ARTIFACT|SESSION|ADMIN)/u)
  })

  it('excludes all log data unless the operator explicitly includes the logs category', () => {
    const bundle = createDiagnosticBundle({
      bundleId: BUNDLE_ID,
      createdAt: NOW,
      versions,
      configurationValid: false,
      environment: {},
      migration: {
        status: 'unavailable',
        expectedVersion: 5,
        appliedVersions: [],
        checksumValid: null,
      },
      readiness: { status: 'not-ready', errorId: 'database.unavailable' },
      recentStableErrors: [],
      recentLogs: [
        {
          schemaVersion: '1',
          occurredAt: NOW,
          severity: 'info',
          component: 'diagnostics',
          event: 'diagnostics.bundle-created',
        },
      ],
      includeLogs: false,
      maxLogEvents: 20,
    })
    expect(bundle).not.toHaveProperty('logs')
  })
})
