import type { RunnerRequest, VerificationDependencyBinding } from '@simproof/contracts'
import { hashCanonicalJson } from '@simproof/verifier'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseEnvironment } from '../config/environment.js'
import { createProductionGenerationOption } from './production-composition.js'
import {
  cleanupReverificationRoots,
  reverifyRequest,
  runnerBinding,
  setupReverification,
  successfulResponse,
} from './reverification.test-support.js'

afterEach(cleanupReverificationRoots)

describe('production seed-mode reverification', () => {
  it('reverifies through the trusted runner without constructing or calling providers', async () => {
    const entries = [
      {
        id: 'trusted-verifier',
        version: '1.0.0',
        contentHash: hashCanonicalJson({
          implementation: 'simproof-verifier',
          version: '1.0.0',
          runnerVersion: runnerBinding.version,
        }),
      },
    ]
    const productionDependencies: VerificationDependencyBinding = {
      schemaVersion: '1',
      entries,
      contentHash: hashCanonicalJson(entries),
    }
    const priorEntries = [
      {
        id: 'trusted-verifier',
        version: '0.9.0',
        contentHash: hashCanonicalJson({
          implementation: 'simproof-verifier',
          version: '0.9.0',
          runnerVersion: runnerBinding.version,
        }),
      },
    ]
    const priorDependencies: VerificationDependencyBinding = {
      schemaVersion: '1',
      entries: priorEntries,
      contentHash: hashCanonicalJson(priorEntries),
    }
    const context = await setupReverification(productionDependencies, false, priorDependencies)
    const createConceptCompiler = vi.fn(() => {
      throw new TypeError('Seed reverification must not construct a concept provider.')
    })
    const createCodeGenerator = vi.fn(() => {
      throw new TypeError('Seed reverification must not construct a code provider.')
    })
    const transport = vi.fn((input: { readonly path: string; readonly body: string }) => {
      if (input.path === '/v1/capabilities')
        return Promise.resolve({
          status: 200,
          body: JSON.stringify({
            status: 'ready',
            protocolVersion: '1',
            image: `sha256:${'a'.repeat(64)}`,
          }),
        })
      const envelope = JSON.parse(input.body) as { request: RunnerRequest }
      return Promise.resolve({
        status: 200,
        body: JSON.stringify(successfulResponse(envelope.request)),
      })
    })
    const option = createProductionGenerationOption(
      parseEnvironment({
        NODE_ENV: 'production',
        SIMPROOF_DEPLOYMENT_MODE: 'loopback',
        SIMPROOF_DATABASE_PATH: context.database.path,
        SIMPROOF_ARTIFACT_ROOT: context.store.root,
        SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
        SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
        SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:8080',
        SIMPROOF_RUNNER_ENDPOINT: 'http://runner-launcher:4318',
        SIMPROOF_RUNNER_TOKEN: 'runner-token-that-is-at-least-thirty-two-characters',
        SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
        SIMPROOF_RUNNER_VERSION: runnerBinding.version,
      }),
      { runnerTransport: transport, createConceptCompiler, createCodeGenerator },
    )
    const runtime = option?.create({
      database: context.database,
      artifacts: context.store,
      observability: undefined as never,
      recordPromptDecision: vi.fn(),
    })
    if (runtime === undefined) throw new TypeError('Expected seed reverification runtime.')
    try {
      await expect(runtime.start({} as never, 'session')).resolves.toMatchObject({
        ok: false,
        error: { code: 'operation-failed' },
      })
      const accepted = await runtime.reverify(
        context.versionId,
        reverifyRequest(context.stale.revision, 'reverify:production:seed'),
        'session',
      )
      if (!accepted.ok) throw new TypeError('Expected production reverification acceptance.')
      let state = 'executing'
      for (let turn = 0; turn < 200 && state !== 'verified'; turn += 1) {
        const status = await runtime.status(accepted.value.runId, 'session')
        if (status.ok) state = status.value.state
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
      }
      expect(state).toBe('verified')
      expect(transport).toHaveBeenCalled()
      expect(createConceptCompiler).not.toHaveBeenCalled()
      expect(createCodeGenerator).not.toHaveBeenCalled()
      expect(context.providerCalls.compile).toHaveBeenCalledTimes(1)
      expect(context.providerCalls.generate).toHaveBeenCalledTimes(1)
    } finally {
      await runtime.close()
      context.database.close()
    }
  })
})
