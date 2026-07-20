import { describe, expect, it } from 'vitest'

import { ConfigurationError, parseEnvironment, toPublicRuntimeConfig } from './environment.js'

const production = {
  NODE_ENV: 'production',
  SIMPROOF_DEPLOYMENT_MODE: 'network',
  SIMPROOF_DATABASE_PATH: '/var/lib/simproof/metadata.sqlite',
  SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/artifacts',
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
  SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
  SIMPROOF_ALLOWED_ORIGINS: 'https://simproof.example.edu',
} as const

const generation = {
  OPENAI_API_KEY: 'openai-server-only-secret-value',
  CODEX_API_KEY: 'codex-server-only-secret-value',
  SIMPROOF_RUNNER_ENDPOINT: 'http://runner-launcher:4318',
  SIMPROOF_RUNNER_TOKEN: 'runner-server-only-secret-value-that-is-long-enough',
  SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
  SIMPROOF_RUNNER_VERSION: '1.0.0',
  SIMPROOF_OPENAI_MODEL: 'gpt-5.2',
  SIMPROOF_CODEX_MODEL: 'gpt-5.2-codex',
  SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-codex/workspaces',
  SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/state',
} as const

describe('production launcher and server environment', () => {
  it('parses bounded production configuration with telemetry exports off by default', () => {
    const config = parseEnvironment({
      ...production,
      ...generation,
      SIMPROOF_SESSION_TTL_SECONDS: '28800',
      SIMPROOF_SESSION_IDLE_SECONDS: '3600',
      SIMPROOF_MAX_REQUEST_BYTES: '65536',
      SIMPROOF_MAX_PROMPT_CHARACTERS: '16384',
    })
    expect(config.privacy).toMatchObject({
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    })
    expect(config.allowedOrigins).toEqual(['https://simproof.example.edu'])
    expect(config.session).toMatchObject({ ttlSeconds: 28_800, idleSeconds: 3_600 })
    expect(config.request).toEqual({ maxBytes: 65_536, maxPromptCharacters: 16_384 })
    expect(config.runner).toMatchObject({
      endpoint: 'http://runner-launcher:4318',
      image: generation.SIMPROOF_RUNNER_IMAGE,
    })
    expect(config.observability).toEqual({
      diagnosticLogRoot: '/var/lib/simproof/diagnostics',
      maxFileBytes: 8_388_608,
      retainedFiles: 3,
    })
  })

  it('accepts only the exact production loopback HTTP origin exception', () => {
    expect(
      parseEnvironment({
        ...production,
        SIMPROOF_DEPLOYMENT_MODE: 'loopback',
        SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:8080',
        SIMPROOF_LISTEN_HOST: '0.0.0.0',
        SIMPROOF_PORT: '3001',
      }).server,
    ).toEqual({ host: '0.0.0.0', port: 3_001 })
    for (const origin of [
      'http://localhost:8080',
      'http://simproof.example.edu:8080',
      'http://127.0.0.1',
    ]) {
      expect(() =>
        parseEnvironment({
          ...production,
          SIMPROOF_DEPLOYMENT_MODE: 'loopback',
          SIMPROOF_ALLOWED_ORIGINS: origin,
        }),
      ).toThrowError(/SIMPROOF_ALLOWED_ORIGINS/u)
    }
    expect(() =>
      parseEnvironment({ ...production, SIMPROOF_LISTEN_HOST: '192.0.2.10' }),
    ).toThrowError(/SIMPROOF_LISTEN_HOST/u)
  })

  it('fails closed unless providers and the authenticated runner form one complete capability', () => {
    expect(toPublicRuntimeConfig(parseEnvironment(production)).providerConfigured).toBe(false)
    const fields = Object.keys(generation)
    for (const missing of fields) {
      const partial = Object.fromEntries(
        Object.entries({ ...production, ...generation }).filter(([field]) => field !== missing),
      )
      expect(() => parseEnvironment(partial)).toThrow(ConfigurationError)
    }
    expect(toPublicRuntimeConfig(parseEnvironment({ ...production, ...generation }))).toMatchObject(
      { providerConfigured: true },
    )
    expect(() =>
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_RUNNER_IMAGE: 'simproof-runner:latest',
      }),
    ).toThrowError(/SIMPROOF_RUNNER_IMAGE/u)
    expect(() =>
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_RUNNER_IMAGE: `simproof-runner@sha256:${'a'.repeat(64)}`,
      }),
    ).toThrowError(/SIMPROOF_RUNNER_IMAGE/u)
  })

  it('rejects runner token exfiltration endpoints, unsafe Codex roots, and pricing beyond the run budget', () => {
    for (const endpoint of [
      'https://public.example/runner',
      'http://127.0.0.1:4318',
      'http://runner-launcher:4318/path',
      'http://user:password@runner-launcher:4318',
      'unix:///run/simproof/launcher.sock',
    ]) {
      expect(() =>
        parseEnvironment({ ...production, ...generation, SIMPROOF_RUNNER_ENDPOINT: endpoint }),
      ).toThrowError(/SIMPROOF_RUNNER_ENDPOINT/u)
    }
    expect(() =>
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_CODEX_WORKSPACE_ROOT: '/var/lib/simproof/artifacts/codex',
      }),
    ).toThrowError(/SIMPROOF_CODEX_WORKSPACE_ROOT/u)
    expect(() =>
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION: '100000000',
      }),
    ).toThrowError(/SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION/u)
  })

  it.each([
    {
      name: 'workspace contains application data',
      workspace: '/var/lib',
      state: '/tmp/simproof-codex/state',
      field: 'SIMPROOF_CODEX_WORKSPACE_ROOT',
    },
    {
      name: 'application data contains workspace',
      workspace: '/var/lib/simproof/artifacts/codex',
      state: '/tmp/simproof-codex/state',
      field: 'SIMPROOF_CODEX_WORKSPACE_ROOT',
    },
    {
      name: 'state contains application data',
      workspace: '/tmp/simproof-codex/workspaces',
      state: '/var/lib',
      field: 'SIMPROOF_CODEX_STATE_ROOT',
    },
    {
      name: 'workspace contains state',
      workspace: '/tmp/simproof-codex',
      state: '/tmp/simproof-codex/state',
      field: 'SIMPROOF_CODEX_STATE_ROOT',
    },
    {
      name: 'state contains workspace',
      workspace: '/tmp/simproof-codex/workspaces',
      state: '/tmp/simproof-codex',
      field: 'SIMPROOF_CODEX_STATE_ROOT',
    },
  ])('rejects Codex root overlap when $name', ({ workspace, state, field }) => {
    try {
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_CODEX_WORKSPACE_ROOT: workspace,
        SIMPROOF_CODEX_STATE_ROOT: state,
      })
      throw new Error('Expected overlapping roots to be rejected.')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect((error as ConfigurationError).fields).toContain(field)
    }
  })

  it('accepts segment-distinct Codex root siblings', () => {
    expect(
      parseEnvironment({
        ...production,
        ...generation,
        SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-codex/work',
        SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/work-state',
      }).generation,
    ).toMatchObject({
      codexWorkspaceRoot: '/tmp/simproof-codex/work',
      codexStateRoot: '/tmp/simproof-codex/work-state',
    })
  })

  it('projects an allowlisted browser config with no provider, bootstrap, or session secrets', () => {
    const config = parseEnvironment({
      ...production,
      ...generation,
    })
    const publicConfig = toPublicRuntimeConfig(config)
    const serialized = JSON.stringify(publicConfig)
    expect(publicConfig).toMatchObject({ deploymentMode: 'network', providerConfigured: true })
    expect(serialized).not.toMatch(/openai|codex|bootstrap|session-secret|api.?key/iu)
    expect(serialized).not.toContain('server-only-secret-value')
  })
})
