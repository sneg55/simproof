import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { describe, expect, it, vi } from 'vitest'

import { parseEnvironment, toPublicRuntimeConfig } from '../config/environment.js'
import {
  createProductionGenerationOption,
  type ProductionGenerationDependencies,
} from './production-composition.js'

const base = {
  NODE_ENV: 'production',
  SIMPROOF_DEPLOYMENT_MODE: 'loopback',
  SIMPROOF_DATABASE_PATH: '/var/lib/simproof/metadata.sqlite',
  SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/artifacts',
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
  SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
  SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:8080',
}
const runner = {
  SIMPROOF_RUNNER_ENDPOINT: 'http://runner-launcher:4318',
  SIMPROOF_RUNNER_TOKEN: 'runner-token-that-is-at-least-thirty-two-characters',
  SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
  SIMPROOF_RUNNER_VERSION: '1.0.0',
}
const providers = {
  OPENAI_API_KEY: 'openai-server-only-secret-value',
  CODEX_API_KEY: 'codex-server-only-secret-value',
  SIMPROOF_OPENAI_MODEL: 'gpt-5.2',
  SIMPROOF_CODEX_MODEL: 'gpt-5.2-codex',
  SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION: '1000000',
  SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-codex/workspaces',
  SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-codex/state',
}
const capability = JSON.stringify({
  status: 'ready',
  protocolVersion: '1',
  image: runner.SIMPROOF_RUNNER_IMAGE,
})

describe('production generation composition', () => {
  it('keeps seed-only runner configuration launcher-ready without exposing generation', async () => {
    const config = parseEnvironment({ ...base, ...runner })
    expect(config.runner).toBeDefined()
    expect(config.generation).toBeUndefined()
    expect(toPublicRuntimeConfig(config).providerConfigured).toBe(false)
    const transport = vi.fn().mockResolvedValue({ status: 200, body: capability })
    const option = createProductionGenerationOption(config, { runnerTransport: transport })
    expect(option).toBeDefined()
    await expect(option?.runnerReadiness()).resolves.toEqual({ ok: true })
    const runtime = option?.create({
      database: {} as never,
      artifacts: {} as never,
      observability: {} as never,
      recordPromptDecision: vi.fn(),
    })
    expect(runtime).toBeDefined()
    await expect(runtime?.start({} as never, 'session')).resolves.toMatchObject({
      ok: false,
      error: { code: 'operation-failed' },
    })
    await runtime?.close()
  })

  it('constructs live adapters only from the complete bounded capability', async () => {
    const provider = createScriptedFakeProvider(fakeProviderScenarios.correct)
    const createConceptCompiler = vi.fn<
      NonNullable<ProductionGenerationDependencies['createConceptCompiler']>
    >(() => provider)
    const createCodeGenerator = vi.fn<
      NonNullable<ProductionGenerationDependencies['createCodeGenerator']>
    >(() => provider)
    const transport = vi.fn().mockResolvedValue({ status: 200, body: capability })
    const option = createProductionGenerationOption(
      parseEnvironment({ ...base, ...runner, ...providers }),
      { createConceptCompiler, createCodeGenerator, runnerTransport: transport },
    )
    expect(option).toBeDefined()
    expect(createConceptCompiler).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: providers.OPENAI_API_KEY,
        model: providers.SIMPROOF_OPENAI_MODEL,
        compileReservation: {
          inputTokens: 12_000,
          outputTokens: 3_000,
          requestCount: 1,
          costMicrousd: 15_000,
        },
      }),
    )
    expect(createCodeGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: providers.CODEX_API_KEY,
        model: providers.SIMPROOF_CODEX_MODEL,
        workspaceRoot: providers.SIMPROOF_CODEX_WORKSPACE_ROOT,
        stateRoot: providers.SIMPROOF_CODEX_STATE_ROOT,
        environment: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
        },
        forbiddenWorkspaceRoots: expect.arrayContaining([
          base.SIMPROOF_DATABASE_PATH,
          base.SIMPROOF_ARTIFACT_ROOT,
          providers.SIMPROOF_CODEX_STATE_ROOT,
        ]),
        forbiddenStateRoots: expect.arrayContaining([
          base.SIMPROOF_DATABASE_PATH,
          base.SIMPROOF_ARTIFACT_ROOT,
          providers.SIMPROOF_CODEX_WORKSPACE_ROOT,
        ]),
        generateReservation: {
          inputTokens: 32_000,
          outputTokens: 8_000,
          requestCount: 1,
          costMicrousd: 40_000,
        },
      }),
    )
    const codeConfig = createCodeGenerator.mock.calls[0]?.[0]
    expect(JSON.stringify(codeConfig?.environment)).not.toMatch(
      /server-only-secret|metadata\.sqlite|artifacts/u,
    )
    await expect(option?.runnerReadiness()).resolves.toEqual({ ok: true })
  })

  it('has no production fake-provider environment switch', () => {
    expect(() =>
      parseEnvironment({ ...base, ...runner, ...providers, SIMPROOF_PROVIDER_MODE: 'fake' }),
    ).toThrowError(/SIMPROOF_PROVIDER_MODE/u)
  })
})
