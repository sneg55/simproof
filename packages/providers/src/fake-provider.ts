import type { ConceptSpec, FindingExplanation, ProviderProvenance } from '@simproof/contracts'

import { providerErrors, providerFailure } from './errors.js'
import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodeGenerator,
  CodeRepairRequest,
  ConceptCompilationRequest,
  ConceptCompiler,
  FindingExplainer,
  FindingExplanationRequest,
  GeneratedArtifactSet,
  ProviderCallOptions,
  ProviderCallReservation,
  ProviderDescriptor,
  ProviderResult,
} from './types.js'

export const fakeProviderScenarios = {
  correct: 'correct',
  malformed: 'malformed',
  authenticationFailure: 'authentication-failure',
  quotaFailure: 'quota-failure',
  transientFailure: 'transient-failure',
  generateInvariant: 'generate-invariant',
  overReservation: 'over-reservation',
  repairConvergence: 'repair-convergence',
  exhausted: 'exhausted',
} as const

export type FakeProviderScenario =
  (typeof fakeProviderScenarios)[keyof typeof fakeProviderScenarios]

const conceptSpec: ConceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Simple pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.2, max: 3 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
}

const goodCore = `export default Object.freeze({
  protocolVersion: '1',
  sample(input) {
    return Object.freeze({
      input: Object.freeze({ lengthM: input.lengthM, amplitudeDeg: input.amplitudeDeg }),
      periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.80665),
    })
  },
})`

const badCore = `export default Object.freeze({
  protocolVersion: '1',
  sample(input) {
    return Object.freeze({
      input: Object.freeze({ lengthM: input.lengthM, amplitudeDeg: input.amplitudeDeg }),
      periodS: 2 * Math.PI * (input.lengthM / 9.80665),
    })
  },
})`

const FAKE_CONCEPT_REQUEST_ID = 'fake-concept-1'

const fakeReservation: ProviderCallReservation = Object.freeze({
  inputTokens: 1,
  outputTokens: 1,
  requestCount: 1,
  costMicrousd: 1,
})

const artifacts = (core: string): GeneratedArtifactSet => ({
  core: { path: 'core.mjs', content: core },
  renderer: {
    path: 'renderer.json',
    content: JSON.stringify({ schemaVersion: '1', kind: 'pendulum', representation: 'svg' }),
  },
  manifest: {
    path: 'manifest.json',
    content: JSON.stringify({
      schemaVersion: '1',
      domain: 'pendulum',
      core: 'core.mjs',
      renderer: 'renderer.json',
      testAdapter: 'test-adapter.json',
    }),
  },
  testAdapter: {
    path: 'test-adapter.json',
    content: JSON.stringify({ schemaVersion: '1', units: { length: 'm', amplitude: 'deg' } }),
  },
})

const provenance = (requestId: string): ProviderProvenance => ({
  provider: 'fake',
  model: 'fake-scripted-v1',
  templateVersion: '1.0.0',
  requestIds: [requestId],
  threadId: null,
  usage: { inputTokens: 0, outputTokens: 0, requestCount: 1, costMicrousd: 0 },
})

// A metered turn whose token usage exceeds the per-call reservation, mirroring a
// real Codex turn that burns far more input tokens than were reserved. The
// pipeline reconciles the recorded call, then settles the run as
// budget_exhausted because usage is outside the reservation.
const overReservationProvenance = (requestId: string): ProviderProvenance => ({
  ...provenance(requestId),
  usage: { inputTokens: 5, outputTokens: 0, requestCount: 1, costMicrousd: 0 },
})

const metering = (requestId: string | null) => ({
  provider: 'fake' as const,
  model: 'fake-scripted-v1',
  templateVersion: '1.0.0',
  requestIds: requestId === null ? [] : [requestId],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    requestCount: requestId === null ? 0 : 1,
    costMicrousd: 0,
  },
})

const cancelled = (options?: ProviderCallOptions) =>
  options?.signal?.aborted === true
    ? providerFailure(providerErrors.cancellation, 'cancellation', metering(null))
    : undefined

export class ScriptedFakeProvider implements ConceptCompiler, CodeGenerator, FindingExplainer {
  readonly descriptor: ProviderDescriptor = Object.freeze({
    provider: 'fake' as const,
    model: 'fake-scripted-v1',
    templateVersion: '1.0.0',
  })
  readonly compileReservation = fakeReservation
  readonly generateReservation = fakeReservation
  readonly repairReservation = fakeReservation
  readonly explainReservation = fakeReservation
  readonly #scenario: FakeProviderScenario
  #repairCount = 0

