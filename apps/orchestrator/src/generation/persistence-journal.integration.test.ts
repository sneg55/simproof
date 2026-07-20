// LOC-EXEMPT: Durable-pipeline integration exercises the success, repair, and provider-failure paths against one real persistence fixture.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  RunnerBinding,
  RunnerRequest,
  RunnerResponse,
  VerificationDependencyBinding,
} from '@simproof/contracts'
import {
  CorrelationContext,
  createStructuredLogger,
  LocalLogStore,
  LocalMetrics,
} from '@simproof/observability'
import { ArtifactStore, createPersistence } from '@simproof/persistence'
import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { afterEach, describe, expect, it } from 'vitest'
import { GenerationArtifactWriter } from './generation-artifact-writer.js'
import { GenerationObservability } from './generation-observability.js'
import { createInstalledVerificationAuthorityResolver } from './installed-verification-authority.js'
import { PersistenceGenerationJournal } from './persistence-journal.js'
import { createGenerationPipeline } from './pipeline.js'
import type { RunnerServicePort as RunnerService } from './runner-service-port.js'
import { createTrustedRunnerAdapter } from './trusted-runner-adapter.js'
import { createTrustedVerifierAdapter } from './trusted-verifier-adapter.js'

const NOW = '2026-07-16T12:00:00.000Z'
const GOOD_CORE = `export default Object.freeze({
  protocolVersion: '1',
  sample(input) {
    return Object.freeze({
      input: Object.freeze({ lengthM: input.lengthM, amplitudeDeg: input.amplitudeDeg }),
      periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.80665),
    })
  },
})`
const runnerBinding: RunnerBinding = { version: '1.0.0', protocolVersion: '1' }
const dependencies: VerificationDependencyBinding = {
  schemaVersion: '1',
  entries: [],
  contentHash: `sha256:${'d'.repeat(64)}`,
}
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true })))
})

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new TypeError('Expected persistence operation to pass.')
  return result.value
}

const runnerService: RunnerService = {
  execute(input: unknown): Promise<RunnerResponse> {
    const request = input as RunnerRequest
    if (request.domain !== 'pendulum') throw new TypeError('Expected a pendulum request.')
    const correct = request.artifact.content === GOOD_CORE
    return Promise.resolve({
      protocolVersion: '1',
      requestId: request.requestId,
      domain: 'pendulum',
      observedArtifactHash: request.artifact.hash,
      exit: { classification: 'success', errorId: null },
      samples: request.inputs.map(({ input: sampleInput, sampleId }) => ({
        sampleId,
        observation: {
          input: sampleInput,
          periodS: correct
            ? 2 * Math.PI * Math.sqrt(sampleInput.lengthM / 9.80665)
            : 2 * Math.PI * (sampleInput.lengthM / 9.80665),
        },
      })),
      diagnostics: [],
    })
  },
}

