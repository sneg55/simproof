import {
  type PublicRuntimeConfig,
  privacySettingsSchema,
  publicRuntimeConfigSchema,
} from '@simproof/contracts'

import {
  type EnvironmentInput,
  environmentSchema,
  KNOWN_ENVIRONMENT_KEYS,
  type KnownEnvironmentKey,
  type ParsedEnvironment,
  pickKnownEnvironment,
} from './environment-schema.js'
import { validateStorage } from './environment-storage.js'
import { validateGenerationConfiguration } from './generation-environment.js'
import { parseAllowedOrigins, validExternalEndpoint, validTrustedProxy } from './network-policy.js'
import type { ServerConfig } from './server-config.js'

export class ConfigurationError extends Error {
  readonly fields: readonly string[]

  constructor(fields: readonly string[]) {
    const uniqueFields = [...new Set(fields)].sort()
    super(`Invalid configuration: ${uniqueFields.join(', ')}.`)
    this.name = 'ConfigurationError'
    this.fields = uniqueFields
  }
}

export type { ProviderPricing } from './generation-environment.js'
export type { ServerConfig } from './server-config.js'

export function parseEnvironment(environment: EnvironmentInput): ServerConfig {
  const unknown = Object.keys(environment).filter(
    (key) =>
      key.startsWith('SIMPROOF_') && !KNOWN_ENVIRONMENT_KEYS.includes(key as KnownEnvironmentKey),
  )
  const parsed = environmentSchema.safeParse(pickKnownEnvironment(environment))
  if (!parsed.success) {
    throw new ConfigurationError([
      ...unknown,
      ...requiredRawProductionFields(environment),
      ...parsed.error.issues.map((issue) => String(issue.path[0] ?? 'environment')),
    ])
  }
  if (unknown.length > 0) throw new ConfigurationError(unknown)

  const value = parsed.data
  const storage = validateStorage(value)
  const deploymentMode = value.SIMPROOF_DEPLOYMENT_MODE ?? 'loopback'
  const generation = validateGenerationConfiguration(value, storage)
  const invalidFields = [
    ...requiredProductionFields(value),
    ...storage.invalidFields,
    ...validateLimits(value),
    ...validateOptionalNetworkConfiguration(value),
    ...generation.invalidFields,
  ]
  const allowedOrigins = parseAllowedOrigins(
    value.SIMPROOF_ALLOWED_ORIGINS ?? 'http://127.0.0.1:3000',
    value.NODE_ENV === 'production' && deploymentMode === 'network',
  )
  if (allowedOrigins === undefined) invalidFields.push('SIMPROOF_ALLOWED_ORIGINS')
  if (!validProductionLoopbackOrigins(value.NODE_ENV, deploymentMode, allowedOrigins)) {
    invalidFields.push('SIMPROOF_ALLOWED_ORIGINS')
  }
  if (!validLocalAuthBypass(value, deploymentMode, allowedOrigins)) {
    invalidFields.push('SIMPROOF_LOCAL_AUTH_BYPASS')
  }
  if (invalidFields.length > 0) throw new ConfigurationError(invalidFields)

  const privacy = privacySettingsSchema.parse({
    promptRetention: value.SIMPROOF_PROMPT_RETENTION,
    telemetryEnabled: value.SIMPROOF_TELEMETRY_ENABLED,
    externalDiagnosticsEnabled: value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED,
  })
  return {
    environment: value.NODE_ENV,
    deploymentMode,
    server: {
      host: value.SIMPROOF_LISTEN_HOST ?? (deploymentMode === 'network' ? '0.0.0.0' : '127.0.0.1'),
      port: value.SIMPROOF_PORT,
    },
    databasePath: storage.databasePath,
    artifactRoot: storage.artifactRoot,
    allowedOrigins: allowedOrigins ?? [],
    trustedProxyAddress: value.SIMPROOF_TRUSTED_PROXY_ADDRESS,
    adminBootstrapSecret: value.SIMPROOF_ADMIN_BOOTSTRAP_SECRET,
    sessionSecret: value.SIMPROOF_SESSION_SECRET,
    localAuthBypass: value.SIMPROOF_LOCAL_AUTH_BYPASS,
    providers: {
      openaiApiKey: value.OPENAI_API_KEY,
      codexApiKey: value.CODEX_API_KEY,
    },
    runner: generation.runner,
    ...(generation.config === undefined ? {} : { generation: generation.config }),
    demoGeneration: resolveDemoGeneration(value, generation.config !== undefined),
    session: {
      ttlSeconds: value.SIMPROOF_SESSION_TTL_SECONDS,
      idleSeconds: value.SIMPROOF_SESSION_IDLE_SECONDS,
      maxActiveSessions: value.SIMPROOF_MAX_ACTIVE_SESSIONS,
    },
    request: {
      maxBytes: value.SIMPROOF_MAX_REQUEST_BYTES,
      maxPromptCharacters: value.SIMPROOF_MAX_PROMPT_CHARACTERS,
    },
    privacy,
    externalDiagnostics: {
      endpoint: value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT,
      token: value.SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN,
    },
    telemetry: { endpoint: value.SIMPROOF_TELEMETRY_ENDPOINT },
    observability: {
      diagnosticLogRoot: storage.diagnosticLogRoot,
      maxFileBytes: value.SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES,
      retainedFiles: value.SIMPROOF_DIAGNOSTIC_LOG_FILES,
    },
  }
}

export const parseProcessEnvironment = (): ServerConfig => parseEnvironment(process.env)

export const readProcessEnvironmentInput = (): EnvironmentInput => ({ ...process.env })

