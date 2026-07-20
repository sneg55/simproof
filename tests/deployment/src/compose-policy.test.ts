import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

interface ComposeService {
  readonly build?: { readonly dockerfile?: string } | string
  readonly cap_add?: readonly string[]
  readonly cap_drop?: readonly string[]
  readonly environment?: Readonly<Record<string, string>> | readonly string[]
  readonly group_add?: readonly string[]
  readonly healthcheck?: { readonly test?: readonly string[] }
  readonly image?: string
  readonly mem_limit?: string
  readonly networks?: readonly string[]
  readonly network_mode?: string
  readonly ports?: readonly string[]
  readonly pids_limit?: number
  readonly privileged?: boolean
  readonly profiles?: readonly string[]
  readonly read_only?: boolean
  readonly restart?: string
  readonly security_opt?: readonly string[]
  readonly tmpfs?: readonly string[]
  readonly user?: string
  readonly volumes?: readonly string[]
}

interface ComposeFile {
  readonly networks: {
    readonly application: { readonly internal?: boolean }
    readonly edge: { readonly internal?: boolean }
    readonly 'provider-egress': { readonly internal?: boolean }
    readonly 'runner-control': { readonly internal?: boolean }
  }
  readonly services: {
    readonly orchestrator: ComposeService
    readonly runner: ComposeService
    readonly 'runner-launcher': ComposeService
    readonly web: ComposeService
  }
  readonly volumes: Readonly<Record<string, unknown>>
}

const compose = parse(readFileSync(resolve(root, 'compose.yaml'), 'utf8')) as ComposeFile
const localTestOverride = parse(readFileSync(resolve(root, 'compose.local-test.yaml'), 'utf8')) as {
  readonly services: { readonly orchestrator: ComposeService }
}
const runtimeServices = ['web', 'orchestrator', 'runner-launcher'] as const

describe('supported Compose topology', () => {
  it('keeps password-free access in an explicit test-only override', () => {
    expect(environmentValue(compose.services.orchestrator, 'NODE_ENV')).toBe('production')
    expect(environmentValue(compose.services.orchestrator, 'SIMPROOF_LOCAL_AUTH_BYPASS')).toBe(
      undefined,
    )
    expect(environmentValue(localTestOverride.services.orchestrator, 'NODE_ENV')).toBe('test')
    expect(
      environmentValue(localTestOverride.services.orchestrator, 'SIMPROOF_LOCAL_AUTH_BYPASS'),
    ).toBe('true')
  })

  it('has one loopback-published edge while keeping application control networks internal', () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      'orchestrator',
      'runner',
      'runner-launcher',
      'web',
    ])
    expect(compose.services.web.ports).toEqual(['127.0.0.1:${SIMPROOF_HTTP_PORT:-8080}:8080'])
    expect(compose.services.orchestrator.ports).toBeUndefined()
    expect(compose.services['runner-launcher'].ports).toBeUndefined()
    expect(compose.networks.application.internal).toBe(true)
    expect(compose.networks['runner-control'].internal).toBe(true)
    expect(compose.networks.edge.internal).not.toBe(true)
    expect(compose.networks['provider-egress'].internal).not.toBe(true)
    expect(compose.services.web.networks).toEqual(['edge', 'application'])
    expect(compose.services.orchestrator.networks).toEqual([
      'application',
      'runner-control',
      'provider-egress',
    ])
    expect(compose.services['runner-launcher'].networks).toEqual(['runner-control'])
    expect(compose.services.orchestrator.networks).not.toContain('edge')
    expect(compose.services['runner-launcher'].networks).not.toContain('edge')
    expect(environmentValue(compose.services.web, 'SIMPROOF_ORCHESTRATOR_URL')).toBe(
      'http://orchestrator:3000',
    )
    expect(environmentNames(compose.services.web)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(?:OPENAI|CODEX)(?:_|$)/u),
        expect.stringMatching(/^SIMPROOF_(?:OPENAI|CODEX)_/u),
      ]),
    )
  })

  it('runs every service unprivileged with health checks and bounded restart behavior', () => {
    for (const name of runtimeServices) {
      const service = serviceByName(name)
      expect(service.user, name).toBe('65532:65532')
      expect(service.privileged, name).not.toBe(true)
      expect(service.restart, name).toBe('unless-stopped')
      expect(service.healthcheck?.test, name).toHaveLength(4)
      expect(service.cap_drop, name).toContain('ALL')
      expect(service.security_opt, name).toContain('no-new-privileges:true')
    }
  })

  it('keeps persistent state only in application-owned named volumes', () => {
    expect(Object.keys(compose.volumes).sort()).toEqual(['simproof-data', 'simproof-logs'])
    expect(compose.services.orchestrator.volumes).toEqual([
      'simproof-data:/var/lib/simproof',
      'simproof-logs:/var/log/simproof',
    ])
    expect(compose.services.web.volumes).toBeUndefined()
    expect(compose.services['runner-launcher'].volumes).toEqual([
      '${SIMPROOF_DOCKER_SOCKET:?set the Docker socket path}:/var/run/docker.sock:ro',
    ])
    expect(compose.services['runner-launcher'].group_add).toEqual([
      '${SIMPROOF_DOCKER_GID:?set the Docker socket group ID}',
    ])
  })

  it('gives Docker authority only to the launcher control plane', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      const socketMounts = service.volumes?.filter((volume) => volume.includes('docker.sock')) ?? []
      expect(socketMounts, name).toEqual(
        name === 'runner-launcher'
          ? ['${SIMPROOF_DOCKER_SOCKET:?set the Docker socket path}:/var/run/docker.sock:ro']
          : [],
      )
    }
    expect(environmentValue(compose.services.orchestrator, 'SIMPROOF_RUNNER_ENDPOINT')).toBe(
      'http://runner-launcher:4318',
    )
    expect(environmentValue(compose.services.web, 'SIMPROOF_MAX_REQUEST_BYTES')).toBe(
      '${SIMPROOF_MAX_REQUEST_BYTES:-65536}',
    )
    expect(environmentValue(compose.services.orchestrator, 'SIMPROOF_MAX_REQUEST_BYTES')).toBe(
      '${SIMPROOF_MAX_REQUEST_BYTES:-65536}',
    )
    expect(environmentValue(compose.services['runner-launcher'], 'SIMPROOF_RUNNER_IMAGE')).toBe(
      '${SIMPROOF_RUNNER_IMAGE:?set an immutable runner image reference}',
    )
    expect(compose.services['runner-launcher'].mem_limit).toBe('256m')
    expect(compose.services['runner-launcher'].pids_limit).toBe(64)
  })

  it('propagates every advertised bounded application setting to the orchestrator', () => {
    const expected = {
      SIMPROOF_DIAGNOSTIC_LOG_FILES: '${SIMPROOF_DIAGNOSTIC_LOG_FILES:-3}',
      SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES: '${SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES:-8388608}',
      SIMPROOF_MAX_ACTIVE_SESSIONS: '${SIMPROOF_MAX_ACTIVE_SESSIONS:-8}',
      SIMPROOF_MAX_PROMPT_CHARACTERS: '${SIMPROOF_MAX_PROMPT_CHARACTERS:-16384}',
      SIMPROOF_SESSION_IDLE_SECONDS: '${SIMPROOF_SESSION_IDLE_SECONDS:-3600}',
      SIMPROOF_SESSION_TTL_SECONDS: '${SIMPROOF_SESSION_TTL_SECONDS:-28800}',
    } as const

    for (const [name, value] of Object.entries(expected)) {
      expect(environmentValue(compose.services.orchestrator, name), name).toBe(value)
    }
  })

  it('keeps the generated runner image as a non-starting, networkless build target', () => {
    const runner = compose.services.runner
    expect(runner.profiles).toEqual(['image-only'])
    expect(runner.network_mode).toBe('none')
    expect(runner.read_only).toBe(true)
    expect(runner.cap_drop).toContain('ALL')
    expect(runner.security_opt).toContain('no-new-privileges:true')
    expect(runner.volumes).toBeUndefined()
  })
})

