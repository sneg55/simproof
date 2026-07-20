import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApplication } from '../application.js'
import { parseEnvironment } from '../config/environment.js'
import type { HttpRequest } from '../http/types.js'
import { createProductionGenerationOption } from './production-composition.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  )
})

const request = (path: string): HttpRequest => ({
  method: 'GET',
  path,
  headers: {},
  peerAddress: '127.0.0.1',
})

async function seedApplication(runnerReady: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-production-runner-'))
  roots.push(root)
  const config = parseEnvironment({
    NODE_ENV: 'production',
    SIMPROOF_DEPLOYMENT_MODE: 'loopback',
    SIMPROOF_DATABASE_PATH: join(root, 'metadata.sqlite'),
    SIMPROOF_ARTIFACT_ROOT: join(root, 'artifacts'),
    SIMPROOF_DIAGNOSTIC_LOG_ROOT: join(root, 'diagnostics'),
    SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'bootstrap-secret-that-is-at-least-32-bytes',
    SIMPROOF_SESSION_SECRET: 'session-secret-that-is-at-least-32-bytes-long',
    SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:8080',
    SIMPROOF_RUNNER_ENDPOINT: 'http://runner-launcher:4318',
    SIMPROOF_RUNNER_TOKEN: 'runner-token-that-is-at-least-thirty-two-characters',
    SIMPROOF_RUNNER_IMAGE: `sha256:${'a'.repeat(64)}`,
    SIMPROOF_RUNNER_VERSION: '1.0.0',
  })
  const runner = createProductionGenerationOption(config, {
    runnerTransport: vi.fn().mockResolvedValue(
      runnerReady
        ? {
            status: 200,
            body: JSON.stringify({
              status: 'ready',
              protocolVersion: '1',
              image: `sha256:${'a'.repeat(64)}`,
            }),
          }
        : { status: 503, body: '{"errorId":"launcher.unavailable"}' },
    ),
  })
  if (runner === undefined) throw new TypeError('Expected seed runner capability.')
  return createApplication(config, { educatorGeneration: runner })
}

describe('production seed application runner readiness', () => {
  it.each([
    [true, 200],
    [false, 503],
  ] as const)('maps launcher ready=%s without enabling providers', async (ready, status) => {
    const application = await seedApplication(ready)
    try {
      expect(application.config.generation).toBeUndefined()
      expect((await application.api.handle(request('/ready'))).status).toBe(status)
    } finally {
      await application.close()
    }
  })
})
