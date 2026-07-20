import { randomUUID } from 'node:crypto'

import { type EducatorGenerationStartRequest, generationRequestSchema } from '@simproof/contracts'
import { CorrelationContext } from '@simproof/observability'
import {
  ArtifactStore,
  AuthRepository,
  type InstalledEvidenceResolver,
  type PersistenceDatabase,
  PrivacyRepository,
} from '@simproof/persistence'
import { initializePersistence } from './application-persistence.js'
import { updatePrivacy } from './application-privacy-input.js'
import { verifyPassword } from './auth/password.js'
import { AuthService } from './auth/service.js'
import { ConfigurationError, parseEnvironment, type ServerConfig } from './config/environment.js'
import { createEducatorService } from './educator/service.js'
import type { EducatorGenerationRuntime } from './generation/educator-generation-adapter.js'
import type { GenerationService } from './generation/generation-service.js'
import type { ProductionGenerationOption } from './generation/production-composition.js'
import { createHttpApi } from './http/boundary.js'
import type { HttpOperationResult, HttpRequest, HttpResponse } from './http/types.js'
import {
  createObservabilityRuntime,
  type ObservabilityRuntime,
} from './operations/observability-runtime.js'
import {
  createReadinessService,
  probeArtifactStore,
  probeConfiguration,
  probeDatabase,
  type ReadinessProbe,
  type ReadinessProbes,
} from './operations/readiness.js'
import { PrivacyService } from './privacy/service.js'

export interface OrchestratorApplication {
  readonly config: ServerConfig
  readonly api: { handle(request: HttpRequest): Promise<HttpResponse> }
  close(): Promise<void>
}

type GenerationRuntime = Pick<GenerationService, 'cancel' | 'start'> &
  Partial<Pick<GenerationService, 'close'>>

export interface ApplicationOptions {
  readonly correlationContext?: CorrelationContext
  readonly observability?: ObservabilityRuntime
  readonly readiness?: Partial<Pick<ReadinessProbes, 'artifacts' | 'configuration' | 'database'>>
  readonly generation?: {
    readonly resolveInstalledEvidence: InstalledEvidenceResolver
    readonly runnerReadiness: ReadinessProbe
    readonly create: (input: {
      readonly database: PersistenceDatabase
      readonly artifacts: ArtifactStore
      readonly observability: ObservabilityRuntime['generation']
    }) => GenerationRuntime
  }
  readonly educatorGeneration?: ProductionGenerationOption
}

export function createOrchestratorApplication(
  environment: Readonly<Record<string, string | undefined>>,
  options: ApplicationOptions = {},
): OrchestratorApplication {
  return createApplication(parseEnvironment(environment), options)
}

export function createApplication(
  config: ServerConfig,
  options: ApplicationOptions = {},
): OrchestratorApplication {
  requireApplicationSecrets(config)
  const { correlationContext, observability } = applicationObservability(config, options)
  const database = initializePersistence(
    config,
    options.educatorGeneration?.resolveInstalledEvidence ??
      options.generation?.resolveInstalledEvidence,
    observability,
  )
  const authRepository = new AuthRepository(database.path)
  const privacyRepository = new PrivacyRepository(database.path)
  const artifacts = new ArtifactStore(config.artifactRoot)
  const generation = options.generation?.create({
    database,
    artifacts,
    observability: observability.generation,
  })
  const auth = new AuthService(authRepository, {
    bootstrapSecret: config.adminBootstrapSecret,
    sessionSecret: config.sessionSecret,
    sessionTtlSeconds: config.session.ttlSeconds,
    sessionIdleSeconds: config.session.idleSeconds,
    maxActiveSessions: config.session.maxActiveSessions,
  })
  const confirmPassword = async (password: string) => {
    if (config.localAuthBypass) return true
    const administrator = authRepository.administrator()
    return administrator.ok && (await verifyPassword(password, administrator.value))
  }
  const privacy = new PrivacyService({
    database,
    artifacts,
    privacy: privacyRepository,
    confirmPassword,
    telemetryEnabled: config.privacy.telemetryEnabled,
    externalDiagnosticsAllowed: config.privacy.externalDiagnosticsEnabled,
  })
  const educatorGeneration = options.educatorGeneration?.create({
    database,
    artifacts,
    observability: observability.generation,
    recordPromptDecision: (request, runId) => recordPromptDecision(privacy, request, runId),
  })
  const educator = createEducatorService({
    database,
    artifacts,
    config,
    bootstrapAvailable: () => {
      const administrator = authRepository.administrator()
      return !administrator.ok && administrator.error.code === 'not-found'
    },
    authorizeSession: () => true, // The HTTP boundary authenticates educator routes first.
    confirmPassword,
    createId: randomUUID,
    now: () => new Date().toISOString(),
    ...(options.generation === undefined
      ? options.educatorGeneration === undefined
        ? {}
        : { resolveInstalledEvidence: options.educatorGeneration.resolveInstalledEvidence }
      : { resolveInstalledEvidence: options.generation.resolveInstalledEvidence }),
    ...(educatorGeneration === undefined ? {} : { generation: educatorGeneration }),
    ...(options.educatorGeneration?.findingExplainer === undefined
      ? {}
      : { findingExplainer: options.educatorGeneration.findingExplainer }),
  })
  const readiness = applicationReadiness(config, database, artifacts, options)
  const api = createHttpApi({
    auth,
    config,
    correlationContext,
    logger: observability.logger,
    callbacks: {
      health: () => ({ status: 'ok' }),
      readiness: () => readiness.check(),
      getPrivacy: () => privacy.settings(),
      updatePrivacy: (value) => updatePrivacy(privacy, value),
      exportData: (password) => privacy.exportAll(password),
      deleteSimulation: (simulationId, password) =>
        privacy.deleteSimulation(simulationId, password),
      startGeneration: (value) => startGeneration(generation, privacy, value),
      cancelGeneration: (idempotencyKey) =>
        generation?.cancel(idempotencyKey) ?? unavailableGeneration(),
      educator,
    },
  })
  let closing: Promise<void> | undefined
  return {
    config,
    api,
    close: () => {
      if (closing !== undefined) return closing
      closing = closeApplication({
        generation,
        educatorGeneration,
        privacyRepository,
        authRepository,
        database,
        observability,
      })
      return closing
    },
  }
}

