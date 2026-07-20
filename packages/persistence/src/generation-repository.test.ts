// LOC-EXEMPT: Durable generation repository transitions and immutable history controls form one regression matrix.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { ArtifactBundle } from '@simproof/contracts'

import { describe, expect, it } from 'vitest'

import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW, sha, stored } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

async function draft(name: string) {
  const context = await fixture(name)
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.createSimulation({
      id: simulationId,
      title: 'Durable generation',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  expectOk(
    context.database.createDraftVersion({
      id: versionId,
      simulationId,
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
  return { ...context, versionId }
}

function request(versionId: string, runId = id()) {
  return {
    versionId,
    expectedRevision: 0,
    idempotencyKey: 'teacher-request-42',
    updatedAt: NOW,
    run: {
      id: runId,
      maxAttempts: 3,
      codexSessionId: null,
      createdAt: NOW,
    },
    budgets: {
      providerRequests: 6,
      inputTokens: 20_000,
      outputTokens: 8_000,
      costMicrousd: 100_000,
      artifactBytes: 1_000_000,
    },
  }
}

async function storeCandidate(context: Awaited<ReturnType<typeof draft>>, attemptId: string) {
  const core = await stored(context.database, context.store, 'core-source', 'export default {}')
  const renderer = await stored(
    context.database,
    context.store,
    'renderer-data',
    '{"kind":"pendulum"}',
  )
  const manifest = await stored(
    context.database,
    context.store,
    'manifest',
    '{"schemaVersion":"1"}',
  )
  const artifactBundle: ArtifactBundle = {
    core: { artifactId: core.id, role: 'core-source', contentHash: core.contentHash },
    renderer: {
      artifactId: renderer.id,
      role: 'renderer-data',
      contentHash: renderer.contentHash,
    },
    manifest: {
      artifactId: manifest.id,
      role: 'manifest',
      contentHash: manifest.contentHash,
    },
  }
  const generatedArtifactId = id()
  expectOk(
    context.database.records.insertGeneratedArtifact({
      id: generatedArtifactId,
      generationAttemptId: attemptId,
      artifactBundle,
      exportLicense: { kind: 'none' },
      createdAt: NOW,
    }),
  )
  return generatedArtifactId
}

async function recordVerificationEvidence(
  context: Awaited<ReturnType<typeof draft>>,
  runId: string,
  generatedArtifactId: string,
  verdict: 'verified' | 'rejected',
) {
  const conceptArtifact = await stored(
    context.database,
    context.store,
    'concept-spec',
    '{"schemaVersion":"1"}',
  )
  const conceptSpecId = id()
  expectOk(
    context.database.records.insertConceptSpec({
      id: conceptSpecId,
      simulationVersionId: context.versionId,
      generationRunId: runId,
      schemaVersion: '1',
      domain: 'pendulum',
      artifact: {
        artifactId: conceptArtifact.id,
        role: 'concept-spec',
        contentHash: conceptArtifact.contentHash,
      },
      createdAt: NOW,
    }),
  )
  const policy = expectOk(
    context.database.records.ensurePolicyReference({
      id: id(),
      policyId: 'pendulum.test',
      version: '1.0.0',
      contentHash: sha(`policy-${generatedArtifactId}`),
      createdAt: NOW,
    }),
  )
  const pack = expectOk(
    context.database.records.ensureDomainPackReference({
      id: id(),
      domainPackId: 'pendulum',
      version: '1.0.0',
      contentHash: sha(`pack-${generatedArtifactId}`),
      createdAt: NOW,
    }),
  )
  const report = await stored(context.database, context.store, 'verification-report', '{}')
  const verificationRunId = id()
  const database = new DatabaseSync(context.database.path)
  try {
    const generated = database
      .prepare('SELECT artifact_bundle_json FROM generated_artifacts WHERE id=?')
      .get(generatedArtifactId) as { artifact_bundle_json: string }
    database
      .prepare(`INSERT INTO verification_runs(
      id,simulation_version_id,concept_spec_id,generated_artifact_id,evidence_json,
      concept_artifact_json,artifact_bundle_json,policy_reference_id,domain_pack_reference_id,
      policy_content_hash,domain_pack_content_hash,runner_version,runner_protocol_version,
      dependencies_json,dependencies_hash,observation_hash,report_artifact_id,report_hash,
      verdict,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        verificationRunId,
        context.versionId,
        conceptSpecId,
        generatedArtifactId,
        '{}',
        '{}',
        generated.artifact_bundle_json,
        policy.id,
        pack.id,
        policy.contentHash,
        pack.contentHash,
        '1.0.0',
        '1',
        '{}',
        sha('dependencies'),
        sha('observations'),
        report.id,
        report.contentHash,
        verdict,
        NOW,
      )
    return {
      id: verificationRunId,
      conceptSpecId,
      artifactBundleJson: generated.artifact_bundle_json,
    }
  } finally {
    database.close()
  }
}

function settleScientificVersion(
  context: Awaited<ReturnType<typeof draft>>,
  evidence: { id: string; conceptSpecId: string; artifactBundleJson: string },
  generatedArtifactId: string,
  state: 'verified' | 'rejected',
) {
  const database = new DatabaseSync(context.database.path)
  try {
    database
      .prepare(`UPDATE simulation_versions SET state=?,revision=revision+1,
      active_concept_spec_id=?,active_generated_artifact_id=?,active_artifact_bundle_json=?,
      active_verification_run_id=?,updated_at=? WHERE id=?`)
      .run(
        state,
        evidence.conceptSpecId,
        generatedArtifactId,
        evidence.artifactBundleJson,
        evidence.id,
        LATER,
        context.versionId,
      )
  } finally {
    database.close()
  }
}

function legacyStatus(path: string, runId: string): string {
  const database = new DatabaseSync(path)
  try {
    const row = database.prepare('SELECT status FROM generation_runs WHERE id=?').get(runId) as {
      status: string
    }
    return row.status
  } finally {
    database.close()
  }
}

function moveToGenerating(database: ReturnType<typeof createPersistence>, runId: string): void {
  expectOk(
    database.generation.transition({
      runId,
      expectedRevision: 0,
      to: 'compiling',
      at: LATER,
    }),
  )
  expectOk(
    database.generation.recordExternalCall({
      id: id(),
      runId,
      attemptId: null,
      operation: 'concept_compile',
      provider: 'fake',
      modelId: 'fake-concept-v1',
      templateVersion: 'concept.v1',
      providerRequestId: `concept-${runId}`,
      codexThreadId: null,
      stableErrorId: null,
      usage: {
        providerRequests: 1,
        inputTokens: 0,
        outputTokens: 0,
        costMicrousd: 0,
        artifactBytes: 0,
      },
      recordedAt: LATER,
    }),
  )
  expectOk(
    database.generation.transition({
      runId,
      expectedRevision: 1,
      to: 'generating',
      at: LATER,
    }),
  )
}

describe('durable generation orchestration persistence', () => {
  it('creates one durable run per idempotency key and replays it across connections', async () => {
    const context = await draft('generation-idempotency')
    const contender = createPersistence(context.database.path)
    try {
      expectOk(contender.migrate())
      const first = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      const replay = expectOk(contender.beginOrReplayGeneration(request(context.versionId, id())))

      expect(first.created).toBe(true)
      expect(replay.created).toBe(false)
      expect(replay.run.id).toBe(first.run.id)
      expect(replay.version).toEqual(first.version)
      expect(replay.run.idempotencyKeyHash).toBe(
        createHash('sha256').update('teacher-request-42').digest('hex'),
      )
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'generating', revision: 1 },
      })
    } finally {
      contender.close()
      await context.cleanup()
    }
  })

  it('rejects an idempotency key replayed against another simulation version', async () => {
    const context = await draft('generation-idempotency-owner')
    try {
      expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      const otherSimulationId = id()
      const otherVersionId = id()
      expectOk(
        context.database.createSimulation({
          id: otherSimulationId,
          title: 'Other',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.createDraftVersion({
          id: otherVersionId,
          simulationId: otherSimulationId,
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
      expect(context.database.beginOrReplayGeneration(request(otherVersionId))).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('persists explicit transitions and rejects invalid or stale transitions', async () => {
    const context = await draft('generation-transitions')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      const compiling = expectOk(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: LATER,
        }),
      )
      expect(compiling.state).toBe('compiling')
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 0,
          to: 'generating',
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 1,
          to: 'verified',
          at: LATER,
          terminalClassification: 'verified',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-transition' } })
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 1,
          to: 'invariant_failed',
          at: LATER,
          terminalClassification: 'scientific_rejection',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 1,
          to: 'provider_failed',
          at: LATER,
          terminalClassification: 'provider_failure',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(context.database.generation.history(created.run.id)).toMatchObject({
        ok: true,
        value: [
          { sequence: 0, from: null, to: 'queued' },
          { sequence: 1, from: 'queued', to: 'compiling' },
        ],
      })
    } finally {
      await context.cleanup()
    }
  })

  it('caps attempts and transactionally records bounded usage and provenance', async () => {
    const context = await draft('generation-attempts')
    try {
      const created = expectOk(
        context.database.beginOrReplayGeneration({
          ...request(context.versionId),
          run: { ...request(context.versionId).run, id: id(), maxAttempts: 2 },
          budgets: {
            providerRequests: 3,
            inputTokens: 500,
            outputTokens: 200,
            costMicrousd: 5_000,
            artifactBytes: 10_000,
          },
        }),
      )
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expect(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 2,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'repair.v1',
          createdAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: attempt.id,
          operation: 'code_generate',
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          providerRequestId: 'req_fake_1',
          codexThreadId: 'thread_fake_1',
          stableErrorId: null,
          usage: {
            providerRequests: 1,
            inputTokens: 300,
            outputTokens: 150,
            costMicrousd: 2_000,
            artifactBytes: 1_000,
          },
          recordedAt: LATER,
        }),
      )
      const generatedArtifactId = await storeCandidate(context, attempt.id)
      const firstVerification = await recordVerificationEvidence(
        context,
        created.run.id,
        generatedArtifactId,
        'rejected',
      )
      for (const [expectedRevision, to] of [
        [2, 'executing'],
        [3, 'verifying'],
      ] as const) {
        expectOk(
          context.database.generation.transition({
            runId: created.run.id,
            expectedRevision,
            to,
            at: LATER,
          }),
        )
      }
      expectOk(
        context.database.generation.completeAttempt({
          id: attempt.id,
          outcome: 'rejected',
          providerRequestId: 'req_fake_1',
          codexThreadId: 'thread_fake_1',
          artifactHash: sha('candidate'),
          generatedArtifactId,
          verificationRunId: firstVerification.id,
          findingsReference: 'findings:attempt-1',
          completedAt: LATER,
        }),
      )
      const restarted = createPersistence(context.database.path)
      try {
        expectOk(restarted.migrate())
        const reloadedAttempts = expectOk(restarted.generation.attempts(created.run.id))
        expect(reloadedAttempts[0]).toMatchObject({ id: attempt.id, generatedArtifactId })
      } finally {
        restarted.close()
      }
      expect(context.database.generation.get(created.run.id)).toMatchObject({
        ok: true,
        value: {
          usage: {
            providerRequests: 2,
            inputTokens: 300,
            outputTokens: 150,
            costMicrousd: 2_000,
            artifactBytes: 1_000,
          },
        },
      })
      expectOk(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 4,
          to: 'repairing',
          at: LATER,
        }),
      )
      const second = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 2,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'repair.v1',
          createdAt: NOW,
        }),
      )
      expect(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 3,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'repair.v1',
          createdAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: second.id,
          operation: 'code_repair',
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'repair.v1',
          providerRequestId: 'req_fake_2',
          codexThreadId: 'thread_fake_1',
          stableErrorId: null,
          usage: {
            providerRequests: 2,
            inputTokens: 1,
            outputTokens: 1,
            costMicrousd: 1,
            artifactBytes: 0,
          },
          recordedAt: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(context.database.generation.get(created.run.id)).toMatchObject({
        ok: true,
        value: {
          usage: {
            providerRequests: 2,
            inputTokens: 300,
            outputTokens: 150,
            costMicrousd: 2_000,
            artifactBytes: 1_000,
          },
        },
      })
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: second.id,
          operation: 'code_repair',
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'repair.v1',
          providerRequestId: 'req_fake_2',
          codexThreadId: 'thread_fake_1',
          stableErrorId: null,
          usage: {
            providerRequests: 1,
            inputTokens: 0,
            outputTokens: 0,
            costMicrousd: 0,
            artifactBytes: 0,
          },
          recordedAt: LATER,
        }),
      )
      const repairedArtifactId = await storeCandidate(context, second.id)
      const repairedVerification = await recordVerificationEvidence(
        context,
        created.run.id,
        repairedArtifactId,
        'rejected',
      )
      for (const [expectedRevision, to] of [
        [5, 'executing'],
        [6, 'verifying'],
      ] as const) {
        expectOk(
          context.database.generation.transition({
            runId: created.run.id,
            expectedRevision,
            to,
            at: LATER,
          }),
        )
      }
      expectOk(
        context.database.generation.completeAttempt({
          id: second.id,
          outcome: 'rejected',
          providerRequestId: 'req_fake_2',
          codexThreadId: 'thread_fake_1',
          artifactHash: sha('repaired-candidate'),
          generatedArtifactId: repairedArtifactId,
          verificationRunId: repairedVerification.id,
          findingsReference: 'findings:attempt-2',
          completedAt: LATER,
        }),
      )
      settleScientificVersion(context, repairedVerification, repairedArtifactId, 'rejected')
      expectOk(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 7,
          to: 'rejected',
          at: LATER,
          terminalClassification: 'scientific_rejection',
          findingsReference: 'findings:attempt-1',
        }),
      )
      expect(context.database.generation.get(created.run.id)).toMatchObject({
        ok: true,
        value: {
          state: 'rejected',
          terminalClassification: 'scientific_rejection',
          findingsReference: 'findings:attempt-1',
        },
      })
      expect(legacyStatus(context.database.path, created.run.id)).toBe('rejected')
    } finally {
      await context.cleanup()
    }
  })

  it('makes cancellation terminal and idempotent while preserving its classification', async () => {
    const context = await draft('generation-cancel')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      const cancelled = expectOk(
        context.database.generation.requestCancellation({
          runId: created.run.id,
          expectedRevision: 0,
          at: LATER,
        }),
      )
      expect(cancelled).toMatchObject({
        state: 'cancelled',
        terminalClassification: 'cancelled',
        cancellationRequestedAt: LATER,
        completedAt: LATER,
      })
      expectOk(
        context.database.generation.requestCancellation({
          runId: created.run.id,
          expectedRevision: 1,
          at: LATER,
        }),
      )
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 1,
          to: 'compiling',
          at: LATER,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-transition' } })
      expect(legacyStatus(context.database.path, created.run.id)).toBe('cancelled')
    } finally {
      await context.cleanup()
    }
  })

  it('atomically maps every operational terminal state to the legacy run status', async () => {
    const cases = [
      {
        name: 'provider',
        path: ['compiling'] as const,
        state: 'provider_failed' as const,
        classification: 'provider_failure' as const,
        stableErrorId: 'provider.transient-failure',
        legacy: 'operational-failure',
      },
      {
        name: 'runner',
        path: ['compiling', 'generating', 'executing'] as const,
        state: 'runner_failed' as const,
        classification: 'runner_failure' as const,
        stableErrorId: 'runner.execution-failed',
        legacy: 'operational-failure',
      },
      {
        name: 'invariant',
        path: [] as const,
        state: 'invariant_failed' as const,
        classification: 'invariant_failure' as const,
        stableErrorId: 'orchestration.invariant-failed',
        legacy: 'operational-failure',
      },
      {
        name: 'budget',
        path: [] as const,
        state: 'budget_exhausted' as const,
        classification: 'budget_exhaustion' as const,
        stableErrorId: 'generation.budget-exhausted',
        legacy: 'budget-exhausted',
      },
    ]
    for (const terminal of cases) {
      const context = await draft(`generation-terminal-${terminal.name}`)
      try {
        const created = expectOk(
          context.database.beginOrReplayGeneration(request(context.versionId)),
        )
        let activeAttemptId: string | null = null
        for (const [revision, to] of terminal.path.entries()) {
          if (to === 'generating') {
            expectOk(
              context.database.generation.recordExternalCall({
                id: id(),
                runId: created.run.id,
                attemptId: null,
                operation: 'concept_compile',
                provider: 'fake',
                modelId: 'fake-concept-v1',
                templateVersion: 'concept.v1',
                providerRequestId: `concept-terminal-${created.run.id}`,
                codexThreadId: null,
                stableErrorId: null,
                usage: {
                  providerRequests: 1,
                  inputTokens: 0,
                  outputTokens: 0,
                  costMicrousd: 0,
                  artifactBytes: 0,
                },
                recordedAt: LATER,
              }),
            )
          }
          if (to === 'executing') {
            const attempt = expectOk(
              context.database.generation.startAttempt({
                id: id(),
                runId: created.run.id,
                attemptNumber: 1,
                provider: 'fake',
                modelId: 'fake-coder-v1',
                templateVersion: 'generation.v1',
                createdAt: NOW,
              }),
            )
            activeAttemptId = attempt.id
            expectOk(
              context.database.generation.recordExternalCall({
                id: id(),
                runId: created.run.id,
                attemptId: attempt.id,
                operation: 'code_generate',
                provider: 'fake',
                modelId: 'fake-coder-v1',
                templateVersion: 'generation.v1',
                providerRequestId: `code-terminal-${created.run.id}`,
                codexThreadId: 'thread-terminal',
                stableErrorId: null,
                usage: {
                  providerRequests: 1,
                  inputTokens: 0,
                  outputTokens: 0,
                  costMicrousd: 0,
                  artifactBytes: 0,
                },
                recordedAt: LATER,
              }),
            )
          }
          expectOk(
            context.database.generation.transition({
              runId: created.run.id,
              expectedRevision: revision,
              to,
              at: LATER,
            }),
          )
        }
        if (activeAttemptId !== null) {
          expectOk(
            context.database.generation.completeAttempt({
              id: activeAttemptId,
              outcome: 'runner_failed',
              providerRequestId: null,
              codexThreadId: null,
              artifactHash: null,
              generatedArtifactId: null,
              verificationRunId: null,
              findingsReference: null,
              stableErrorId: terminal.stableErrorId,
              completedAt: LATER,
            }),
          )
        }
        expectOk(
          context.database.generation.transition({
            runId: created.run.id,
            expectedRevision: terminal.path.length,
            to: terminal.state,
            at: LATER,
            terminalClassification: terminal.classification,
            stableErrorId: terminal.stableErrorId,
          }),
        )
        expect(legacyStatus(context.database.path, created.run.id)).toBe(terminal.legacy)
      } finally {
        await context.cleanup()
      }
    }
  })

  it('completes an over-budget attempt outcome that carries a stable error id', async () => {
    const context = await draft('generation-attempt-budget')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      // Regression: budget_exhausted always carries a stable error id, so the
      // attempt completion must treat it as an operational outcome and not reject
      // it as invalid-input (which the durable pipeline relabeled as invariant_failed).
      expectOk(
        context.database.generation.completeAttempt({
          id: attempt.id,
          outcome: 'budget_exhausted',
          providerRequestId: null,
          codexThreadId: null,
          artifactHash: null,
          generatedArtifactId: null,
          verificationRunId: null,
          findingsReference: null,
          stableErrorId: 'generation.budget-exhausted',
          completedAt: LATER,
        }),
      )
      // The legacy attempt row must use an operational outcome ('invalid-output'),
      // not 'cancelled'. A non-operational outcome carrying a stable error id
      // fails the read-time record schema, which broke every library read once
      // an over-budget run existed.
      const raw = new DatabaseSync(context.database.path)
      try {
        const legacy = raw
          .prepare('SELECT outcome, stable_error_id FROM generation_attempts WHERE id=?')
          .get(attempt.id)
        expect(legacy).toMatchObject({
          outcome: 'invalid-output',
          stable_error_id: 'generation.budget-exhausted',
        })
      } finally {
        raw.close()
      }
    } finally {
      await context.cleanup()
    }
  })

  it('maps a verified attempt to succeeded and rolls back terminal state with active attempts', async () => {
    const context = await draft('generation-terminal-verified')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expect(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 2,
          to: 'provider_failed',
          at: LATER,
          terminalClassification: 'provider_failure',
          stableErrorId: 'provider.transient-failure',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(context.database.generation.get(created.run.id)).toMatchObject({
        ok: true,
        value: { state: 'generating', revision: 2 },
      })
      const generatedArtifactId = await storeCandidate(context, attempt.id)
      const verification = await recordVerificationEvidence(
        context,
        created.run.id,
        generatedArtifactId,
        'verified',
      )
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: attempt.id,
          operation: 'code_generate',
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          providerRequestId: 'req_verified',
          codexThreadId: 'thread_verified',
          stableErrorId: null,
          usage: {
            providerRequests: 1,
            inputTokens: 0,
            outputTokens: 0,
            costMicrousd: 0,
            artifactBytes: 0,
          },
          recordedAt: LATER,
        }),
      )
      for (const [expectedRevision, to] of [
        [2, 'executing'],
        [3, 'verifying'],
      ] as const) {
        expectOk(
          context.database.generation.transition({
            runId: created.run.id,
            expectedRevision,
            to,
            at: LATER,
          }),
        )
      }
      expectOk(
        context.database.generation.completeAttempt({
          id: attempt.id,
          outcome: 'verified',
          providerRequestId: null,
          codexThreadId: null,
          artifactHash: sha('verified-candidate'),
          generatedArtifactId,
          verificationRunId: verification.id,
          findingsReference: null,
          completedAt: LATER,
        }),
      )
      settleScientificVersion(context, verification, generatedArtifactId, 'verified')
      expectOk(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 4,
          to: 'verified',
          at: LATER,
          terminalClassification: 'verified',
        }),
      )
      expect(legacyStatus(context.database.path, created.run.id)).toBe('succeeded')
    } finally {
      await context.cleanup()
    }
  })

  it('charges redacted failed calls before thread creation without fabricating request IDs', async () => {
    const context = await draft('generation-failed-call-metering')
    try {
      const created = expectOk(
        context.database.beginOrReplayGeneration({
          ...request(context.versionId),
          budgets: {
            providerRequests: 3,
            inputTokens: 1_000,
            outputTokens: 1_000,
            costMicrousd: 10_000,
            artifactBytes: 10_000,
          },
        }),
      )
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      const authenticationCall = {
        id: id(),
        runId: created.run.id,
        attemptId: attempt.id,
        operation: 'code_generate' as const,
        provider: 'fake',
        modelId: 'fake-coder-v1',
        templateVersion: 'generation.v1',
        providerRequestId: null,
        codexThreadId: null,
        stableErrorId: 'provider.authentication-failed',
        usage: {
          providerRequests: 1,
          inputTokens: 0,
          outputTokens: 0,
          costMicrousd: 0,
          artifactBytes: 0,
        },
        recordedAt: LATER,
      }
      expectOk(context.database.generation.recordExternalCall(authenticationCall))
      expectOk(context.database.generation.recordExternalCall(authenticationCall))
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: attempt.id,
          operation: 'code_generate',
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          providerRequestId: 'req_transient_1',
          codexThreadId: null,
          stableErrorId: 'provider.transient-failure',
          usage: {
            providerRequests: 1,
            inputTokens: 25,
            outputTokens: 0,
            costMicrousd: 100,
            artifactBytes: 0,
          },
          recordedAt: LATER,
        }),
      )
      expect(expectOk(context.database.generation.externalCalls(created.run.id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerRequestId: null,
            codexThreadId: null,
            stableErrorId: 'provider.authentication-failed',
          }),
          expect.objectContaining({
            providerRequestId: 'req_transient_1',
            codexThreadId: null,
            stableErrorId: 'provider.transient-failure',
          }),
        ]),
      )
      expect(context.database.generation.get(created.run.id)).toMatchObject({
        ok: true,
        value: { usage: { providerRequests: 3, inputTokens: 25, costMicrousd: 100 } },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('records a successful Codex turn by thread when the SDK exposes no request ID', async () => {
    const context = await draft('generation-codex-thread-provenance')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'codex-sdk',
          modelId: 'gpt-5.1-codex',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: created.run.id,
          attemptId: attempt.id,
          operation: 'code_generate',
          provider: 'codex-sdk',
          modelId: 'gpt-5.1-codex',
          templateVersion: 'generation.v1',
          providerRequestId: null,
          codexThreadId: 'thread_codex_1',
          stableErrorId: null,
          usage: {
            providerRequests: 1,
            inputTokens: 10,
            outputTokens: 20,
            costMicrousd: 30,
            artifactBytes: 40,
          },
          recordedAt: LATER,
        }),
      )
      expect(expectOk(context.database.generation.externalCalls(created.run.id))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerRequestId: null,
            codexThreadId: 'thread_codex_1',
            stableErrorId: null,
          }),
        ]),
      )
    } finally {
      await context.cleanup()
    }
  })

  it('records an invariant-failed active attempt without provider misclassification', async () => {
    const context = await draft('generation-invariant-attempt')
    try {
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      moveToGenerating(context.database, created.run.id)
      const attempt = expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )
      expectOk(
        context.database.generation.completeAttempt({
          id: attempt.id,
          outcome: 'invariant_failed',
          providerRequestId: null,
          codexThreadId: null,
          artifactHash: null,
          generatedArtifactId: null,
          verificationRunId: null,
          findingsReference: null,
          stableErrorId: 'orchestration.invariant-failed',
          completedAt: LATER,
        }),
      )
      expectOk(
        context.database.generation.transition({
          runId: created.run.id,
          expectedRevision: 2,
          to: 'invariant_failed',
          at: LATER,
          terminalClassification: 'invariant_failure',
          stableErrorId: 'orchestration.invariant-failed',
        }),
      )
      expect(context.database.generation.attempts(created.run.id)).toMatchObject({
        ok: true,
        value: [{ outcome: 'invariant_failed', stableErrorId: 'orchestration.invariant-failed' }],
      })
      expect(legacyStatus(context.database.path, created.run.id)).toBe('operational-failure')
    } finally {
      await context.cleanup()
    }
  })

  it('rejects unknown sensitive fields instead of persisting credentials or raw reasoning', async () => {
    const context = await draft('generation-sensitive-fields')
    try {
      expect(
        context.database.beginOrReplayGeneration({
          ...request(context.versionId),
          apiKey: 'secret',
        } as Parameters<typeof context.database.beginOrReplayGeneration>[0]),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      const created = expectOk(context.database.beginOrReplayGeneration(request(context.versionId)))
      expect(
        context.database.generation.startAttempt({
          id: id(),
          runId: created.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-coder-v1',
          templateVersion: 'generation.v1',
          createdAt: NOW,
          rawReasoning: 'private chain',
        } as Parameters<typeof context.database.generation.startAttempt>[0]),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    } finally {
      await context.cleanup()
    }
  })
})
