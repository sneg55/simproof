import {
  createRedactor,
  type OperationalErrorId,
  type OperationalSignal,
  operationalErrorIdSchema,
  operationalSignalSchema,
  type SensitiveValues,
} from '@simproof/observability'
import { z } from 'zod'

import { KNOWN_ENVIRONMENT_KEYS } from '../config/environment-schema.js'

const timestampSchema = z.iso.datetime({ offset: true })
const versionSchema = z.string().trim().min(1).max(100)
const MAX_RECENT_ERROR_INPUTS = 10_000
const MAX_STABLE_ERROR_ENTRIES = 100
const MAX_RECENT_LOG_INPUTS = 10_000

export const diagnosticVersionsSchema = z
  .object({
    simproof: versionSchema,
    orchestrator: versionSchema,
    observability: versionSchema,
    persistence: versionSchema,
    runner: versionSchema,
    verifier: versionSchema,
    node: versionSchema,
    runnerProtocol: z.literal('1'),
    databaseSchema: z.number().int().nonnegative().max(1_000_000),
  })
  .strict()

const configurationPresenceSchema = z
  .object({
    databasePathConfigured: z.boolean(),
    artifactRootConfigured: z.boolean(),
    adminBootstrapSecretPresent: z.boolean(),
    sessionSecretPresent: z.boolean(),
    openaiCredentialPresent: z.boolean(),
    codexCredentialPresent: z.boolean(),
    allowedOriginsConfigured: z.boolean(),
    trustedProxyConfigured: z.boolean(),
    telemetryEnabled: z.boolean(),
    telemetryEndpointConfigured: z.boolean(),
    externalDiagnosticsEnabled: z.boolean(),
    externalDiagnosticsEndpointConfigured: z.boolean(),
    externalDiagnosticsTokenPresent: z.boolean(),
    diagnosticLogRootConfigured: z.boolean(),
    diagnosticLogMaxBytesConfigured: z.boolean(),
    diagnosticLogFilesConfigured: z.boolean(),
    unknownSimproofKeyPresent: z.boolean(),
  })
  .strict()

const migrationStatusSchema = z
  .object({
    status: z.enum(['current', 'drifted', 'missing', 'unavailable']),
    expectedVersion: z.number().int().nonnegative().max(1_000_000),
    appliedVersions: z.array(z.number().int().positive().max(1_000_000)).max(1_000),
    checksumValid: z.boolean().nullable(),
  })
  .strict()

const readinessErrorSchema = z.enum([
  'configuration.invalid',
  'migration.failed',
  'database.unavailable',
  'artifact-store.unavailable',
  'runner.unavailable',
])

export const diagnosticReadinessSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }).strict(),
  z.object({ status: z.literal('not-ready'), errorId: readinessErrorSchema }).strict(),
])

const stableErrorEntrySchema = z
  .object({
    stableErrorId: operationalErrorIdSchema,
    count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    lastObservedAt: timestampSchema,
  })
  .strict()

const excludedCategorySchema = z.enum([
  'environment-values',
  'credentials',
  'authentication-records',
  'cookies',
  'prompts',
  'generated-content',
  'artifact-content',
  'provider-responses',
  'reasoning',
])