function requireApplicationSecrets(config: ServerConfig): asserts config is ServerConfig & {
  readonly adminBootstrapSecret: string
  readonly sessionSecret: string
} {
  if (config.adminBootstrapSecret === undefined || config.sessionSecret === undefined) {
    throw new ConfigurationError([
      ...(config.adminBootstrapSecret === undefined ? ['SIMPROOF_ADMIN_BOOTSTRAP_SECRET'] : []),
      ...(config.sessionSecret === undefined ? ['SIMPROOF_SESSION_SECRET'] : []),
    ])
  }
}

function applicationObservability(
  config: ServerConfig,
  options: ApplicationOptions,
): {
  readonly correlationContext: CorrelationContext
  readonly observability: ObservabilityRuntime
} {
  if (
    options.observability !== undefined &&
    options.correlationContext !== undefined &&
    options.observability.context !== options.correlationContext
  ) {
    throw new TypeError('Application correlation context must be shared by observability.')
  }
  const correlationContext =
    options.observability?.context ?? options.correlationContext ?? new CorrelationContext()
  const observability =
    options.observability ?? createObservabilityRuntime(config, { context: correlationContext })
  return { correlationContext, observability }
}

async function closeApplication(input: {
  readonly generation: GenerationRuntime | undefined
  readonly educatorGeneration: EducatorGenerationRuntime | undefined
  readonly privacyRepository: PrivacyRepository
  readonly authRepository: AuthRepository
  readonly database: PersistenceDatabase
  readonly observability: ObservabilityRuntime
}): Promise<void> {
  try {
    await Promise.all([input.generation?.close?.(), input.educatorGeneration?.close()])
  } finally {
    try {
      input.privacyRepository.close()
      input.authRepository.close()
      input.database.close()
    } finally {
      await input.observability.close()
    }
  }
}

function applicationReadiness(
  config: ServerConfig,
  database: PersistenceDatabase,
  artifacts: ArtifactStore,
  options: ApplicationOptions,
) {
  return createReadinessService({
    configuration: options.readiness?.configuration ?? (() => probeConfiguration(config)),
    database: options.readiness?.database ?? (() => probeDatabase(database)),
    artifacts: options.readiness?.artifacts ?? (() => probeArtifactStore(artifacts)),
    runnerRequired: options.generation !== undefined || options.educatorGeneration !== undefined,
    ...(options.educatorGeneration !== undefined
      ? { runner: options.educatorGeneration.runnerReadiness }
      : options.generation === undefined
        ? {}
        : { runner: options.generation.runnerReadiness }),
  })
}

function recordPromptDecision(
  privacy: PrivacyService,
  request: EducatorGenerationStartRequest,
  runId: string,
): void {
  if (request.teacher.promptRetention === 'discard') return
  const retained = privacy.retainGenerationPrompt({
    generationRunId: runId,
    simulationVersionId: request.simulationVersionId,
    prompt: request.teacher.prompt,
  })
  if (!retained.ok) throw new TypeError('Prompt retention decision could not be recorded.')
}

function unavailableGeneration(): HttpOperationResult<never> {
  return {
    ok: false,
    error: { code: 'operation-failed', message: 'Generation service is unavailable.' },
  }
}

async function startGeneration(
  generation: Pick<GenerationService, 'start'> | undefined,
  privacy: PrivacyService,
  value: unknown,
): Promise<HttpOperationResult<unknown>> {
  if (generation === undefined) return unavailableGeneration()
  const request = generationRequestSchema.safeParse(value)
  if (!request.success) {
    return { ok: false, error: { code: 'invalid-input', message: 'Generation input is invalid.' } }
  }
  const started = await generation.start(request.data)
  if (!started.ok) return started
  const retained = privacy.retainGenerationPrompt({
    generationRunId: started.value.id,
    simulationVersionId: request.data.simulationVersionId,
    prompt: request.data.prompt,
  })
  return retained.ok ? started : retained
}
