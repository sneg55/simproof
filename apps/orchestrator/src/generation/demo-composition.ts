import { randomUUID } from 'node:crypto'

import type {
  RunnerRequest,
  RunnerResponse,
  VerificationDependencyBinding,
} from '@simproof/contracts'
import type { InstalledEvidenceResolver } from '@simproof/persistence'
import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { hashCanonicalJson } from '@simproof/verifier'

import { createDurableGenerationComposition } from './composition.js'
import {
  createEducatorGenerationAdapter,
  type EducatorGenerationRuntime,
} from './educator-generation-adapter.js'
import { createInstalledVerificationAuthorityResolver } from './installed-verification-authority.js'
import type { ProductionGenerationOption } from './production-composition.js'
import { ReverificationService } from './reverification-service.js'
import type { RunnerServicePort } from './runner-service-port.js'
import { createTrustedRunnerAdapter } from './trusted-runner-adapter.js'
import { createTrustedVerifierAdapter } from './trusted-verifier-adapter.js'

const STANDARD_GRAVITY = 9.80665
const RUNNER_BINDING = { version: '1.0.0', protocolVersion: '1' as const }
const RUNNER_LIMITS = {
  memoryBytes: 134_217_728,
  timeoutMs: 5_000,
  maxOutputBytes: 1_048_576,
  maxSamples: 1_000,
} as const

type CreateInput = Parameters<ProductionGenerationOption['create']>[0]

/**
 * Returns a canned, verifier-passing pendulum response for the requested inputs.
 * No candidate code executes: the demo returns the trusted-model period for each
 * input directly, so the isolation boundary is never crossed. The real verifier
 * still checks this output against trusted policy, so a passing demo run earns a
 * genuine verdict from application-owned science.
 */
function demoRunnerResponse(request: RunnerRequest): RunnerResponse {
  if (request.domain !== 'pendulum') {
    throw new TypeError('Demo generation only supports the pendulum domain.')
  }
  return {
    protocolVersion: '1',
    requestId: request.requestId,
    domain: 'pendulum',
    observedArtifactHash: request.artifact.hash,
    exit: { classification: 'success', errorId: null },
    samples: request.inputs.map(({ input, sampleId }) => ({
      sampleId,
      observation: {
        input,
        periodS: 2 * Math.PI * Math.sqrt(input.lengthM / STANDARD_GRAVITY),
      },
    })),
    diagnostics: [],
  }
}

function demoDependencyBinding(): VerificationDependencyBinding {
  const entries = [
    {
      id: 'trusted-verifier',
      version: '1.0.0',
      contentHash: hashCanonicalJson({
        implementation: 'simproof-verifier',
        version: '1.0.0',
        runnerVersion: RUNNER_BINDING.version,
      }),
    },
  ]
  return { schemaVersion: '1', entries, contentHash: hashCanonicalJson(entries) }
}

/**
 * The fenced demo generation option. Only start.ts selects it, and only when
 * `config.demoGeneration` is true (demo requested with no real provider). It
 * wires the scripted provider through the real trusted verifier and a canned
 * runner, so a full generate to verified run completes with no credentials.
 */
export function createDemoGenerationOption(): ProductionGenerationOption {
  const dependencies = demoDependencyBinding()
  const execute: RunnerServicePort['execute'] = (input) =>
    Promise.resolve(demoRunnerResponse(input as RunnerRequest))
  const runner = createTrustedRunnerAdapter({
    service: { execute },
    runner: RUNNER_BINDING,
    limits: RUNNER_LIMITS,
  })
  const verifier = createTrustedVerifierAdapter({ runner: RUNNER_BINDING, dependencies })
  const createReverification = ({ artifacts, database, observability }: CreateInput) =>
    new ReverificationService({
      database,
      store: artifacts,
      runner,
      verifier,
      id: randomUUID,
      now: () => new Date().toISOString(),
      signals: observability,
    })
  return Object.freeze({
    resolveInstalledEvidence: createInstalledVerificationAuthorityResolver({
      runner: RUNNER_BINDING,
      dependencies,
    }) satisfies InstalledEvidenceResolver,
    runnerReadiness: () => Promise.resolve({ ok: true as const }),
    findingExplainer: createScriptedFakeProvider(fakeProviderScenarios.correct),
    create: (input: CreateInput): EducatorGenerationRuntime =>
      createEducatorGenerationAdapter(
        createDurableGenerationComposition({
          database: input.database,
          store: input.artifacts,
          observability: input.observability,
          recordPromptDecision: input.recordPromptDecision,
          conceptCompiler: createScriptedFakeProvider(fakeProviderScenarios.correct),
          codeGenerator: createScriptedFakeProvider(fakeProviderScenarios.correct),
          runner,
          verifier,
          id: randomUUID,
          now: () => new Date().toISOString(),
        }),
        createReverification(input),
      ),
  })
}