function environmentValue(service: ComposeService, name: string): string | undefined {
  if (Array.isArray(service.environment)) {
    const prefix = `${name}=`
    const entries = service.environment as readonly string[]
    return entries.find((value) => value.startsWith(prefix))?.slice(prefix.length)
  }
  const entries = Object.entries(
    (service.environment as Readonly<Record<string, string>> | undefined) ?? {},
  )
  return entries.find(([key]) => key === name)?.[1]
}

function environmentNames(service: ComposeService): readonly string[] {
  if (Array.isArray(service.environment)) {
    return (service.environment as readonly string[]).map((value) => value.split('=', 1)[0] ?? '')
  }
  return Object.keys(service.environment ?? {})
}

function serviceByName(name: (typeof runtimeServices)[number]): ComposeService {
  if (name === 'web') return compose.services.web
  if (name === 'orchestrator') return compose.services.orchestrator
  return compose.services['runner-launcher']
}

describe('production build policy', () => {
  it.each([
    ['web', 'Dockerfile.web'],
    ['orchestrator', 'Dockerfile.orchestrator'],
    ['runner-launcher', 'Dockerfile.launcher'],
  ] as const)('%s uses its canonical production Dockerfile', (serviceName, dockerfile) => {
    const build = serviceByName(serviceName).build
    expect(typeof build).toBe('object')
    expect((build as { dockerfile?: string }).dockerfile).toBe(dockerfile)
  })

  it.each(['Dockerfile.web', 'Dockerfile.orchestrator', 'Dockerfile.launcher'])(
    '%s is pinned, multi-stage, and drops to the numeric runtime user',
    (name) => {
      const dockerfile = readFileSync(resolve(root, name), 'utf8')
      expect(dockerfile).toMatch(/^FROM [^\n]+@sha256:[a-f0-9]{64} AS build$/mu)
      expect(dockerfile.match(/^FROM /gmu)?.length).toBeGreaterThanOrEqual(2)
      expect(dockerfile).toContain('npm install --global pnpm@11.13.1')
      expect(dockerfile).toContain('USER 65532:65532')
      expect(dockerfile).not.toMatch(/COPY\s+\.\s+\./u)
      expect(dockerfile).not.toMatch(/(?:\.env|OPENAI_API_KEY|CODEX_API_KEY)/u)
    },
  )

  it.each(['Dockerfile.orchestrator', 'Dockerfile.launcher'])(
    '%s preserves the reviewed workspace deployment behavior under pnpm 11',
    (name) => {
      const dockerfile = readFileSync(resolve(root, name), 'utf8')
      expect(dockerfile).toMatch(/pnpm --filter [^\n]+ deploy --legacy --prod \/runtime/u)
    },
  )

  it('excludes local secrets, source control, outputs, and dependency trees from build context', () => {
    const ignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    for (const pattern of [
      '.env',
      '.git',
      '.simproof',
      'node_modules',
      '**/dist',
      '**/*.test.*',
      'test-results',
      'tests',
    ]) {
      expect(ignore).toContain(pattern)
    }
    expect(ignore).toContain('!.env.example')
  })
})
