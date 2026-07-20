import { type RunnerErrorId, runnerErrorIdSchema } from '@simproof/contracts'
import { z } from 'zod'

const httpErrorIds = [
  'http.authentication-failed',
  'http.auth-concurrency-limit',
  'http.auth-rate-limit',
  'http.body',
  'http.body-too-large',
  'http.bootstrap-denied',
  'http.content-encoding',
  'http.content-length',
  'http.content-type',
  'http.cors-headers-denied',
  'http.csrf-denied',
  'http.educator-conflict',
  'http.educator-not-found',
  'http.educator-unavailable',
  'http.generation-conflict',
  'http.generation-unavailable',
  'http.headers',
  'http.internal-error',
  'http.invalid-input',
  'http.invalid-request-target',
  'http.json',
  'http.login-denied',
  'http.origin-denied',
  'http.password-denied',
  'http.privacy-conflict',
  'http.revision-conflict',
  'http.route-not-found',
  'http.session-required',
  'http.unavailable',
] as const

const localOperationalErrorIds = [
  'configuration.invalid',
  'migration.failed',
  'database.unavailable',
  'artifact-store.unavailable',
  'generation.cancelled',
  'generation.budget-exhausted',
  'provider.authentication-failed',
  'provider.quota-exceeded',
  'provider.transient-failure',
  'provider.malformed-response',
  'runner.unavailable',
  'runner.policy-denied',
  'runner.resource-limit',
  'runner.execution-failed',
  'verifier.scientific-rejection',
  'orchestration.interrupted',
  'orchestration.invariant-failed',
  'request.invalid',
  'readiness.configuration-invalid',
  'readiness.database-unavailable',
  'readiness.artifact-root-unavailable',
  'readiness.runner-unavailable',
  'telemetry.export-not-configured',
  'telemetry.export-failed',
  'diagnostics.bundle-failed',
  'logging.event-too-large',
  'logging.storage-unsafe',
  'logging.write-failed',
  ...httpErrorIds,
] as const

const httpErrorIdSchema = z.enum(httpErrorIds)
const localOperationalErrorIdSchema = z.enum(localOperationalErrorIds)
export const operationalErrorIdSchema = z.union([
  localOperationalErrorIdSchema,
  runnerErrorIdSchema,
])
export type OperationalErrorId = z.infer<typeof operationalErrorIdSchema>
type LocalOperationalErrorId = z.infer<typeof localOperationalErrorIdSchema>

export interface OperationalErrorDefinition {
  readonly category:
    | 'artifact'
    | 'configuration'
    | 'database'
    | 'diagnostics'
    | 'generation'
    | 'http'
    | 'logging'
    | 'migration'
    | 'orchestration'
    | 'provider'
    | 'readiness'
    | 'request'
    | 'runner'
    | 'telemetry'
    | 'verification'
  readonly clientStatus: number
  readonly safeClientMessage: string
  readonly retryable: boolean
}

const definition = (
  category: OperationalErrorDefinition['category'],
  clientStatus: number,
  safeClientMessage: string,
  retryable: boolean,
): Readonly<OperationalErrorDefinition> =>
  Object.freeze({ category, clientStatus, safeClientMessage, retryable })

const httpStatuses = new Map<(typeof httpErrorIds)[number], number>([
  ['http.authentication-failed', 401],
  ['http.auth-concurrency-limit', 429],
  ['http.auth-rate-limit', 429],
  ['http.body-too-large', 413],
  ['http.bootstrap-denied', 403],
  ['http.content-encoding', 415],
  ['http.content-type', 415],
  ['http.cors-headers-denied', 403],
  ['http.csrf-denied', 403],
  ['http.educator-conflict', 409],
  ['http.educator-not-found', 404],
  ['http.educator-unavailable', 503],
  ['http.generation-conflict', 409],
  ['http.generation-unavailable', 503],
  ['http.internal-error', 500],
  ['http.login-denied', 403],
  ['http.origin-denied', 403],
  ['http.password-denied', 403],
  ['http.privacy-conflict', 409],
  ['http.revision-conflict', 409],
  ['http.route-not-found', 404],
  ['http.session-required', 401],
  ['http.unavailable', 503],
])

