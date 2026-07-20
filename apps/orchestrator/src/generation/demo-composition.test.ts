import { describe, expect, it } from 'vitest'

import { parseEnvironment } from '../config/environment.js'
import { createDemoGenerationOption } from './demo-composition.js'

const base = {
  NODE_ENV: 'test',
  SIMPROOF_DATABASE_PATH: '/tmp/simproof-demo/metadata.sqlite',
  SIMPROOF_ARTIFACT_ROOT: '/tmp/simproof-demo/artifacts',
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
  SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
} as const

const realProvider = {
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
  SIMPROOF_CODEX_WORKSPACE_ROOT: '/tmp/simproof-demo-codex/workspaces',
  SIMPROOF_CODEX_STATE_ROOT: '/tmp/simproof-demo-codex/state',
} as const

describe('demo generation fence', () => {
  it('activates only when demo is explicitly requested with no real provider', () => {
    expect(parseEnvironment({ ...base, SIMPROOF_DEMO_GENERATION: 'true' }).demoGeneration).toBe(
      true,
    )
  })

  it('stays off when demo is not requested', () => {
    expect(parseEnvironment(base).demoGeneration).toBe(false)
  })

  it('never activates when a real provider is configured, even if requested', () => {
    const config = parseEnvironment({ ...base, ...realProvider, SIMPROOF_DEMO_GENERATION: 'true' })
    expect(config.generation).toBeDefined()
    expect(config.demoGeneration).toBe(false)
  })

  it('never activates in production, even when requested with no real provider', () => {
    const config = parseEnvironment({
      NODE_ENV: 'production',
      SIMPROOF_DEPLOYMENT_MODE: 'network',
      SIMPROOF_DATABASE_PATH: '/var/lib/simproof/metadata.sqlite',
      SIMPROOF_ARTIFACT_ROOT: '/var/lib/simproof/artifacts',
      SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
      SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
      SIMPROOF_ALLOWED_ORIGINS: 'https://simproof.example.edu',
      SIMPROOF_DEMO_GENERATION: 'true',
    })
    expect(config.demoGeneration).toBe(false)
  })
})

describe('createDemoGenerationOption', () => {
  it('provides a ready, credential-free generation option', async () => {
    const option = createDemoGenerationOption()
    expect(await option.runnerReadiness()).toEqual({ ok: true })
    expect(typeof option.create).toBe('function')
    expect(typeof option.resolveInstalledEvidence).toBe('function')
  })
})
