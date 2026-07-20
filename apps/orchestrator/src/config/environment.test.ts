import { MIN_REQUEST_BODY_BYTES } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { ConfigurationError, parseEnvironment } from './environment.js'

const production = {
  NODE_ENV: 'production',
  SIMPROOF_DEPLOYMENT_MODE: 'network',
  SIMPROOF_DATABASE_PATH: '/var/lib/simproof/metadata.sqlite',
  SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/artifacts',
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
  SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
  SIMPROOF_ALLOWED_ORIGINS: 'https://simproof.example.edu',
} as const

describe('central server environment boundary', () => {
  it('accepts local auth bypass only in a closed loopback test configuration', () => {
    const localTest = {
      NODE_ENV: 'test',
      SIMPROOF_DEPLOYMENT_MODE: 'loopback',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: production.SIMPROOF_ADMIN_BOOTSTRAP_SECRET,
      SIMPROOF_SESSION_SECRET: production.SIMPROOF_SESSION_SECRET,
      SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      SIMPROOF_LOCAL_AUTH_BYPASS: 'true',
    } as const

    expect(parseEnvironment(localTest).localAuthBypass).toBe(true)
    for (const unsafe of [
      { ...localTest, NODE_ENV: 'production' },
      {
        ...localTest,
        SIMPROOF_DEPLOYMENT_MODE: 'network',
        SIMPROOF_ALLOWED_ORIGINS: 'https://simproof.example.edu',
      },
      { ...localTest, SIMPROOF_ALLOWED_ORIGINS: 'http://localhost:4173' },
      { ...localTest, SIMPROOF_TRUSTED_PROXY_ADDRESS: '127.0.0.2' },
      {
        ...localTest,
        SIMPROOF_TELEMETRY_ENABLED: 'true',
        SIMPROOF_TELEMETRY_ENDPOINT: 'https://telemetry.example.edu/intake',
      },
    ]) {
      expect(() => parseEnvironment(unsafe)).toThrowError(/SIMPROOF_LOCAL_AUTH_BYPASS/u)
    }
  })

  it('fails closed with field-specific production errors that never echo secret values', () => {
    const exposed = 'short-and-sensitive'
    expect.assertions(5)
    try {
      parseEnvironment({
        NODE_ENV: 'production',
        SIMPROOF_DEPLOYMENT_MODE: 'network',
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: exposed,
        SIMPROOF_SESSION_SECRET: exposed,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error).toMatchObject({
        fields: expect.arrayContaining([
          'SIMPROOF_DATABASE_PATH',
          'SIMPROOF_ARTIFACT_ROOT',
          'SIMPROOF_ADMIN_BOOTSTRAP_SECRET',
          'SIMPROOF_ALLOWED_ORIGINS',
        ]),
      })
      expect(String(error)).not.toContain(exposed)
      expect(String(error)).toContain('SIMPROOF_ADMIN_BOOTSTRAP_SECRET')
      expect(String(error)).not.toContain('/var/lib')
    }
  })

  it('accepts only an absolute bounded local diagnostic log configuration', () => {
    expect(
      parseEnvironment({
        ...production,
        SIMPROOF_DIAGNOSTIC_LOG_ROOT: '/srv/simproof/diagnostics',
        SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES: '1048576',
        SIMPROOF_DIAGNOSTIC_LOG_FILES: '2',
      }).observability,
    ).toEqual({
      diagnosticLogRoot: '/srv/simproof/diagnostics',
      maxFileBytes: 1_048_576,
      retainedFiles: 2,
    })
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_DIAGNOSTIC_LOG_ROOT: './diagnostics' }),
    ).toThrowError(/SIMPROOF_DIAGNOSTIC_LOG_ROOT/u)
  })

  it('rejects effective default diagnostic roots that collide with either storage location', () => {
    expect(() =>
      parseEnvironment({
        ...production,
        SIMPROOF_DATABASE_PATH: '/var/lib/simproof/diagnostics',
      }),
    ).toThrowError(/SIMPROOF_DIAGNOSTIC_LOG_ROOT/u)
    expect(() =>
      parseEnvironment({
        ...production,
        SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/diagnostics',
      }),
    ).toThrowError(/SIMPROOF_DIAGNOSTIC_LOG_ROOT/u)
  })

  it.each([
    {
      name: 'diagnostics equal to the database path',
      databasePath: '/var/lib/simproof/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/metadata.sqlite',
    },
    {
      name: 'diagnostics equal to the artifact root',
      databasePath: '/var/lib/simproof/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/artifacts',
    },
    {
      name: 'diagnostics nested beneath the database path',
      databasePath: '/var/lib/simproof/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/metadata.sqlite/logs',
    },
    {
      name: 'database path nested beneath diagnostics',
      databasePath: '/var/lib/simproof/diagnostics/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/diagnostics',
    },
    {
      name: 'diagnostics nested beneath the artifact root',
      databasePath: '/var/lib/simproof/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/artifacts/logs',
    },
    {
      name: 'artifact root nested beneath diagnostics',
      databasePath: '/var/lib/simproof/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/storage/artifacts',
      diagnosticLogRoot: '/var/lib/simproof/storage',
    },
  ])('rejects $name after resolving effective paths', (input) => {
    expect(() =>
      parseEnvironment({
        ...production,
        SIMPROOF_DATABASE_PATH: input.databasePath,
        SIMPROOF_ARTIFACT_ROOT: input.artifactRoot,
        SIMPROOF_DIAGNOSTIC_LOG_ROOT: input.diagnosticLogRoot,
      }),
    ).toThrowError(/SIMPROOF_DIAGNOSTIC_LOG_ROOT/u)
  })

  it.each([
    {
      name: 'database and artifact paths are equal',
      databasePath: '/var/lib/simproof/storage',
      artifactRoot: '/var/lib/simproof/storage',
    },
    {
      name: 'artifact root is an ancestor of the database path',
      databasePath: '/var/lib/simproof/storage/metadata.sqlite',
      artifactRoot: '/var/lib/simproof/storage',
    },
    {
      name: 'database path is an ancestor of the artifact root',
      databasePath: '/var/lib/simproof/storage',
      artifactRoot: '/var/lib/simproof/storage/artifacts',
    },
  ])('rejects storage overlap when $name', (input) => {
    expect.assertions(2)
    try {
      parseEnvironment({
        ...production,
        SIMPROOF_DATABASE_PATH: input.databasePath,
        SIMPROOF_ARTIFACT_ROOT: input.artifactRoot,
        SIMPROOF_DIAGNOSTIC_LOG_ROOT: '/var/log/simproof',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error).toMatchObject({ fields: ['SIMPROOF_ARTIFACT_ROOT'] })
    }
  })

  it('accepts segment-distinct sibling prefixes and returns resolved storage paths', () => {
    const config = parseEnvironment({
      ...production,
      SIMPROOF_DATABASE_PATH: '/var/lib/simproof/instance/../metadata.sqlite',
      SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/data-artifacts',
      SIMPROOF_DIAGNOSTIC_LOG_ROOT: '/var/lib/simproof/data-logs',
    })
    expect(config.databasePath).toBe('/var/lib/simproof/metadata.sqlite')
    expect(config.artifactRoot).toBe('/var/lib/simproof/data-artifacts')
    expect(config.observability.diagnosticLogRoot).toBe('/var/lib/simproof/data-logs')
  })

  it('matches the bootstrap API secret boundary exactly', () => {
    const maximum = '0123456789abcdef'.repeat(64)
    expect(maximum).toHaveLength(1_024)
    expect(
      parseEnvironment({ ...production, SIMPROOF_ADMIN_BOOTSTRAP_SECRET: maximum })
        .adminBootstrapSecret,
    ).toBe(maximum)
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_ADMIN_BOOTSTRAP_SECRET: `${maximum}x` }),
    ).toThrowError(/SIMPROOF_ADMIN_BOOTSTRAP_SECRET/u)
  })

  it('rejects a request-body limit below the accepted authentication envelope', () => {
    expect(
      parseEnvironment({
        ...production,
        SIMPROOF_MAX_REQUEST_BYTES: String(MIN_REQUEST_BODY_BYTES),
      }).request.maxBytes,
    ).toBe(MIN_REQUEST_BODY_BYTES)
    expect(() =>
      parseEnvironment({
        ...production,
        SIMPROOF_MAX_REQUEST_BYTES: String(MIN_REQUEST_BODY_BYTES - 1),
      }),
    ).toThrowError(/SIMPROOF_MAX_REQUEST_BYTES/u)
  })

  it('rejects unsafe origins, misspelled SimProof variables, and out-of-range bounds', () => {
    for (const environment of [
      { ...production, SIMPROOF_ALLOWED_ORIGINS: '*' },
      { ...production, SIMPROOF_ALLOWED_ORIGINS: 'http://simproof.example.edu' },
      { ...production, SIMPROOF_MAX_REQUEST_BYTES: '99999999' },
      { ...production, SIMPROOF_TELEMTRY_ENABLED: 'true' },
    ]) {
      expect(() => parseEnvironment(environment)).toThrow(ConfigurationError)
    }
  })

  it('requires explicit external-diagnostics configuration only when opted in', () => {
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED: 'true' }),
    ).toThrowError(/SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT/u)
    expect(
      parseEnvironment({
        ...production,
        SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED: 'true',
        SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT: 'https://diagnostics.example.edu/intake',
        SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN: 'diagnostics-secret-at-least-32-characters',
      }).privacy.externalDiagnosticsEnabled,
    ).toBe(true)
  })

  it('requires explicit telemetry destination and accepts only one exact trusted proxy address', () => {
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_TELEMETRY_ENABLED: 'true' }),
    ).toThrowError(/SIMPROOF_TELEMETRY_ENDPOINT/u)
    expect(
      parseEnvironment({
        ...production,
        SIMPROOF_TELEMETRY_ENABLED: 'true',
        SIMPROOF_TELEMETRY_ENDPOINT: 'https://telemetry.example.edu/intake',
        SIMPROOF_TRUSTED_PROXY_ADDRESS: '10.20.30.40',
      }),
    ).toMatchObject({
      trustedProxyAddress: '10.20.30.40',
      privacy: { telemetryEnabled: true },
    })
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_TRUSTED_PROXY_ADDRESS: '0.0.0.0/0' }),
    ).toThrowError(/SIMPROOF_TRUSTED_PROXY_ADDRESS/u)
  })
})
