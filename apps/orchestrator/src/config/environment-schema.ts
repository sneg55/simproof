import { deploymentModeSchema, MIN_REQUEST_BODY_BYTES } from '@simproof/contracts'
import { z } from 'zod'

export const KNOWN_ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'SIMPROOF_OPENAI_MODEL',
  'SIMPROOF_CODEX_MODEL',
  'SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION',
  'SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION',
  'SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION',
  'SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION',
  'SIMPROOF_CODEX_WORKSPACE_ROOT',
  'SIMPROOF_CODEX_STATE_ROOT',
  'SIMPROOF_DEMO_GENERATION',
  'SIMPROOF_DEPLOYMENT_MODE',
  'SIMPROOF_LISTEN_HOST',
  'SIMPROOF_PORT',
  'SIMPROOF_DATABASE_PATH',
  'SIMPROOF_ARTIFACT_ROOT',
  'SIMPROOF_ADMIN_BOOTSTRAP_SECRET',
  'SIMPROOF_SESSION_SECRET',
  'SIMPROOF_LOCAL_AUTH_BYPASS',
  'SIMPROOF_ALLOWED_ORIGINS',
  'SIMPROOF_TRUSTED_PROXY_ADDRESS',
  'SIMPROOF_SESSION_TTL_SECONDS',
  'SIMPROOF_SESSION_IDLE_SECONDS',
  'SIMPROOF_MAX_ACTIVE_SESSIONS',
  'SIMPROOF_MAX_REQUEST_BYTES',
  'SIMPROOF_MAX_PROMPT_CHARACTERS',
  'SIMPROOF_PROMPT_RETENTION',
  'SIMPROOF_TELEMETRY_ENABLED',
  'SIMPROOF_TELEMETRY_ENDPOINT',
  'SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED',
  'SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT',
  'SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN',
  'SIMPROOF_DIAGNOSTIC_LOG_ROOT',
  'SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES',
  'SIMPROOF_DIAGNOSTIC_LOG_FILES',
  'SIMPROOF_RUNNER_ENDPOINT',
  'SIMPROOF_RUNNER_TOKEN',
  'SIMPROOF_RUNNER_IMAGE',
  'SIMPROOF_RUNNER_VERSION',
] as const

export type KnownEnvironmentKey = (typeof KNOWN_ENVIRONMENT_KEYS)[number]
export type EnvironmentInput = Readonly<Record<string, string | undefined>>

const booleanString = z.preprocess(
  (value) => value ?? 'false',
  z.enum(['true', 'false']).transform((value) => value === 'true'),
)

function integerString(defaultValue: number, minimum: number, maximum: number) {
  return z.preprocess(
    (value) => value ?? String(defaultValue),
    z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(minimum).max(maximum)),
  )
}

function optionalIntegerString(minimum: number, maximum: number) {
  return z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum))
    .optional()
}

const boundedSecret = z
  .string()
  .min(20)
  .max(4_096)
  .refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value))

const highEntropySecret = boundedSecret.min(32).refine((value) => new Set(value).size >= 12)
const adminBootstrapSecret = highEntropySecret.max(1_024)

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    OPENAI_API_KEY: boundedSecret.optional(),
    CODEX_API_KEY: boundedSecret.optional(),
    SIMPROOF_OPENAI_MODEL: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,128}$/u)
      .optional(),
    SIMPROOF_CODEX_MODEL: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,128}$/u)
      .optional(),
    SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION: optionalIntegerString(1, 100_000_000),
    SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION: optionalIntegerString(1, 100_000_000),
    SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION: optionalIntegerString(1, 100_000_000),
    SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION: optionalIntegerString(1, 100_000_000),
    SIMPROOF_CODEX_WORKSPACE_ROOT: z.string().min(1).max(4_096).optional(),
    SIMPROOF_CODEX_STATE_ROOT: z.string().min(1).max(4_096).optional(),
    SIMPROOF_DEPLOYMENT_MODE: deploymentModeSchema.optional(),
    SIMPROOF_LISTEN_HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
    SIMPROOF_PORT: integerString(3_000, 1, 65_535),
    SIMPROOF_DATABASE_PATH: z.string().min(1).max(4_096).optional(),
    SIMPROOF_ARTIFACT_ROOT: z.string().min(1).max(4_096).optional(),
    SIMPROOF_ADMIN_BOOTSTRAP_SECRET: adminBootstrapSecret.optional(),
    SIMPROOF_SESSION_SECRET: highEntropySecret.optional(),
    SIMPROOF_LOCAL_AUTH_BYPASS: booleanString,
    SIMPROOF_ALLOWED_ORIGINS: z.string().min(1).max(4_096).optional(),
    SIMPROOF_TRUSTED_PROXY_ADDRESS: z.string().min(2).max(64).optional(),
    SIMPROOF_SESSION_TTL_SECONDS: integerString(28_800, 900, 604_800),
    SIMPROOF_SESSION_IDLE_SECONDS: integerString(3_600, 300, 86_400),
    SIMPROOF_MAX_ACTIVE_SESSIONS: integerString(8, 1, 128),
    SIMPROOF_MAX_REQUEST_BYTES: integerString(65_536, MIN_REQUEST_BODY_BYTES, 1_048_576),
    SIMPROOF_MAX_PROMPT_CHARACTERS: integerString(16_384, 256, 65_536),
    SIMPROOF_PROMPT_RETENTION: z.enum(['discard', 'persist']).default('discard'),
    SIMPROOF_DEMO_GENERATION: booleanString,
    SIMPROOF_TELEMETRY_ENABLED: booleanString,
    SIMPROOF_TELEMETRY_ENDPOINT: z.url().max(2_048).optional(),
    SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED: booleanString,
    SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT: z.url().max(2_048).optional(),
    SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN: boundedSecret.min(32).optional(),
    SIMPROOF_DIAGNOSTIC_LOG_ROOT: z.string().min(1).max(4_096).optional(),
    SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES: integerString(8_388_608, 65_536, 16_777_216),
    SIMPROOF_DIAGNOSTIC_LOG_FILES: integerString(3, 1, 10),
    SIMPROOF_RUNNER_ENDPOINT: z.string().min(1).max(4_096).optional(),
    SIMPROOF_RUNNER_TOKEN: boundedSecret.min(32).optional(),
    SIMPROOF_RUNNER_IMAGE: z.string().min(1).max(512).optional(),
    SIMPROOF_RUNNER_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/u)
      .optional(),
  })
  .strict()

