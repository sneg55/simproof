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
  ArtifactStore,
  createPersistence,
  type InstalledEvidenceResolver,
} from '@simproof/persistence'
import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { expect, vi } from 'vitest'

import { GenerationArtifactWriter } from './generation-artifact-writer.js'
import { createInstalledVerificationAuthorityResolver } from './installed-verification-authority.js'
import { PersistenceGenerationJournal } from './persistence-journal.js'
import { createGenerationPipeline } from './pipeline.js'
import type { ReverificationService } from './reverification-service.js'
import type { RunnerServicePort as RunnerService } from './runner-service-port.js'
import { createTrustedRunnerAdapter } from './trusted-runner-adapter.js'
import { createTrustedVerifierAdapter } from './trusted-verifier-adapter.js'

export const NOW = '2026-07-16T12:00:00.000Z'
export const runnerBinding: RunnerBinding = { version: '1.0.0', protocolVersion: '1' }
const dependencies: VerificationDependencyBinding = {
  schemaVersion: '1',
  entries: [],
  contentHash: `sha256:${'d'.repeat(64)}`,
}
export const reverificationRoots: string[] = []

export async function cleanupReverificationRoots(): Promise<void> {
  await Promise.all(
    reverificationRoots.splice(0).map(async (root) => await rm(root, { recursive: true })),
  )
}

export const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw new TypeError(JSON.stringify(result.error))
  return result.value
}

export function successfulResponse(request: RunnerRequest, periodScale = 1): RunnerResponse {
  if (request.domain !== 'pendulum') throw new TypeError('Expected a pendulum request.')
  return {
    protocolVersion: '1',
    requestId: request.requestId,
    domain: request.domain,
    observedArtifactHash: request.artifact.hash,
    exit: { classification: 'success', errorId: null },
    samples: request.inputs.map(({ input, sampleId }) => ({
      sampleId,
      observation: {
        input,
        periodS: 2 * Math.PI * Math.sqrt(input.lengthM / 9.80665) * periodScale,
      },
    })),
    diagnostics: [],
  }
}

export async function setupReverification(
  authorityDependencies = dependencies,
  publishBeforeStale = false,
  priorAuthorityDependencies?: VerificationDependencyBinding,
) {
  const root = await mkdtemp(join(tmpdir(), 'simproof-reverify-'))
  reverificationRoots.push(root)
  const initialAuthority = priorAuthorityDependencies ?? authorityDependencies
  let installedResolver = createInstalledVerificationAuthorityResolver({
    runner: runnerBinding,
    dependencies: initialAuthority,
  })
  const resolveInstalledEvidence: InstalledEvidenceResolver = (run) => installedResolver(run)
  const database = createPersistence(join(root, 'metadata.sqlite'), resolveInstalledEvidence)
  const store = new ArtifactStore(join(root, 'artifacts'))
  unwrap(database.migrate())
  const simulation = unwrap(
    database.createSimulation({
      id: randomUUID(),
      title: 'Reverification owner',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  const versionId = randomUUID()
  unwrap(
    database.createDraftVersion({
      id: versionId,
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
  const provider = createScriptedFakeProvider(fakeProviderScenarios.correct)
  const compile = vi.spyOn(provider, 'compile')
  const generate = vi.spyOn(provider, 'generate')
  const execute = vi.fn((input: unknown) =>
    Promise.resolve(successfulResponse(input as RunnerRequest)),
  )
  const runner = createTrustedRunnerAdapter({
    service: { execute } satisfies RunnerService,
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
    dependencies: initialAuthority,
    createReportId: randomUUID,
    now: () => NOW,
  })
  const artifacts = new GenerationArtifactWriter({ database, store, id: randomUUID })
  const pipeline = createGenerationPipeline({
    conceptCompiler: provider,
    codeGenerator: provider,
    journal: new PersistenceGenerationJournal({ database, artifacts, id: randomUUID }),
    runner,
    verifier,
    now: () => NOW,
  })
  const generated = await pipeline.run({
    schemaVersion: '1',
    simulationVersionId: versionId,
    idempotencyKey: 'reverify:fixture:generation',
    prompt: 'Build a pendulum simulation.',
    maxAttempts: 1,
    budget: {
      maxProviderRequests: 3,
      maxInputTokens: 1_000,
      maxOutputTokens: 1_000,
      maxCostMicrousd: 10_000,
      maxArtifactBytes: 100_000,
    },
  })
  expect(generated.state).toBe('verified')
  let verified = unwrap(database.getVersion(versionId))
  const oldVerificationRunId = verified.activeVerificationRunId
  if (oldVerificationRunId === null) throw new TypeError('Expected initial verification evidence.')
  if (publishBeforeStale) {
    unwrap(
      await database.verification.publish(
        {
          id: randomUUID(),
          simulationVersionId: versionId,
          exportLicense: { kind: 'none' },
          publishedAt: NOW,
        },
        verified.revision,
        store,
      ),
    )
    verified = unwrap(database.getVersion(versionId))
  }
  let stale = verified
  if (priorAuthorityDependencies === undefined) {
    stale = unwrap(
      database.transitionVersion({
        id: versionId,
        expectedRevision: verified.revision,
        to: 'stale',
        updatedAt: NOW,
      }),
    )
  } else {
    installedResolver = createInstalledVerificationAuthorityResolver({
      runner: runnerBinding,
      dependencies: authorityDependencies,
    })
    expect(await database.verification.currentValidity(oldVerificationRunId, store)).toMatchObject({
      ok: false,
      error: { code: 'invalid-state' },
    })
    stale = unwrap(database.getVersion(versionId))
    expect(stale.state).toBe('stale')
  }
  return {
    root,
    database,
    store,
    versionId,
    stale,
    oldVerificationRunId,
    resolveInstalledEvidence,
    providerCalls: { compile, generate },
    execute,
    runner,
    verifier,
  }
}

export async function terminal(service: Pick<ReverificationService, 'status'>, runId: string) {
  for (let turn = 0; turn < 200; turn += 1) {
    const status = await service.status(runId)
    if (status.ok && status.value.completedAt !== null) return status.value
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new TypeError('Reverification did not reach a terminal state.')
}

export function reverifyRequest(revision: number, key = 'reverify:service:success') {
  return { expectedRevision: revision, idempotencyKey: key }
}
