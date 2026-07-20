import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { probeSocketGroup } from '../../../scripts/prepare-deployment.mjs'
import { providerAbsentProcessEnvironment } from './environment.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const smokeDriver = resolve(root, 'tests/deployment/runtime/full-stack-orchestrator.mjs')
const password = 'simproof-smoke-password'
const imageTags = {
  web: 'simproof-web:local',
  orchestrator: 'simproof-orchestrator:local',
  launcher: 'simproof-launcher:local',
  runner: 'simproof-runner:local',
} as const

interface SmokeContext {
  readonly project: string
  readonly envFile: string
  readonly generatedEnvFile: string
  readonly port: number
  readonly bootstrapSecret: string
  readonly imageIds: Record<keyof typeof imageTags, string>
  readonly initialRunnerContainers: readonly string[]
  activeOrchestrator: string | undefined
}

interface SimulationDetail {
  readonly simulation: { readonly id: string }
  readonly selectedVersion: {
    readonly summary: { readonly id: string; readonly revision: number; readonly state: string }
  }
}

interface GenerationStatus {
  readonly state: string
  readonly revision: number
  readonly conceptReview:
    | { readonly status: 'not-ready' }
    | {
        readonly status: 'pending' | 'accepted' | 'declined'
        readonly reviewRevision: number
        readonly conceptSpecHash: string
      }
  readonly attempts: readonly {
    readonly outcome: string
    readonly artifactHash: string | null
    readonly verificationRunId: string | null
  }[]
}

interface VerificationReport {
  readonly simulationVersionId: string
  readonly verificationRunId: string
  readonly versionRevision: number
  readonly report: { readonly verdict: string }
  readonly validity: { readonly status: string }
  readonly publication: { readonly published: boolean }
  readonly badgeActive: boolean
  readonly publishable: boolean
}

interface ApiSuccess<Value> {
  readonly ok: true
  readonly value: Value
}

let activeContext: SmokeContext | undefined

afterEach(async () => {
  if (activeContext !== undefined) await cleanup(activeContext)
  activeContext = undefined
})