const specificDefinitions = new Map<LocalOperationalErrorId, OperationalErrorDefinition>([
  [
    'provider.authentication-failed',
    definition('provider', 503, 'The model provider rejected its server credential.', false),
  ],
  [
    'provider.quota-exceeded',
    definition('provider', 503, 'The model provider quota is exhausted.', false),
  ],
  [
    'provider.transient-failure',
    definition('provider', 503, 'The model provider is temporarily unavailable.', true),
  ],
  [
    'provider.malformed-response',
    definition('provider', 502, 'The model provider returned an invalid response.', false),
  ],
  ['runner.unavailable', definition('runner', 503, 'The isolated runner is unavailable.', true)],
  [
    'readiness.runner-unavailable',
    definition('readiness', 503, 'The isolated runner is unavailable.', true),
  ],
  [
    'runner.policy-denied',
    definition('runner', 422, 'The candidate was denied by runner policy.', false),
  ],
  [
    'runner.resource-limit',
    definition('runner', 422, 'The candidate exceeded an isolated runner limit.', false),
  ],
  [
    'runner.execution-failed',
    definition('runner', 502, 'The isolated runner could not complete the request.', true),
  ],
  [
    'verifier.scientific-rejection',
    definition(
      'verification',
      422,
      'The candidate did not satisfy trusted scientific verification.',
      false,
    ),
  ],
  ['generation.cancelled', definition('generation', 409, 'Generation was cancelled.', false)],
  [
    'generation.budget-exhausted',
    definition('generation', 422, 'The generation budget was exhausted.', false),
  ],
  [
    'telemetry.export-not-configured',
    definition('telemetry', 503, 'Telemetry export is not configured.', false),
  ],
  ['telemetry.export-failed', definition('telemetry', 503, 'Telemetry export failed.', true)],
])

const fallbackLocalDefinition = (errorId: LocalOperationalErrorId): OperationalErrorDefinition => {
  if (errorId.startsWith('readiness.')) {
    return definition('readiness', 503, 'The service is not ready.', true)
  }
  if (errorId.includes('artifact')) {
    return definition('artifact', 503, 'The artifact store is unavailable.', true)
  }
  if (errorId.includes('database')) {
    return definition('database', 503, 'The database is unavailable.', true)
  }
  if (errorId.includes('migration')) {
    return definition('migration', 503, 'Database migration failed.', false)
  }
  if (errorId.includes('configuration')) {
    return definition('configuration', 503, 'The service configuration is invalid.', false)
  }
  if (errorId.startsWith('diagnostics.')) {
    return definition('diagnostics', 500, 'The diagnostic bundle could not be created.', false)
  }
  if (errorId.startsWith('logging.')) {
    return definition('logging', 500, 'Local operational logging failed.', false)
  }
  if (errorId.startsWith('orchestration.')) {
    return definition(
      'orchestration',
      500,
      'The generation workflow could not be completed.',
      false,
    )
  }
  return definition('request', 400, 'The request is invalid.', false)
}

// Stable IDs may share safe public wording; raw causes remain on OperationalError only.
const localDefinition = (errorId: LocalOperationalErrorId): OperationalErrorDefinition => {
  const http = httpErrorIdSchema.safeParse(errorId)
  if (http.success) {
    return definition(
      'http',
      httpStatuses.get(http.data) ?? 400,
      'The request could not be completed.',
      false,
    )
  }
  return specificDefinitions.get(errorId) ?? fallbackLocalDefinition(errorId)
}

const localEntries = localOperationalErrorIds.map(
  (errorId) => [errorId, localDefinition(errorId)] as const,
)

export const operationalErrorRegistry = Object.freeze(
  Object.fromEntries(localEntries) as Readonly<
    Record<LocalOperationalErrorId, Readonly<OperationalErrorDefinition>>
  >,
)

const localDefinitions = new Map<LocalOperationalErrorId, OperationalErrorDefinition>(localEntries)

const runnerDefinition = (errorId: RunnerErrorId): OperationalErrorDefinition => {
  if (errorId.startsWith('runner.denied.')) {
    return definition('runner', 422, 'The candidate was denied by runner policy.', false)
  }
  if (errorId.startsWith('runner.limit.')) {
    return definition('runner', 422, 'The candidate exceeded an isolated runner limit.', false)
  }
  if (errorId.startsWith('runner.artifact.')) {
    return definition('runner', 422, 'The candidate artifact is invalid.', false)
  }
  if (errorId === 'runner.cancelled') {
    return definition('runner', 409, 'Runner execution was cancelled.', false)
  }
  return definition('runner', 502, 'The isolated runner could not complete the request.', false)
}

export const getOperationalErrorDefinition = (
  errorId: OperationalErrorId,
): OperationalErrorDefinition => {
  const local = localOperationalErrorIdSchema.safeParse(errorId)
  if (local.success) {
    return localDefinitions.get(local.data) ?? localDefinition(local.data)
  }
  return runnerDefinition(runnerErrorIdSchema.parse(errorId))
}
