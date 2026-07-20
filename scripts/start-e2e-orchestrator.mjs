import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createOrchestratorApplication } from '../apps/orchestrator/dist/application.js'
import { createNodeHttpServer } from '../apps/orchestrator/dist/http/node-server.js'

const root = await mkdtemp(join(tmpdir(), 'simproof-browser-gate-'))
const application = createOrchestratorApplication({
  NODE_ENV: 'test',
  SIMPROOF_DEPLOYMENT_MODE: 'loopback',
  SIMPROOF_DATABASE_PATH: join(root, 'metadata.sqlite'),
  SIMPROOF_ARTIFACT_ROOT: join(root, 'artifacts'),
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET: 'browser-gate-bootstrap-secret-value',
  SIMPROOF_SESSION_SECRET: 'browser-gate-session-secret-value-that-is-long-enough',
  SIMPROOF_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
})
const server = createNodeHttpServer(application.api)
let closing
let finish
const stopped = new Promise((resolve) => {
  finish = resolve
})

async function close() {
  if (closing !== undefined) return await closing
  closing = (async () => {
    await new Promise((resolve) => server.close(resolve))
    server.closeIdleConnections()
    await application.close()
    await rm(root, { recursive: true, force: true })
    finish()
  })()
  return await closing
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(3000, '127.0.0.1', resolve)
})
await stopped