describe('canonical production deployment smoke', () => {
  it('survives a restart after a real remote-runner generation and leaves no runtime residue', async () => {
    const context = await createContext()
    activeContext = context
    compose(context, ['run', '--rm', '--no-deps', 'orchestrator', 'migrate', '--confirm-stopped'])
    compose(context, ['up', '-d', '--wait', '--no-deps', 'runner-launcher'])
    compose(context, ['run', '--rm', '--no-deps', 'orchestrator', 'check'])
    startProductionOrchestrator(context)
    compose(context, ['up', '-d', '--no-deps', 'web'])

    const origin = `http://127.0.0.1:${context.port}`
    await waitForReady(`${origin}/readyz`)
    expectImages(context)

    const capability = await jsonRequest<{ readonly bootstrapAvailable: boolean }>(
      origin,
      '/api/bootstrap-capability',
    )
    expect(capability.value.bootstrapAvailable).toBe(true)
    await jsonRequest(origin, '/api/auth/bootstrap', {
      method: 'POST',
      body: { bootstrapSecret: context.bootstrapSecret, newPassword: password },
    })
    const session = await login(origin)
    const runtime = await jsonRequest<{
      readonly runtime: { readonly providerConfigured: boolean }
      readonly generation: { readonly available: boolean; readonly reason?: string }
      readonly seedLibraryReady: boolean
    }>(origin, '/api/runtime-config', { session })
    expect(runtime.value).toMatchObject({
      runtime: { providerConfigured: false },
      generation: { available: false, reason: 'provider-not-configured' },
      seedLibraryReady: true,
    })
    const seeds = await jsonRequest<readonly { readonly seedId: string }[]>(origin, '/api/seeds', {
      session,
    })
    const seedIds = seeds.value.map(({ seedId }) => seedId).sort()
    expect(seedIds).toEqual([
      'pendulum.amplitude-assumption',
      'pendulum.length-law',
      'pendulum.small-angle',
      'projectile.complementary-angles',
      'projectile.introduction',
      'projectile.maximum-range',
      'projectile.speed-scaling',
    ])
    for (const seedId of seedIds) {
      const detail = await jsonRequest<SimulationDetail>(origin, `/api/seeds/${seedId}`, {
        session,
      })
      expect(detail.value.simulation.id).toBeTypeOf('string')
    }
    const seedForReport = seedIds[0]
    if (seedForReport === undefined) throw new Error('Bundled seed report fixture is absent.')
    const seedReport = await jsonRequest<VerificationReport>(
      origin,
      `/api/seeds/${seedForReport}/report`,
      { session },
    )
    expect(seedReport.value).toMatchObject({
      report: { verdict: 'verified' },
      validity: { status: 'current' },
      badgeActive: true,
    })

    const created = await jsonRequest<SimulationDetail>(origin, '/api/simulations', {
      method: 'POST',
      session,
      body: { title: 'Deployment smoke pendulum' },
    })
    const simulationId = created.value.simulation.id
    const versionId = created.value.selectedVersion.summary.id
    const revision = created.value.selectedVersion.summary.revision
    await expectGenerationUnavailable(origin, versionId, revision, session)

    replaceProductionWithDriver(context)
    await waitForReady(`${origin}/readyz`)
    expectImages(context)
    const driverSession = await login(origin)
    const accepted = await jsonRequest<{ readonly runId: string }>(origin, '/api/generations', {
      method: 'POST',
      session: driverSession,
      body: generationRequest(versionId, revision),
    })
    const runId = accepted.value.runId
    const awaiting = await pollGeneration(origin, runId, driverSession, 'awaiting_confirmation')
    expect(awaiting.value.conceptReview.status).toBe('pending')
    if (awaiting.value.conceptReview.status !== 'pending') {
      throw new Error('Generation concept review was not pending.')
    }
    await jsonRequest(origin, `/api/generations/${runId}/concept-review`, {
      method: 'POST',
      session: driverSession,
      body: {
        expectedRunRevision: awaiting.value.revision,
        expectedReviewRevision: awaiting.value.conceptReview.reviewRevision,
        conceptSpecHash: awaiting.value.conceptReview.conceptSpecHash,
        decision: 'accept',
      },
    })
    const verified = await pollGeneration(origin, runId, driverSession, 'verified')
    expect(verified.value.attempts.at(-1)).toMatchObject({
      outcome: 'verified',
      artifactHash: expect.any(String),
      verificationRunId: expect.any(String),
    })

    const report = await jsonRequest<VerificationReport>(
      origin,
      `/api/versions/${versionId}/report`,
      { session: driverSession },
    )
    expect(report.value).toMatchObject({
      simulationVersionId: versionId,
      report: { verdict: 'verified' },
      validity: { status: 'current' },
      publication: { published: false },
      badgeActive: true,
      publishable: true,
    })
    await jsonRequest<SimulationDetail>(origin, `/api/versions/${versionId}/publish`, {
      method: 'POST',
      session: driverSession,
      body: {
        expectedRevision: report.value.versionRevision,
        verificationRunId: report.value.verificationRunId,
        exportLicense: { kind: 'spdx', id: 'MIT' },
      },
    })
    const exported = await jsonRequest<{
      readonly simulation: { readonly id: string }
      readonly versions: readonly unknown[]
      readonly records: {
        readonly publications: readonly unknown[]
        readonly verificationRuns: readonly unknown[]
      }
    }>(origin, `/api/simulations/${simulationId}/export`, {
      method: 'POST',
      session: driverSession,
      body: { simulationId, currentPassword: password },
    })
    expect(exported.value.simulation.id).toBe(simulationId)
    expect(exported.value.versions).toHaveLength(1)
    expect(exported.value.records.publications).toHaveLength(1)
    expect(exported.value.records.verificationRuns).toHaveLength(1)
    const firstStatus = await smokeStatus(origin)
    expect(firstStatus.providerNetworkAttempts).toBe(0)
    expect(firstStatus.runnerRequests).toBeGreaterThanOrEqual(2)

    replaceDriver(context)
    await waitForReady(`${origin}/readyz`)
    const restartedSession = await login(origin)
    const persisted = await jsonRequest<SimulationDetail>(
      origin,
      `/api/simulations/${simulationId}`,
      { session: restartedSession },
    )
    expect(persisted.value.selectedVersion.summary).toMatchObject({
      id: versionId,
      state: 'published',
    })
    const restartedReport = await jsonRequest<VerificationReport>(
      origin,
      `/api/versions/${versionId}/report`,
      { session: restartedSession },
    )
    expect(restartedReport.value).toMatchObject({
      publication: { published: true },
      badgeActive: true,
      publishable: false,
    })
    await jsonRequest(origin, `/api/simulations/${simulationId}/export`, {
      method: 'POST',
      session: restartedSession,
      body: { simulationId, currentPassword: password },
    })
    expect((await smokeStatus(origin)).providerNetworkAttempts).toBe(0)
  }, 300_000)
})