describe('durable generation pipeline', () => {
  it('persists a fake-provider rejection, repair, verification, usage, and replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-pipeline-'))
    roots.push(root)
    const database = createPersistence(
      join(root, 'metadata.sqlite'),
      createInstalledVerificationAuthorityResolver({ runner: runnerBinding, dependencies }),
    )
    const store = new ArtifactStore(join(root, 'artifacts'))
    try {
      unwrap(database.migrate())
      const simulationVersionId = randomUUID()
      const simulation = unwrap(
        database.createSimulation({
          id: randomUUID(),
          title: 'Pipeline owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      unwrap(
        database.createDraftVersion({
          id: simulationVersionId,
          simulationId: simulation.id,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      const artifacts = new GenerationArtifactWriter({ database, store, id: randomUUID })
      const journal = new PersistenceGenerationJournal({ database, artifacts, id: randomUUID })
      const provider = createScriptedFakeProvider(fakeProviderScenarios.repairConvergence)
      const runner = createTrustedRunnerAdapter({
        service: runnerService,
        runner: runnerBinding,
        limits: {
          timeoutMs: 2_000,
          memoryBytes: 134_217_728,
          maxOutputBytes: 65_536,
          maxSamples: 32,
        },
        createRequestId: randomUUID,
      })
      const verifier = createTrustedVerifierAdapter({
        runner: runnerBinding,
        dependencies,
        createReportId: randomUUID,
        now: () => NOW,
      })
      const logStore = new LocalLogStore({ maxEntries: 200, maxAgeMs: 60_000 }, () =>
        Date.parse(NOW),
      )
      const correlation = new CorrelationContext()
      const metrics = new LocalMetrics()
      const observability = new GenerationObservability({
        context: correlation,
        logger: createStructuredLogger({ sink: logStore, clock: () => Date.parse(NOW) }),
        metrics,
      })
      const pipeline = createGenerationPipeline({
        conceptCompiler: provider,
        codeGenerator: provider,
        journal,
        runner,
        verifier,
        now: () => NOW,
        signals: observability,
      })
      const request = {
        schemaVersion: '1',
        simulationVersionId,
        idempotencyKey: 'pipeline:durable:repair',
        prompt: 'Build a pendulum simulation.',
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      } as const

      const requestId = '019f6bc1-0811-70c1-a139-938a3ad2dee0'
      const result = await correlation.run({ requestId }, async () => await pipeline.run(request))
      expect(result).toMatchObject({ state: 'verified', attemptCount: 2 })
      const history = unwrap(database.generation.history(result.id))
      expect(history.map(({ to }) => to)).toEqual([
        'queued',
        'compiling',
        'generating',
        'executing',
        'verifying',
        'repairing',
        'executing',
        'verifying',
        'verified',
      ])
      const durableAttempts = unwrap(database.generation.attempts(result.id))
      expect(durableAttempts).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          outcome: 'rejected',
          verificationRunId: expect.any(String),
        }),
        expect.objectContaining({
          attemptNumber: 2,
          outcome: 'verified',
          verificationRunId: expect.any(String),
        }),
      ])
      const signals = logStore.recent()
      expect(new Set(signals.map(({ component }) => component))).toEqual(
        new Set(['orchestrator', 'persistence', 'provider', 'runner-client', 'verifier']),
      )
      expect(
        signals.every(
          ({ correlation: context }) =>
            context?.requestId === requestId &&
            context.runId === result.id &&
            context.simulationId === simulationVersionId,
        ),
      ).toBe(true)
      const attemptSignals = signals.filter(
        ({ correlation: context }) => context?.attemptId !== undefined,
      )
      expect(new Set(attemptSignals.map(({ correlation: context }) => context?.attemptId))).toEqual(
        new Set(durableAttempts.map(({ id }) => id)),
      )
      const serializedSignals = JSON.stringify(signals)
      expect(serializedSignals).not.toContain(request.prompt)
      expect(serializedSignals).not.toContain(GOOD_CORE)
      expect(metrics.snapshot()).toMatchObject({
        verdicts: [
          { verdict: 'rejected', count: 1 },
          { verdict: 'verified', count: 1 },
        ],
        attempts: [
          { attemptKind: 'generation', count: 1 },
          { attemptKind: 'repair', count: 1 },
        ],
      })
      expect(unwrap(database.generation.externalCalls(result.id))).toHaveLength(3)
      const reservations = unwrap(database.generation.externalCallReservations(result.id))
      expect(reservations).toHaveLength(3)
      expect(reservations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'concept_compile', status: 'reconciled' }),
          expect.objectContaining({ operation: 'code_generate', status: 'reconciled' }),
          expect.objectContaining({ operation: 'code_repair', status: 'reconciled' }),
        ]),
      )
      const version = unwrap(database.getVersion(simulationVersionId))
      expect(version).toMatchObject({
        state: 'verified',
        activeConceptSpecId: expect.any(String),
        activeGeneratedArtifactId: expect.any(String),
        activeVerificationRunId: expect.any(String),
      })
      if (version.activeVerificationRunId === null) throw new TypeError('Expected verification.')
      expect(unwrap(database.verification.get(version.activeVerificationRunId))).toMatchObject({
        simulationVersionId,
        verdict: 'verified',
        runnerVersion: runnerBinding.version,
      })
      expect(
        unwrap(await database.verification.currentValidity(version.activeVerificationRunId, store)),
      ).toEqual({ status: 'current' })
      expect(await pipeline.run(request)).toEqual(result)

      const secondVersionId = randomUUID()
      const secondSimulation = unwrap(
        database.createSimulation({
          id: randomUUID(),
          title: 'Second pipeline owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      unwrap(
        database.createDraftVersion({
          id: secondVersionId,
          simulationId: secondSimulation.id,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      const second = await pipeline.run({
        ...request,
        simulationVersionId: secondVersionId,
        idempotencyKey: 'pipeline:durable:repair:second',
      })
      expect(second).toMatchObject({ state: 'verified', attemptCount: 2 })
      expect(unwrap(database.generation.externalCalls(second.id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerRequestId: 'fake-concept-1' }),
          expect.objectContaining({ providerRequestId: 'fake-code-generate-1' }),
        ]),
      )
      expect(unwrap(database.getVersion(secondVersionId))).toMatchObject({ state: 'verified' })
    } finally {
      database.close()
    }
  })

  it('records a transient provider failure as provider_failed, not an integrity failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-pipeline-transient-'))
    roots.push(root)
    const database = createPersistence(
      join(root, 'metadata.sqlite'),
      createInstalledVerificationAuthorityResolver({ runner: runnerBinding, dependencies }),
    )
    const store = new ArtifactStore(join(root, 'artifacts'))
    try {
      unwrap(database.migrate())
      const simulationVersionId = randomUUID()
      const simulation = unwrap(
        database.createSimulation({
          id: randomUUID(),
          title: 'Transient owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      unwrap(
        database.createDraftVersion({
          id: simulationVersionId,
          simulationId: simulation.id,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      const artifacts = new GenerationArtifactWriter({ database, store, id: randomUUID })
      const journal = new PersistenceGenerationJournal({ database, artifacts, id: randomUUID })
      const provider = createScriptedFakeProvider(fakeProviderScenarios.transientFailure)
      const runner = createTrustedRunnerAdapter({
        service: runnerService,
        runner: runnerBinding,
        limits: {
          timeoutMs: 2_000,
          memoryBytes: 134_217_728,
          maxOutputBytes: 65_536,
          maxSamples: 32,
        },
        createRequestId: randomUUID,
      })
      const verifier = createTrustedVerifierAdapter({
        runner: runnerBinding,
        dependencies,
        createReportId: randomUUID,
        now: () => NOW,
      })
      const observability = new GenerationObservability({
        context: new CorrelationContext(),
        logger: createStructuredLogger({
          sink: new LocalLogStore({ maxEntries: 200, maxAgeMs: 60_000 }, () => Date.parse(NOW)),
          clock: () => Date.parse(NOW),
        }),
        metrics: new LocalMetrics(),
      })
      const pipeline = createGenerationPipeline({
        conceptCompiler: provider,
        codeGenerator: provider,
        journal,
        runner,
        verifier,
        now: () => NOW,
        signals: observability,
      })
      // Recording the provider failure once carried a stray `requestCount` usage
      // key that failed persistence validation, masking the transient failure as
      // an opaque invariant/integrity failure. The run must settle as
      // provider_failed with its reservation reconciled.
      const result = await pipeline.run({
        schemaVersion: '1',
        simulationVersionId,
        idempotencyKey: 'pipeline:durable:transient',
        prompt: 'Build a pendulum simulation.',
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })
      expect(result).toMatchObject({ state: 'provider_failed' })
      expect(unwrap(database.generation.externalCallReservations(result.id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'concept_compile', status: 'reconciled' }),
        ]),
      )
      expect(unwrap(database.getVersion(simulationVersionId))).toMatchObject({ state: 'draft' })
    } finally {
      database.close()
    }
  })

  it('records a code-gen provider invariant as invariant_failed without crashing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-pipeline-invariant-'))
    roots.push(root)
    const database = createPersistence(
      join(root, 'metadata.sqlite'),
      createInstalledVerificationAuthorityResolver({ runner: runnerBinding, dependencies }),
    )
    const store = new ArtifactStore(join(root, 'artifacts'))
    try {
      unwrap(database.migrate())
      const simulationVersionId = randomUUID()
      const simulation = unwrap(
        database.createSimulation({
          id: randomUUID(),
          title: 'Invariant owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      unwrap(
        database.createDraftVersion({
          id: simulationVersionId,
          simulationId: simulation.id,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      const artifacts = new GenerationArtifactWriter({ database, store, id: randomUUID })
      const journal = new PersistenceGenerationJournal({ database, artifacts, id: randomUUID })
      const provider = createScriptedFakeProvider(fakeProviderScenarios.generateInvariant)
      const runner = createTrustedRunnerAdapter({
        service: runnerService,
        runner: runnerBinding,
        limits: {
          timeoutMs: 2_000,
          memoryBytes: 134_217_728,
          maxOutputBytes: 65_536,
          maxSamples: 32,
        },
        createRequestId: randomUUID,
      })
      const verifier = createTrustedVerifierAdapter({
        runner: runnerBinding,
        dependencies,
        createReportId: randomUUID,
        now: () => NOW,
      })
      const observability = new GenerationObservability({
        context: new CorrelationContext(),
        logger: createStructuredLogger({
          sink: new LocalLogStore({ maxEntries: 200, maxAgeMs: 60_000 }, () => Date.parse(NOW)),
          clock: () => Date.parse(NOW),
        }),
        metrics: new LocalMetrics(),
      })
      const pipeline = createGenerationPipeline({
        conceptCompiler: provider,
        codeGenerator: provider,
        journal,
        runner,
        verifier,
        now: () => NOW,
        signals: observability,
      })
      // A code-generation turn that fails closed (provider invariant) must settle
      // the run as invariant_failed with its attempt recorded, not throw an
      // uncaught persistence error that the coordinator relabels opaquely.
      const result = await pipeline.run({
        schemaVersion: '1',
        simulationVersionId,
        idempotencyKey: 'pipeline:durable:invariant',
        prompt: 'Build a pendulum simulation.',
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })
      expect(result).toMatchObject({ state: 'invariant_failed', attemptCount: 1 })
      expect(unwrap(database.generation.attempts(result.id))).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          outcome: 'invariant_failed',
          stableErrorId: 'orchestration.invariant-failed',
        }),
      ])
      expect(unwrap(database.getVersion(simulationVersionId))).toMatchObject({ state: 'draft' })
    } finally {
      database.close()
    }
  })

  it('settles an over-reservation budget exhaustion and survives a restart recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-pipeline-budget-'))
    roots.push(root)
    const database = createPersistence(
      join(root, 'metadata.sqlite'),
      createInstalledVerificationAuthorityResolver({ runner: runnerBinding, dependencies }),
    )
    const store = new ArtifactStore(join(root, 'artifacts'))
    try {
      unwrap(database.migrate())
      const simulationVersionId = randomUUID()
      const simulation = unwrap(
        database.createSimulation({
          id: randomUUID(),
          title: 'Budget owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      unwrap(
        database.createDraftVersion({
          id: simulationVersionId,
          simulationId: simulation.id,
          versionNumber: 1,
          state: 'draft',
          revision: 0,
          activeConceptSpecId: null,
          activeGeneratedArtifactId: null,
          activeArtifactBundle: null,
          activeVerificationRunId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      const artifacts = new GenerationArtifactWriter({ database, store, id: randomUUID })
      const journal = new PersistenceGenerationJournal({ database, artifacts, id: randomUUID })
      const provider = createScriptedFakeProvider(fakeProviderScenarios.overReservation)
      const runner = createTrustedRunnerAdapter({
        service: runnerService,
        runner: runnerBinding,
        limits: {
          timeoutMs: 2_000,
          memoryBytes: 134_217_728,
          maxOutputBytes: 65_536,
          maxSamples: 32,
        },
        createRequestId: randomUUID,
      })
      const verifier = createTrustedVerifierAdapter({
        runner: runnerBinding,
        dependencies,
        createReportId: randomUUID,
        now: () => NOW,
      })
      const observability = new GenerationObservability({
        context: new CorrelationContext(),
        logger: createStructuredLogger({
          sink: new LocalLogStore({ maxEntries: 200, maxAgeMs: 60_000 }, () => Date.parse(NOW)),
          clock: () => Date.parse(NOW),
        }),
        metrics: new LocalMetrics(),
      })
      const pipeline = createGenerationPipeline({
        conceptCompiler: provider,
        codeGenerator: provider,
        journal,
        runner,
        verifier,
        now: () => NOW,
        signals: observability,
      })
      // A code-generation turn that burns more tokens than were reserved settles
      // the run as budget_exhausted. That terminal state must persist cleanly:
      // completed run, version reset to draft, and a subsequent startup recovery
      // (as if the service restarted) must not fail closed and take the service
      // down for every request.
      const result = await pipeline.run({
        schemaVersion: '1',
        simulationVersionId,
        idempotencyKey: 'pipeline:durable:budget',
        prompt: 'Build a pendulum simulation.',
        maxAttempts: 3,
        budget: {
          maxProviderRequests: 6,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxCostMicrousd: 10_000,
          maxArtifactBytes: 100_000,
        },
      })
      expect(result).toMatchObject({ state: 'budget_exhausted' })
      expect(unwrap(database.getVersion(simulationVersionId))).toMatchObject({ state: 'draft' })
      const recovered = database.generation.recoverInterrupted({ at: NOW })
      expect(recovered).toMatchObject({ ok: true })
      // The service comes back up: the version is still usable, not wedged.
      expect(unwrap(database.getVersion(simulationVersionId))).toMatchObject({ state: 'draft' })
    } finally {
      database.close()
    }
  })
})