  constructor(scenario: FakeProviderScenario) {
    this.#scenario = scenario
  }

  disposeThread(_threadId: string): Promise<boolean> {
    return Promise.resolve(true)
  }

  disposeOrphanedState(_retainedThreadIds: readonly string[] = []): Promise<boolean> {
    return Promise.resolve(true)
  }

  compile(
    _request: ConceptCompilationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<{ conceptSpec: ConceptSpec; provenance: ProviderProvenance }>> {
    const cancellation = cancelled(options)
    if (cancellation !== undefined) return Promise.resolve(cancellation)
    if (this.#scenario === fakeProviderScenarios.malformed) {
      return Promise.resolve(
        providerFailure(
          providerErrors.malformed,
          'schema-validation',
          metering(FAKE_CONCEPT_REQUEST_ID),
        ),
      )
    }
    if (this.#scenario === fakeProviderScenarios.authenticationFailure) {
      return Promise.resolve(
        providerFailure(
          providerErrors.authentication,
          'authentication',
          metering(FAKE_CONCEPT_REQUEST_ID),
        ),
      )
    }
    if (this.#scenario === fakeProviderScenarios.quotaFailure) {
      return Promise.resolve(
        providerFailure(providerErrors.quota, 'quota', metering(FAKE_CONCEPT_REQUEST_ID)),
      )
    }
    if (this.#scenario === fakeProviderScenarios.transientFailure) {
      return Promise.resolve(
        providerFailure(providerErrors.transient, 'transient', metering(FAKE_CONCEPT_REQUEST_ID)),
      )
    }
    return Promise.resolve({
      ok: true,
      value: { conceptSpec, provenance: provenance(FAKE_CONCEPT_REQUEST_ID) },
    })
  }

  generate(
    _request: CodeGenerationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<CodeGenerationResult>> {
    const cancellation = cancelled(options)
    if (cancellation !== undefined) return Promise.resolve(cancellation)
    if (this.#scenario === fakeProviderScenarios.generateInvariant) {
      // Mirror the real Codex artifact-scope failure: a metered turn (requestCount 1)
      // that returns no provider request id, so the recorded call has a null
      // providerRequestId.
      return Promise.resolve(
        providerFailure(providerErrors.invariant, 'artifact-scope', {
          provider: 'fake',
          model: 'fake-scripted-v1',
          templateVersion: '1.0.0',
          requestIds: [],
          usage: { inputTokens: 0, outputTokens: 0, requestCount: 1, costMicrousd: 0 },
        }),
      )
    }
    if (this.#scenario === fakeProviderScenarios.overReservation) {
      return Promise.resolve({
        ok: true,
        value: {
          artifacts: artifacts(goodCore),
          threadId: null,
          provenance: overReservationProvenance('fake-code-generate-1'),
        },
      })
    }
    const core =
      this.#scenario === fakeProviderScenarios.repairConvergence ||
      this.#scenario === fakeProviderScenarios.exhausted
        ? badCore
        : goodCore
    return Promise.resolve(this.#result(core, 'fake-code-generate-1'))
  }

  repair(
    _request: CodeRepairRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<CodeGenerationResult>> {
    const cancellation = cancelled(options)
    if (cancellation !== undefined) return Promise.resolve(cancellation)
    this.#repairCount += 1
    const core = this.#scenario === fakeProviderScenarios.repairConvergence ? goodCore : badCore
    return Promise.resolve(this.#result(core, `fake-code-repair-${this.#repairCount}`))
  }

  explain(
    request: FindingExplanationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<FindingExplanation>> {
    const cancellation = cancelled(options)
    if (cancellation !== undefined) return Promise.resolve(cancellation)
    const quantities = request.findings.map((finding) => finding.quantity).join(', ')
    return Promise.resolve({
      ok: true,
      value: {
        source: 'model-commentary',
        narration: `The verifier ${request.verdict} this ${request.conceptSpec.domain} simulation because ${quantities} fell outside the trusted tolerance.`,
        provenance: provenance('fake-explain-1'),
      },
    })
  }

  #result(core: string, requestId: string): ProviderResult<CodeGenerationResult> {
    return {
      ok: true,
      value: { artifacts: artifacts(core), threadId: null, provenance: provenance(requestId) },
    }
  }
}

export const createScriptedFakeProvider = (scenario: FakeProviderScenario) =>
  new ScriptedFakeProvider(scenario)