async function createContext(): Promise<SmokeContext> {
  const directory = await mkdtemp(join(tmpdir(), 'simproof-deployment-smoke-'))
  try {
    const project = `simproof-smoke-${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const port = await availablePort()
    const bootstrapSecret = secret()
    const imageIds = Object.fromEntries(
      Object.entries(imageTags).map(([name, tag]) => [
        name,
        docker(['image', 'inspect', '--format', '{{.Id}}', tag]),
      ]),
    ) as Record<keyof typeof imageTags, string>
    if (Object.values(imageIds).some((id) => !/^sha256:[a-f\d]{64}$/u.test(id))) {
      throw new Error('Deployment smoke requires exact local image IDs.')
    }
    const socketUrl = docker([
      'context',
      'inspect',
      '--format',
      '{{(index .Endpoints "docker").Host}}',
    ])
    if (!socketUrl.startsWith('unix://')) {
      throw new Error('Deployment smoke requires a local Docker socket.')
    }
    const socket = socketUrl.slice('unix://'.length)
    if (socket.includes('\n') || socket.includes('\r') || socket.includes('=')) {
      throw new Error('Deployment smoke Docker socket path is invalid.')
    }
    const socketMetadata = await stat(socket)
    if (!socketMetadata.isSocket()) throw new Error('Deployment smoke Docker endpoint is invalid.')
    const socketGroup = probeSocketGroup(docker, socket, imageIds.runner)
    if (!Number.isSafeInteger(socketGroup) || socketGroup < 0) {
      throw new Error('Deployment smoke Docker socket group is invalid.')
    }
    const gid = String(socketGroup)
    const envFile = join(directory, '.env')
    const generatedEnvFile = join(directory, 'deployment.generated.env')
    await writePrivateFile(
      envFile,
      [
        'SIMPROOF_DEPLOYMENT_MODE=loopback',
        `SIMPROOF_HTTP_PORT=${port}`,
        `SIMPROOF_ALLOWED_ORIGINS=http://127.0.0.1:${port}`,
        `SIMPROOF_ADMIN_BOOTSTRAP_SECRET=${bootstrapSecret}`,
        `SIMPROOF_SESSION_SECRET=${secret()}`,
        `SIMPROOF_RUNNER_TOKEN=${secret()}`,
        '',
      ].join('\n'),
    )
    await writePrivateFile(
      generatedEnvFile,
      [
        `SIMPROOF_RUNNER_IMAGE=${imageIds.runner}`,
        `SIMPROOF_DOCKER_SOCKET=${socket}`,
        `SIMPROOF_DOCKER_GID=${gid}`,
        '',
      ].join('\n'),
    )
    const initialRunnerContainers = runnerContainers()
    if (initialRunnerContainers.length !== 0) {
      throw new Error('Deployment smoke refuses pre-existing owned runner containers.')
    }
    return {
      project,
      envFile,
      generatedEnvFile,
      port,
      bootstrapSecret,
      imageIds,
      initialRunnerContainers,
      activeOrchestrator: undefined,
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function startProductionOrchestrator(context: SmokeContext): void {
  compose(context, ['up', '-d', '--no-deps', 'orchestrator'])
  context.activeOrchestrator = `${context.project}-orchestrator-1`
}

function startDriver(context: SmokeContext, suffix: string): void {
  const name = `${context.project}-orchestrator-${suffix}`
  context.activeOrchestrator = name
  compose(context, [
    'run',
    '-d',
    '--no-deps',
    '--use-aliases',
    '--name',
    name,
    '--entrypoint',
    'node',
    '--volume',
    `${smokeDriver}:/smoke/full-stack-orchestrator.mjs:ro`,
    ...providerEnvironmentArguments(),
    'orchestrator',
    '/smoke/full-stack-orchestrator.mjs',
  ])
}

function replaceProductionWithDriver(context: SmokeContext): void {
  compose(context, ['stop', 'orchestrator'])
  compose(context, ['rm', '--force', 'orchestrator'])
  context.activeOrchestrator = undefined
  startDriver(context, 'a')
}

function replaceDriver(context: SmokeContext): void {
  if (context.activeOrchestrator === undefined) throw new Error('Smoke orchestrator is absent.')
  docker(['stop', '--time', '10', context.activeOrchestrator])
  docker(['rm', context.activeOrchestrator])
  context.activeOrchestrator = undefined
  startDriver(context, 'b')
}

function expectImages(context: SmokeContext): void {
  if (context.activeOrchestrator === undefined) throw new Error('Smoke orchestrator is absent.')
  expect(docker(['inspect', '--format', '{{.Image}}', context.activeOrchestrator])).toBe(
    context.imageIds.orchestrator,
  )
  expect(docker(['inspect', '--format', '{{.Image}}', `${context.project}-web-1`])).toBe(
    context.imageIds.web,
  )
  expect(
    docker(['inspect', '--format', '{{.Image}}', `${context.project}-runner-launcher-1`]),
  ).toBe(context.imageIds.launcher)
}

async function cleanup(context: SmokeContext): Promise<void> {
  try {
    if (context.activeOrchestrator !== undefined) {
      docker(['stop', '--time', '10', context.activeOrchestrator], true)
      docker(['rm', context.activeOrchestrator], true)
      context.activeOrchestrator = undefined
    }
    compose(context, ['down', '--volumes', '--remove-orphans'], true)
    expect(composeContainers(context.project)).toEqual([])
    expect(composeResources('network', context.project)).toEqual([])
    expect(composeResources('volume', context.project)).toEqual([])
    expect(runnerContainers()).toEqual(context.initialRunnerContainers)
  } finally {
    await rm(dirname(context.envFile), { recursive: true, force: true })
  }
}

function compose(context: SmokeContext, args: readonly string[], allowFailure = false): string {
  return docker(
    [
      'compose',
      '--project-name',
      context.project,
      '--env-file',
      context.envFile,
      '--env-file',
      context.generatedEnvFile,
      ...args,
    ],
    allowFailure,
  )
}

function docker(args: readonly string[], allowFailure = false): string {
  try {
    return execFileSync('docker', args, {
      cwd: root,
      encoding: 'utf8',
      env: providerAbsentProcessEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    }).trim()
  } catch (error) {
    if (allowFailure) return ''
    const message = dockerFailureMessage(error)
    throw new Error(`Docker deployment command failed: ${message}`)
  }
}

function dockerFailureMessage(error: unknown): string {
  const summary =
    error instanceof Error ? (error.message.split('\n')[0] ?? 'unknown error') : 'unknown error'
  if (typeof error !== 'object' || error === null) return summary
  const processError = error as { readonly stderr?: unknown; readonly stdout?: unknown }
  const detail = [processError.stdout, processError.stderr]
    .filter(
      (value): value is string | Uint8Array =>
        typeof value === 'string' || value instanceof Uint8Array,
    )
    .map((value) => value.toString().trim())
    .filter((value) => value.length > 0)
    .join('\n')
    .slice(0, 4_096)
    .replaceAll(
      /(?:OPENAI|CODEX|SIMPROOF)_[A-Z0-9_]*(?:KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*=\S+/gu,
      '<redacted>',
    )
  return detail.length === 0 ? summary : `${summary}\n${detail}`
}

function providerEnvironmentArguments(): readonly string[] {
  return [
    '--env',
    'OPENAI_API_KEY=deployment-smoke-openai-sentinel',
    '--env',
    'CODEX_API_KEY=deployment-smoke-codex-sentinel',
    '--env',
    'SIMPROOF_OPENAI_MODEL=deployment-smoke-openai',
    '--env',
    'SIMPROOF_CODEX_MODEL=deployment-smoke-codex',
    '--env',
    'SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION=1',
    '--env',
    'SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION=1',
    '--env',
    'SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION=1',
    '--env',
    'SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION=1',
    '--env',
    'SIMPROOF_CODEX_WORKSPACE_ROOT=/tmp/simproof-codex/workspaces',
    '--env',
    'SIMPROOF_CODEX_STATE_ROOT=/tmp/simproof-codex/state',
  ]
}

async function login(origin: string): Promise<{ cookie: string; csrfToken: string }> {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ password }),
  })
  const payload: unknown = await response.json()
  expect(response.status).toBe(200)
  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    !isRecord(payload.value) ||
    typeof payload.value.csrfToken !== 'string'
  ) {
    throw new Error('Login returned an invalid response.')
  }
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('Login did not set a session cookie.')
  const cookie = setCookie.split(';', 1)[0]
  if (cookie === undefined || !cookie.startsWith('simproof_session=')) {
    throw new Error('Login session cookie was invalid.')
  }
  return { cookie, csrfToken: payload.value.csrfToken }
}