export const diagnosticBundleSchema = z
  .object({
    schemaVersion: z.literal('1'),
    bundleId: z.uuid(),
    createdAt: timestampSchema,
    versions: diagnosticVersionsSchema,
    configuration: z.object({ valid: z.boolean(), presence: configurationPresenceSchema }).strict(),
    migration: migrationStatusSchema,
    readiness: diagnosticReadinessSchema,
    stableErrors: z
      .object({
        entries: z.array(stableErrorEntrySchema).max(MAX_STABLE_ERROR_ENTRIES),
        unregisteredCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    logs: z
      .object({
        events: z.array(operationalSignalSchema).max(500),
        rejectedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        truncated: z.boolean(),
      })
      .strict()
      .optional(),
    excludedCategories: z
      .array(excludedCategorySchema)
      .length(9)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict()

export type DiagnosticBundle = z.infer<typeof diagnosticBundleSchema>
export type DiagnosticVersions = z.infer<typeof diagnosticVersionsSchema>
export type DiagnosticMigrationStatus = z.infer<typeof migrationStatusSchema>
export type DiagnosticReadiness = z.infer<typeof diagnosticReadinessSchema>

export interface RecentStableErrorInput {
  readonly stableErrorId: string
  readonly count: number
  readonly lastObservedAt: string
}

export interface DiagnosticBundleInput {
  readonly bundleId: string
  readonly createdAt: string
  readonly versions: DiagnosticVersions
  readonly configurationValid: boolean
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly migration: DiagnosticMigrationStatus
  readonly readiness: DiagnosticReadiness
  readonly recentStableErrors: readonly RecentStableErrorInput[]
  readonly recentLogs: readonly unknown[]
  readonly recentLogRejectedCount?: number
  readonly recentLogsTruncated?: boolean
  readonly includeLogs: boolean
  readonly maxLogEvents: number
  readonly sensitiveValues?: SensitiveValues
}

const knownEnvironmentKeys: ReadonlySet<string> = new Set(KNOWN_ENVIRONMENT_KEYS)

const present = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): boolean => {
  const value = Reflect.get(environment, name)
  return typeof value === 'string' && value.length > 0
}

function configurationPresence(environment: Readonly<Record<string, string | undefined>>) {
  return {
    databasePathConfigured: present(environment, 'SIMPROOF_DATABASE_PATH'),
    artifactRootConfigured: present(environment, 'SIMPROOF_ARTIFACT_ROOT'),
    adminBootstrapSecretPresent: present(environment, 'SIMPROOF_ADMIN_BOOTSTRAP_SECRET'),
    sessionSecretPresent: present(environment, 'SIMPROOF_SESSION_SECRET'),
    openaiCredentialPresent: present(environment, 'OPENAI_API_KEY'),
    codexCredentialPresent: present(environment, 'CODEX_API_KEY'),
    allowedOriginsConfigured: present(environment, 'SIMPROOF_ALLOWED_ORIGINS'),
    trustedProxyConfigured: present(environment, 'SIMPROOF_TRUSTED_PROXY_ADDRESS'),
    telemetryEnabled: environment.SIMPROOF_TELEMETRY_ENABLED === 'true',
    telemetryEndpointConfigured: present(environment, 'SIMPROOF_TELEMETRY_ENDPOINT'),
    externalDiagnosticsEnabled: environment.SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED === 'true',
    externalDiagnosticsEndpointConfigured: present(
      environment,
      'SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT',
    ),
    externalDiagnosticsTokenPresent: present(environment, 'SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN'),
    diagnosticLogRootConfigured: present(environment, 'SIMPROOF_DIAGNOSTIC_LOG_ROOT'),
    diagnosticLogMaxBytesConfigured: present(environment, 'SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES'),
    diagnosticLogFilesConfigured: present(environment, 'SIMPROOF_DIAGNOSTIC_LOG_FILES'),
    unknownSimproofKeyPresent: Object.keys(environment).some(
      (name) => name.startsWith('SIMPROOF_') && !knownEnvironmentKeys.has(name),
    ),
  }
}

const rawStableErrorSchema = z
  .object({
    stableErrorId: z.string().min(1).max(10_000),
    count: z.number().int().positive().max(1_000_000_000),
    lastObservedAt: timestampSchema,
  })
  .strict()

function stableErrors(inputs: readonly RecentStableErrorInput[]) {
  const values = z.array(rawStableErrorSchema).max(MAX_RECENT_ERROR_INPUTS).parse(inputs)
  const registered = new Map<OperationalErrorId, { count: number; lastObservedAt: string }>()
  let unregisteredCount = 0
  for (const value of values) {
    const errorId = operationalErrorIdSchema.safeParse(value.stableErrorId)
    if (!errorId.success) {
      unregisteredCount += value.count
      continue
    }
    const previous = registered.get(errorId.data)
    registered.set(errorId.data, {
      count: (previous?.count ?? 0) + value.count,
      lastObservedAt:
        previous === undefined || value.lastObservedAt > previous.lastObservedAt
          ? value.lastObservedAt
          : previous.lastObservedAt,
    })
  }
  const entries = [...registered]
    .map(([stableErrorId, value]) => ({ stableErrorId, ...value }))
    .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt))
    .slice(0, MAX_STABLE_ERROR_ENTRIES)
  return { entries, unregisteredCount }
}

function logs(input: DiagnosticBundleInput): DiagnosticBundle['logs'] {
  if (!input.includeLogs) return undefined
  const maximum = z.number().int().min(1).max(500).parse(input.maxLogEvents)
  if (input.recentLogs.length > MAX_RECENT_LOG_INPUTS) {
    throw new RangeError('Recent diagnostic log input exceeds its collection bound.')
  }
  const candidates = input.recentLogs.slice(-maximum)
  const redactor = createRedactor(input.sensitiveValues)
  const events: OperationalSignal[] = []
  let rejectedCount = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - MAX_RECENT_LOG_INPUTS)
    .parse(input.recentLogRejectedCount ?? 0)
  for (const candidate of candidates) {
    const parsed = operationalSignalSchema.safeParse(redactor.redactValue(candidate))
    if (!parsed.success) rejectedCount += 1
    else events.push(parsed.data)
  }
  return {
    events,
    rejectedCount,
    truncated: input.recentLogsTruncated === true || input.recentLogs.length > maximum,
  }
}

const excludedCategories = [
  'environment-values',
  'credentials',
  'authentication-records',
  'cookies',
  'prompts',
  'generated-content',
  'artifact-content',
  'provider-responses',
  'reasoning',
] as const

export function createDiagnosticBundle(input: DiagnosticBundleInput): DiagnosticBundle {
  const logSection = logs(input)
  return diagnosticBundleSchema.parse({
    schemaVersion: '1',
    bundleId: input.bundleId,
    createdAt: input.createdAt,
    versions: diagnosticVersionsSchema.parse(input.versions),
    configuration: {
      valid: input.configurationValid,
      presence: configurationPresence(input.environment),
    },
    migration: migrationStatusSchema.parse(input.migration),
    readiness: diagnosticReadinessSchema.parse(input.readiness),
    stableErrors: stableErrors(input.recentStableErrors),
    ...(logSection === undefined ? {} : { logs: logSection }),
    excludedCategories,
  })
}
