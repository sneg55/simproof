import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { importRuntimePackage } from './runtime-import.mjs'

export async function deploymentCheck(config, injected = {}) {
  const persistence = injected.persistence ?? (await importRuntimePackage('@simproof/persistence'))
  const readiness = injected.readiness ?? (await import('../dist/operations/readiness.js'))
  const database = persistence.createPersistence(config.databasePath)
  const artifacts = new persistence.ArtifactStore(config.artifactRoot)
  try {
    await access(dirname(config.databasePath), constants.R_OK | constants.W_OK)
    await access(config.observability.diagnosticLogRoot, constants.R_OK | constants.W_OK)
    const configuration = readiness.probeConfiguration(config).ok
    const databaseReady = readiness.probeDatabase(database).ok
    const artifactReady = (await readiness.probeArtifactStore(artifacts)).ok
    const runnerReady = await probeRunner(config.runner, injected.fetch ?? fetch)
    const administratorConfigured = administratorPresent(config.databasePath)
    const report = {
      configuration: configuration ? 'ready' : 'not-ready',
      database: databaseReady ? 'ready' : 'not-ready',
      artifacts: artifactReady ? 'ready' : 'not-ready',
      runner: runnerReady ? 'ready' : 'not-ready',
      administratorConfigured,
      providers: {
        openaiConfigured: config.providers.openaiApiKey !== undefined,
        codexConfigured: config.providers.codexApiKey !== undefined,
      },
    }
    return {
      ready: configuration && databaseReady && artifactReady && runnerReady,
      report,
    }
  } finally {
    database.close()
  }
}

function administratorPresent(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = database.prepare('SELECT COUNT(*) AS count FROM local_administrator').get()
    return Number(row?.count) === 1
  } finally {
    database.close()
  }
}

async function probeRunner(runner, request) {
  if (runner === undefined) return false
  try {
    const response = await request(new URL('/v1/capabilities', runner.endpoint), {
      method: 'GET',
      headers: { authorization: `Bearer ${runner.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
    })
    if (response.status !== 200) return false
    const body = await boundedJson(response, 1_024)
    return (
      body !== undefined &&
      Object.keys(body).sort().join(',') === 'image,protocolVersion,status' &&
      body.status === 'ready' &&
      body.protocolVersion === '1' &&
      body.image === runner.image
    )
  } catch {
    return false
  }
}

async function boundedJson(response, limit) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return undefined
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}