async function jsonRequest<Value = unknown>(
  origin: string,
  path: string,
  options: {
    readonly method?: 'GET' | 'POST'
    readonly body?: unknown
    readonly session?: { readonly cookie: string; readonly csrfToken: string }
  } = {},
): Promise<ApiSuccess<Value>> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (options.session !== undefined) headers.cookie = options.session.cookie
  if (method === 'POST') {
    headers['content-type'] = 'application/json'
    headers.origin = origin
    if (options.session !== undefined) headers['x-csrf-token'] = options.session.csrfToken
  }
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !('value' in payload)) {
    throw new Error(`Deployment smoke request failed: ${method} ${path} (${response.status}).`)
  }
  return payload as unknown as ApiSuccess<Value>
}

async function expectGenerationUnavailable(
  origin: string,
  versionId: string,
  revision: number,
  session: { readonly cookie: string; readonly csrfToken: string },
): Promise<void> {
  const response = await fetch(`${origin}/api/generations`, {
    method: 'POST',
    headers: {
      cookie: session.cookie,
      'content-type': 'application/json',
      origin,
      'x-csrf-token': session.csrfToken,
    },
    body: JSON.stringify(generationRequest(versionId, revision)),
  })
  const payload: unknown = await response.json()
  expect(response.status).toBe(503)
  expect(payload).toMatchObject({
    ok: false,
    error: { id: 'http.educator-unavailable' },
  })
}

