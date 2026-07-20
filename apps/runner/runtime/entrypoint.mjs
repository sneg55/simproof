import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const MAX_INPUT_BYTES = 4_194_304
const outputLimit = Number.parseInt(process.env.RUNNER_MAX_OUTPUT_BYTES ?? '', 10)

function hash(source) {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`
}

function diagnostic(errorId, message) {
  return [{ severity: 'error', code: errorId, message }]
}

function failure(request, observedArtifactHash, classification, errorId, message) {
  return {
    protocolVersion: '1',
    requestId: request.requestId,
    domain: request.domain,
    observedArtifactHash,
    exit: { classification, errorId },
    samples: [],
    diagnostics: diagnostic(errorId, message),
  }
}

async function readInput() {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    total += chunk.byteLength
    if (total > MAX_INPUT_BYTES) throw new TypeError('Runner input exceeds its fixed cap.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function finiteJson(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => finiteJson(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((item) => finiteJson(item, seen))
  seen.delete(value)
  return valid
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const item of Object.values(value)) deepFreeze(item)
  return Object.freeze(value)
}

function normalizeObservation(domain, input, output) {
  if (
    !finiteJson(output) ||
    output === null ||
    Array.isArray(output) ||
    typeof output !== 'object'
  ) {
    throw new TypeError('Simulation sample must return a finite JSON object.')
  }
  if (domain === 'projectile') return { ...output, input }
  if (domain === 'pendulum') return { ...output, input }
  throw new TypeError('Unsupported runner domain.')
}

async function execute(request, observedArtifactHash, workspace) {
  const artifactPath = `${workspace}/core.mjs`
  await writeFile(artifactPath, request.artifact.content, { encoding: 'utf8', flag: 'wx' })
  let module
  try {
    module = await import(`${pathToFileURL(artifactPath).href}?request=${request.requestId}`)
  } catch {
    return failure(
      request,
      observedArtifactHash,
      'invalid-artifact',
      'runner.artifact.syntax',
      'Artifact could not be loaded.',
    )
  }
  const core = module.default
  if (core?.protocolVersion !== '1' || typeof core.sample !== 'function') {
    return failure(
      request,
      observedArtifactHash,
      'invalid-artifact',
      'runner.artifact.invalid-entrypoint',
      'Artifact does not export the SimulationCore entrypoint.',
    )
  }
  const samples = []
  for (const item of request.inputs) {
    const trustedInput = structuredClone(item.input)
    let first
    let second
    try {
      first = normalizeObservation(
        request.domain,
        trustedInput,
        await core.sample(deepFreeze(structuredClone(trustedInput))),
      )
      second = normalizeObservation(
        request.domain,
        trustedInput,
        await core.sample(deepFreeze(structuredClone(trustedInput))),
      )
    } catch {
      return failure(
        request,
        observedArtifactHash,
        'runtime-error',
        'runner.runtime.crash',
        'Simulation sample failed.',
      )
    }
    if (canonical(first) !== canonical(second)) {
      return failure(
        request,
        observedArtifactHash,
        'runtime-error',
        'runner.runtime.nondeterministic-output',
        'Simulation sample was not deterministic.',
      )
    }
    samples.push({ sampleId: item.sampleId, observation: first })
  }
  return {
    protocolVersion: '1',
    requestId: request.requestId,
    domain: request.domain,
    observedArtifactHash,
    exit: { classification: 'success', errorId: null },
    samples,
    diagnostics: [],
  }
}

async function main() {
  const request = await readInput()
  const observedArtifactHash = hash(request.artifact.content)
  if (observedArtifactHash !== request.artifact.hash) {
    return failure(
      request,
      observedArtifactHash,
      'invalid-artifact',
      'runner.artifact.hash-mismatch',
      'Artifact hash did not match its content.',
    )
  }
  const workspace = `/work/request-${request.requestId}`
  await mkdir(workspace, { mode: 0o700 })
  try {
    return await execute(request, observedArtifactHash, workspace)
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}

const response = await main()
const serialized = JSON.stringify(response)
if (
  !Number.isSafeInteger(outputLimit) ||
  outputLimit < 1 ||
  Buffer.byteLength(serialized) > outputLimit
) {
  process.exitCode = 70
} else {
  process.stdout.write(serialized)
}
