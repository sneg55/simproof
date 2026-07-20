import {
  MAX_RUNNER_LAUNCHER_REQUEST_BYTES,
  type RunnerImageDigest,
  type RunnerLimits,
  runnerImageDigestSchema,
  runnerLimitsSchema,
} from '@simproof/contracts'

export interface LauncherConfig {
  readonly image: RunnerImageDigest
  readonly token: string
  readonly listen: {
    readonly kind: 'tcp'
    readonly host: '0.0.0.0' | '127.0.0.1'
    readonly port: number
  }
  readonly maxRequestBytes: number
  readonly maxConcurrent: number
  readonly maximumLimits: RunnerLimits
}

export class LauncherConfigurationError extends TypeError {
  readonly fields: readonly string[]

  constructor(fields: readonly string[]) {
    const unique = [...new Set(fields)].sort()
    super(`Invalid launcher configuration: ${unique.join(', ')}.`)
    this.name = 'LauncherConfigurationError'
    this.fields = unique
  }
}

const integer = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined => {
  const input = value ?? String(fallback)
  if (!/^\d+$/u.test(input)) return undefined
  const parsed = Number(input)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined
}

export function parseLauncherEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): LauncherConfig {
  const image = runnerImageDigestSchema.safeParse(environment.SIMPROOF_RUNNER_IMAGE)
  const token = environment.SIMPROOF_RUNNER_TOKEN
  const host = environment.SIMPROOF_LAUNCHER_HOST ?? '0.0.0.0'
  const socketConfigured = environment.SIMPROOF_LAUNCHER_SOCKET !== undefined
  const port = integer(environment.SIMPROOF_LAUNCHER_PORT, 4_318, 1, 65_535)
  const maxRequestBytes = integer(
    environment.SIMPROOF_LAUNCHER_MAX_REQUEST_BYTES,
    MAX_RUNNER_LAUNCHER_REQUEST_BYTES,
    16_384,
    MAX_RUNNER_LAUNCHER_REQUEST_BYTES,
  )
  const maxConcurrent = integer(environment.SIMPROOF_LAUNCHER_MAX_CONCURRENT, 2, 1, 32)
  const invalid = launcherErrors({
    imageValid: image.success,
    token,
    host,
    socketConfigured,
    port,
    maxRequestBytes,
    maxConcurrent,
  })
  if (invalid.length > 0) throw new LauncherConfigurationError(invalid)
  const maximumLimits = runnerLimitsSchema.parse({
    memoryBytes: 134_217_728,
    timeoutMs: 5_000,
    maxOutputBytes: 1_048_576,
    maxSamples: 1_000,
  })
  return {
    image: runnerImageDigestSchema.parse(environment.SIMPROOF_RUNNER_IMAGE),
    token: token ?? '',
    listen: { kind: 'tcp', host: trustedHost(host), port: port ?? 0 },
    maxRequestBytes: maxRequestBytes ?? 0,
    maxConcurrent: maxConcurrent ?? 0,
    maximumLimits,
  }
}

function launcherErrors(input: {
  readonly imageValid: boolean
  readonly token: string | undefined
  readonly host: string
  readonly socketConfigured: boolean
  readonly port: number | undefined
  readonly maxRequestBytes: number | undefined
  readonly maxConcurrent: number | undefined
}): string[] {
  const invalid: string[] = []
  if (!input.imageValid) invalid.push('SIMPROOF_RUNNER_IMAGE')
  if (input.token === undefined || input.token.length < 32 || input.token.length > 4_096) {
    invalid.push('SIMPROOF_RUNNER_TOKEN')
  }
  if (input.socketConfigured) invalid.push('SIMPROOF_LAUNCHER_SOCKET')
  if (input.host !== '0.0.0.0' && input.host !== '127.0.0.1') {
    invalid.push('SIMPROOF_LAUNCHER_HOST')
  }
  if (input.port === undefined) invalid.push('SIMPROOF_LAUNCHER_PORT')
  if (input.maxRequestBytes === undefined) invalid.push('SIMPROOF_LAUNCHER_MAX_REQUEST_BYTES')
  if (input.maxConcurrent === undefined) invalid.push('SIMPROOF_LAUNCHER_MAX_CONCURRENT')
  return invalid
}

function trustedHost(host: string): '0.0.0.0' | '127.0.0.1' {
  if (host === '0.0.0.0' || host === '127.0.0.1') return host
  throw new LauncherConfigurationError(['SIMPROOF_LAUNCHER_HOST'])
}