async function pollGeneration(
  origin: string,
  runId: string,
  session: { readonly cookie: string; readonly csrfToken: string },
  expected: string,
): Promise<ApiSuccess<GenerationStatus>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await jsonRequest<GenerationStatus>(origin, `/api/generations/${runId}`, {
      session,
    })
    if (status.value.state === expected) return status
    if (
      [
        'rejected',
        'cancelled',
        'provider_failed',
        'runner_failed',
        'budget_exhausted',
        'invariant_failed',
      ].includes(status.value.state)
    ) {
      throw new Error(`Generation reached ${status.value.state}.`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Generation did not reach ${expected}.`)
}

async function waitForReady(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The edge is expected to refuse connections while its dependencies start.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Deployment did not become ready.')
}

async function smokeStatus(
  origin: string,
): Promise<{ providerNetworkAttempts: number; runnerRequests: number }> {
  const response = await fetch(`${origin}/api/__smoke/status`)
  expect(response.status).toBe(200)
  const value: unknown = await response.json()
  if (
    !isRecord(value) ||
    typeof value.providerNetworkAttempts !== 'number' ||
    typeof value.runnerRequests !== 'number'
  ) {
    throw new Error('Deployment smoke status was invalid.')
  }
  return {
    providerNetworkAttempts: value.providerNetworkAttempts,
    runnerRequests: value.runnerRequests,
  }
}

function generationRequest(versionId: string, expectedVersionRevision: number): unknown {
  return {
    schemaVersion: '1',
    simulationVersionId: versionId,
    expectedVersionRevision,
    idempotencyKey: `deployment-smoke:${randomUUID()}`,
    teacher: {
      prompt: 'Create a deterministic pendulum simulation.',
      externalProviderDisclosureAccepted: true,
      promptRetention: 'discard',
    },
    maxAttempts: 3,
    budget: {
      maxProviderRequests: 6,
      maxInputTokens: 120_000,
      maxOutputTokens: 30_000,
      maxCostMicrousd: 1_000_000,
      maxArtifactBytes: 1_000_000,
    },
  }
}

function runnerContainers(): readonly string[] {
  return docker([
    'container',
    'ls',
    '--all',
    '--quiet',
    '--filter',
    'label=com.simproof.runner.owner=simproof-launcher-v1',
  ])
    .split(/\s+/u)
    .filter(Boolean)
    .sort()
}

function composeContainers(project: string): readonly string[] {
  return docker([
    'container',
    'ls',
    '--all',
    '--quiet',
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ])
    .split(/\s+/u)
    .filter(Boolean)
}

function composeResources(kind: 'network' | 'volume', project: string): readonly string[] {
  return docker([kind, 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`])
    .split(/\s+/u)
    .filter(Boolean)
}

function secret(): string {
  return randomBytes(48).toString('base64url')
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : undefined
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
  if (port === undefined) throw new Error('Could not reserve a deployment smoke port.')
  return port
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