function requiredRawProductionFields(environment: EnvironmentInput): string[] {
  if (environment.NODE_ENV !== 'production') return []
  return [
    ['SIMPROOF_DEPLOYMENT_MODE', environment.SIMPROOF_DEPLOYMENT_MODE],
    ['SIMPROOF_DATABASE_PATH', environment.SIMPROOF_DATABASE_PATH],
    ['SIMPROOF_ARTIFACT_ROOT', environment.SIMPROOF_ARTIFACT_ROOT],
    ['SIMPROOF_ADMIN_BOOTSTRAP_SECRET', environment.SIMPROOF_ADMIN_BOOTSTRAP_SECRET],
    ['SIMPROOF_SESSION_SECRET', environment.SIMPROOF_SESSION_SECRET],
    ['SIMPROOF_ALLOWED_ORIGINS', environment.SIMPROOF_ALLOWED_ORIGINS],
  ].flatMap(([field, fieldValue]) => (fieldValue === undefined ? [String(field)] : []))
}

export function toPublicRuntimeConfig(config: ServerConfig): PublicRuntimeConfig {
  return publicRuntimeConfigSchema.parse({
    deploymentMode: config.deploymentMode,
    providerConfigured:
      config.providers.openaiApiKey !== undefined &&
      config.providers.codexApiKey !== undefined &&
      config.runner !== undefined &&
      config.generation !== undefined,
    maxRequestBytes: config.request.maxBytes,
    maxPromptCharacters: config.request.maxPromptCharacters,
    promptRetentionDefault: config.privacy.promptRetention,
    telemetryEnabled: config.privacy.telemetryEnabled,
    externalDiagnosticsEnabled: config.privacy.externalDiagnosticsEnabled,
  })
}

function requiredProductionFields(value: ParsedEnvironment): string[] {
  if (value.NODE_ENV !== 'production') return []
  return [
    ['SIMPROOF_DEPLOYMENT_MODE', value.SIMPROOF_DEPLOYMENT_MODE],
    ['SIMPROOF_DATABASE_PATH', value.SIMPROOF_DATABASE_PATH],
    ['SIMPROOF_ARTIFACT_ROOT', value.SIMPROOF_ARTIFACT_ROOT],
    ['SIMPROOF_ADMIN_BOOTSTRAP_SECRET', value.SIMPROOF_ADMIN_BOOTSTRAP_SECRET],
    ['SIMPROOF_SESSION_SECRET', value.SIMPROOF_SESSION_SECRET],
    ['SIMPROOF_ALLOWED_ORIGINS', value.SIMPROOF_ALLOWED_ORIGINS],
  ].flatMap(([field, fieldValue]) => (fieldValue === undefined ? [String(field)] : []))
}

// Fenced three ways: demo must be explicitly requested, there must be no real
// provider (never a fallback), and it is refused entirely in production so a
// deployed instance can never be flipped into the scripted provider.
function resolveDemoGeneration(value: ParsedEnvironment, generationConfigured: boolean): boolean {
  return (
    value.SIMPROOF_DEMO_GENERATION === true &&
    !generationConfigured &&
    value.NODE_ENV !== 'production'
  )
}

function validateLimits(value: ParsedEnvironment): string[] {
  return value.SIMPROOF_SESSION_IDLE_SECONDS > value.SIMPROOF_SESSION_TTL_SECONDS
    ? ['SIMPROOF_SESSION_IDLE_SECONDS']
    : []
}

function validProductionLoopbackOrigins(
  environment: ParsedEnvironment['NODE_ENV'],
  deploymentMode: ServerConfig['deploymentMode'],
  origins: readonly string[] | undefined,
): boolean {
  if (environment !== 'production' || deploymentMode !== 'loopback') return true
  return (
    origins?.every((origin) => {
      const url = new URL(origin)
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== ''
    }) === true
  )
}

function validLocalAuthBypass(
  value: ParsedEnvironment,
  deploymentMode: ServerConfig['deploymentMode'],
  origins: readonly string[] | undefined,
): boolean {
  if (!value.SIMPROOF_LOCAL_AUTH_BYPASS) return true
  return (
    value.NODE_ENV === 'test' &&
    deploymentMode === 'loopback' &&
    value.SIMPROOF_TRUSTED_PROXY_ADDRESS === undefined &&
    !value.SIMPROOF_TELEMETRY_ENABLED &&
    !value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED &&
    origins?.every((origin) => {
      const url = new URL(origin)
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== ''
    }) === true
  )
}

function validateOptionalNetworkConfiguration(value: ParsedEnvironment): string[] {
  const invalidFields: string[] = []
  if (
    value.SIMPROOF_TRUSTED_PROXY_ADDRESS !== undefined &&
    !validTrustedProxy(value.SIMPROOF_TRUSTED_PROXY_ADDRESS)
  ) {
    invalidFields.push('SIMPROOF_TRUSTED_PROXY_ADDRESS')
  }
  if (
    value.SIMPROOF_TELEMETRY_ENABLED &&
    (value.SIMPROOF_TELEMETRY_ENDPOINT === undefined ||
      !validExternalEndpoint(value.SIMPROOF_TELEMETRY_ENDPOINT))
  ) {
    invalidFields.push('SIMPROOF_TELEMETRY_ENDPOINT')
  }
  if (
    value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED &&
    (value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT === undefined ||
      !validExternalEndpoint(value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT))
  ) {
    invalidFields.push('SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT')
  }
  if (
    value.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED &&
    value.SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN === undefined
  ) {
    invalidFields.push('SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN')
  }
  return invalidFields
}