export type ParsedEnvironment = z.infer<typeof environmentSchema>

export function pickKnownEnvironment(
  environment: EnvironmentInput,
): Record<string, string | undefined> {
  return {
    NODE_ENV: environment.NODE_ENV,
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
    CODEX_API_KEY: environment.CODEX_API_KEY,
    SIMPROOF_OPENAI_MODEL: environment.SIMPROOF_OPENAI_MODEL,
    SIMPROOF_CODEX_MODEL: environment.SIMPROOF_CODEX_MODEL,
    SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION:
      environment.SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION,
    SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION:
      environment.SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION,
    SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION:
      environment.SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION,
    SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION:
      environment.SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION,
    SIMPROOF_CODEX_WORKSPACE_ROOT: environment.SIMPROOF_CODEX_WORKSPACE_ROOT,
    SIMPROOF_CODEX_STATE_ROOT: environment.SIMPROOF_CODEX_STATE_ROOT,
    SIMPROOF_DEPLOYMENT_MODE: environment.SIMPROOF_DEPLOYMENT_MODE,
    SIMPROOF_LISTEN_HOST: environment.SIMPROOF_LISTEN_HOST,
    SIMPROOF_PORT: environment.SIMPROOF_PORT,
    SIMPROOF_DATABASE_PATH: environment.SIMPROOF_DATABASE_PATH,
    SIMPROOF_ARTIFACT_ROOT: environment.SIMPROOF_ARTIFACT_ROOT,
    SIMPROOF_ADMIN_BOOTSTRAP_SECRET: environment.SIMPROOF_ADMIN_BOOTSTRAP_SECRET,
    SIMPROOF_SESSION_SECRET: environment.SIMPROOF_SESSION_SECRET,
    SIMPROOF_LOCAL_AUTH_BYPASS: environment.SIMPROOF_LOCAL_AUTH_BYPASS,
    SIMPROOF_ALLOWED_ORIGINS: environment.SIMPROOF_ALLOWED_ORIGINS,
    SIMPROOF_TRUSTED_PROXY_ADDRESS: environment.SIMPROOF_TRUSTED_PROXY_ADDRESS,
    SIMPROOF_SESSION_TTL_SECONDS: environment.SIMPROOF_SESSION_TTL_SECONDS,
    SIMPROOF_SESSION_IDLE_SECONDS: environment.SIMPROOF_SESSION_IDLE_SECONDS,
    SIMPROOF_MAX_ACTIVE_SESSIONS: environment.SIMPROOF_MAX_ACTIVE_SESSIONS,
    SIMPROOF_MAX_REQUEST_BYTES: environment.SIMPROOF_MAX_REQUEST_BYTES,
    SIMPROOF_MAX_PROMPT_CHARACTERS: environment.SIMPROOF_MAX_PROMPT_CHARACTERS,
    SIMPROOF_PROMPT_RETENTION: environment.SIMPROOF_PROMPT_RETENTION,
    SIMPROOF_DEMO_GENERATION: environment.SIMPROOF_DEMO_GENERATION,
    SIMPROOF_TELEMETRY_ENABLED: environment.SIMPROOF_TELEMETRY_ENABLED,
    SIMPROOF_TELEMETRY_ENDPOINT: environment.SIMPROOF_TELEMETRY_ENDPOINT,
    SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED: environment.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED,
    SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT: environment.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT,
    SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN: environment.SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN,
    SIMPROOF_DIAGNOSTIC_LOG_ROOT: environment.SIMPROOF_DIAGNOSTIC_LOG_ROOT,
    SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES: environment.SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES,
    SIMPROOF_DIAGNOSTIC_LOG_FILES: environment.SIMPROOF_DIAGNOSTIC_LOG_FILES,
    SIMPROOF_RUNNER_ENDPOINT: environment.SIMPROOF_RUNNER_ENDPOINT,
    SIMPROOF_RUNNER_TOKEN: environment.SIMPROOF_RUNNER_TOKEN,
    SIMPROOF_RUNNER_IMAGE: environment.SIMPROOF_RUNNER_IMAGE,
    SIMPROOF_RUNNER_VERSION: environment.SIMPROOF_RUNNER_VERSION,
  }
}
