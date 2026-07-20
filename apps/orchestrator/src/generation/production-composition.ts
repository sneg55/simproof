import { randomUUID } from 'node:crypto'

import type {
  EducatorGenerationStartRequest,
  VerificationDependencyBinding,
} from '@simproof/contracts'
import type {
  ArtifactStore,
  InstalledEvidenceResolver,
  PersistenceDatabase,
} from '@simproof/persistence'
import {
  type CodeGenerator,
  CodexCodeGenerator,
  type ConceptCompiler,
  createOpenAIResponsesConceptCompiler,
  createOpenAIResponsesFindingExplainer,
  type FindingExplainer,
} from '@simproof/providers'
import { hashCanonicalJson } from '@simproof/verifier'

import type { ServerConfig } from '../config/environment.js'
import type { ObservabilityRuntime } from '../operations/observability-runtime.js'
import type { ReadinessProbe } from '../operations/readiness.js'
import { createDurableGenerationComposition } from './composition.js'
import {
  createEducatorGenerationAdapter,
  type EducatorGenerationRuntime,
} from './educator-generation-adapter.js'
import { createInstalledVerificationAuthorityResolver } from './installed-verification-authority.js'
import { createRemoteRunnerService, type RunnerHttpTransport } from './remote-runner-service.js'
import { ReverificationService } from './reverification-service.js'
import { createTrustedRunnerAdapter } from './trusted-runner-adapter.js'
import { createTrustedVerifierAdapter } from './trusted-verifier-adapter.js'

const CONCEPT_RESERVATION = { inputTokens: 12_000, outputTokens: 3_000 } as const
const CODE_RESERVATION = { inputTokens: 32_000, outputTokens: 8_000 } as const
const RUNNER_LIMITS = {
  memoryBytes: 134_217_728,
  timeoutMs: 5_000,
  maxOutputBytes: 1_048_576,
  maxSamples: 1_000,
} as const

interface ProviderConfig {
  readonly apiKey: string
  readonly model: string
  readonly templateVersion: string
  readonly estimateCostMicrousd: (usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }) => number
  readonly failedCallUsage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costMicrousd: number
  }
}

export interface ProductionGenerationDependencies {
  readonly runnerTransport?: RunnerHttpTransport
  readonly createConceptCompiler?: (
    config: ProviderConfig & { compileReservation: Reservation },
  ) => ConceptCompiler
  readonly createCodeGenerator?: (
    config: ProviderConfig & {
      readonly workspaceRoot: string
      readonly stateRoot: string
      readonly environment: Readonly<Record<string, string>>
      readonly forbiddenWorkspaceRoots: readonly string[]
      readonly forbiddenStateRoots: readonly string[]
      readonly generateReservation: Reservation
      readonly repairReservation: Reservation
    },
  ) => CodeGenerator
}

interface Reservation {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requestCount: 1
  readonly costMicrousd: number
}

export interface ProductionGenerationOption {
  readonly resolveInstalledEvidence: InstalledEvidenceResolver
  readonly runnerReadiness: ReadinessProbe
  readonly findingExplainer?: FindingExplainer
  readonly create: (input: {
    readonly database: PersistenceDatabase
    readonly artifacts: ArtifactStore
    readonly observability: ObservabilityRuntime['generation']
    readonly recordPromptDecision: (
      request: EducatorGenerationStartRequest,
      runId: string,
    ) => Promise<void> | void
  }) => EducatorGenerationRuntime | undefined
}

type ProductionCreateInput = Parameters<ProductionGenerationOption['create']>[0]

const estimate = (
  pricing: { readonly inputMicrousdPerMillion: number; readonly outputMicrousdPerMillion: number },
  usage: { readonly inputTokens: number; readonly outputTokens: number },
) =>
  Math.ceil(
    (usage.inputTokens * pricing.inputMicrousdPerMillion +
      usage.outputTokens * pricing.outputMicrousdPerMillion) /
      1_000_000,
  )

function providerConfig(
  apiKey: string,
  model: string,
  pricing: { readonly inputMicrousdPerMillion: number; readonly outputMicrousdPerMillion: number },
  failed: typeof CONCEPT_RESERVATION | typeof CODE_RESERVATION,
): ProviderConfig {
  return {
    apiKey,
    model,
    templateVersion: '1.0.0',
    estimateCostMicrousd: (usage) => estimate(pricing, usage),
    failedCallUsage: { ...failed, costMicrousd: estimate(pricing, failed) },
  }
}

function reservation(
  pricing: { readonly inputMicrousdPerMillion: number; readonly outputMicrousdPerMillion: number },
  usage: typeof CONCEPT_RESERVATION | typeof CODE_RESERVATION,
): Reservation {
  return { ...usage, requestCount: 1, costMicrousd: estimate(pricing, usage) }
}

function dependencyBinding(runnerVersion: string): VerificationDependencyBinding {
  const entries = [
    {
      id: 'trusted-verifier',
      version: '1.0.0',
      contentHash: hashCanonicalJson({
        implementation: 'simproof-verifier',
        version: '1.0.0',
        runnerVersion,
      }),
    },
  ]
  return { schemaVersion: '1', entries, contentHash: hashCanonicalJson(entries) }
}

export function createProductionGenerationOption(
  config: ServerConfig,
  dependencies: ProductionGenerationDependencies = {},
): ProductionGenerationOption | undefined {
  if (config.runner === undefined) return undefined
  const runnerConfig = config.runner
  const runnerBinding = { version: runnerConfig.version, protocolVersion: '1' as const }
  const remote = createRemoteRunnerService({
    endpoint: runnerConfig.endpoint,
    token: runnerConfig.token,
    image: runnerConfig.image,
    ...(dependencies.runnerTransport === undefined
      ? {}
      : { transport: dependencies.runnerTransport }),
  })
  const dependenciesBinding = dependencyBinding(runnerConfig.version)
  const trustedRunner = createTrustedRunnerAdapter({
    service: remote,
    runner: runnerBinding,
    limits: RUNNER_LIMITS,
  })
  const verifier = createTrustedVerifierAdapter({
    runner: runnerBinding,
    dependencies: dependenciesBinding,
  })
  const createReverification = ({ artifacts, database, observability }: ProductionCreateInput) =>
    new ReverificationService({
      database,
      store: artifacts,
      runner: trustedRunner,
      verifier,
      id: randomUUID,
      now: () => new Date().toISOString(),
      signals: observability,
    })
  const base = {
    resolveInstalledEvidence: createInstalledVerificationAuthorityResolver({
      runner: runnerBinding,
      dependencies: dependenciesBinding,
    }),
    runnerReadiness: async () =>
      (await remote.readiness())
        ? { ok: true as const }
        : { ok: false as const, errorId: 'runner.unavailable' as const },
  }
  if (
    config.generation === undefined ||
    config.providers.openaiApiKey === undefined ||
    config.providers.codexApiKey === undefined
  ) {
    return Object.freeze({
      ...base,
      create: (input: ProductionCreateInput) =>
        createEducatorGenerationAdapter(undefined, createReverification(input)),
    })
  }
  const generation = config.generation
  const openai = providerConfig(
    config.providers.openaiApiKey,
    generation.openaiModel,
    generation.openaiPricing,
    CONCEPT_RESERVATION,
  )
  const codex = providerConfig(
    config.providers.codexApiKey,
    generation.codexModel,
    generation.codexPricing,
    CODE_RESERVATION,
  )
  const forbiddenDataRoots = [
    process.cwd(),
    config.databasePath,
    config.artifactRoot,
    config.observability.diagnosticLogRoot,
  ]
  const codexIsolation = {
    // The Codex CLI env replaces process.env, so it must carry the CA bundle path
    // for the native TLS client to verify the model API endpoint.
    environment: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
    },
    forbiddenWorkspaceRoots: [...forbiddenDataRoots, generation.codexStateRoot],
    forbiddenStateRoots: [...forbiddenDataRoots, generation.codexWorkspaceRoot],
  }
  const conceptCompiler =
    dependencies.createConceptCompiler?.({
      ...openai,
      compileReservation: reservation(generation.openaiPricing, CONCEPT_RESERVATION),
    }) ??
    createOpenAIResponsesConceptCompiler({
      ...openai,
      compileReservation: reservation(generation.openaiPricing, CONCEPT_RESERVATION),
    })
  const codeGenerator =
    dependencies.createCodeGenerator?.({
      ...codex,
      workspaceRoot: generation.codexWorkspaceRoot,
      stateRoot: generation.codexStateRoot,
      ...codexIsolation,
      generateReservation: reservation(generation.codexPricing, CODE_RESERVATION),
      repairReservation: reservation(generation.codexPricing, CODE_RESERVATION),
    }) ??
    new CodexCodeGenerator({
      ...codex,
      workspaceRoot: generation.codexWorkspaceRoot,
      stateRoot: generation.codexStateRoot,
      ...codexIsolation,
      generateReservation: reservation(generation.codexPricing, CODE_RESERVATION),
      repairReservation: reservation(generation.codexPricing, CODE_RESERVATION),
    })
  return Object.freeze({
    ...base,
    findingExplainer: createOpenAIResponsesFindingExplainer({
      ...openai,
      explainReservation: reservation(generation.openaiPricing, CONCEPT_RESERVATION),
    }),
    create: (input: ProductionCreateInput) =>
      createEducatorGenerationAdapter(
        createDurableGenerationComposition({
          database: input.database,
          store: input.artifacts,
          observability: input.observability,
          recordPromptDecision: input.recordPromptDecision,
          conceptCompiler,
          codeGenerator,
          runner: trustedRunner,
          verifier,
          id: randomUUID,
          now: () => new Date().toISOString(),
        }),
        createReverification(input),
      ),
  })
}
