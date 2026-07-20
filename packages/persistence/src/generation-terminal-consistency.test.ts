// LOC-EXEMPT: The shared scientific-evidence fixture and terminal fault/recovery matrix are audited together.
// LOC-EXEMPT: Cohesive durable-boundary fixtures exercise scientific evidence, atomic rollback, and interrupted-settlement recovery together.
import { DatabaseSync } from 'node:sqlite'

import type { ArtifactBundle } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { expectOk, fixture, id, NOW, sha, stored } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

async function draft(name: string) {
  const context = await fixture(name)
  const simulationId = id()
  const versionId = id()
  expectOk(
    context.database.createSimulation({
      id: simulationId,
      title: 'Terminal consistency',
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
  const run = expectOk(
    context.database.beginOrReplayGeneration({
      versionId,
      expectedRevision: 0,
      idempotencyKey: `terminal-${name}`,
      updatedAt: NOW,
      run: { id: id(), maxAttempts: 1, codexSessionId: null, createdAt: NOW },
      budgets: {
        providerRequests: 4,
        inputTokens: 1_000,
        outputTokens: 1_000,
        costMicrousd: 10_000,
        artifactBytes: 100_000,
      },
    }),
  ).run
  return { ...context, versionId, run }
}

async function scientificAttempt(
  context: Awaited<ReturnType<typeof draft>>,
  verdict: 'verified' | 'rejected',
) {
  expectOk(
    context.database.generation.transition({
      runId: context.run.id,
      expectedRevision: 0,
      to: 'compiling',
      at: NOW,
    }),
  )
  expectOk(
    context.database.generation.recordExternalCall({
      id: id(),
      runId: context.run.id,
      attemptId: null,
      operation: 'concept_compile',
      provider: 'fake',
      modelId: 'fake-concept',
      templateVersion: 'concept.v1',
      providerRequestId: `concept-${context.run.id}`,
      codexThreadId: null,
      stableErrorId: null,
      usage: {
        providerRequests: 1,
        inputTokens: 1,
        outputTokens: 1,
        costMicrousd: 1,
        artifactBytes: 0,
      },
      recordedAt: NOW,
    }),
  )
  expectOk(
    context.database.generation.transition({
      runId: context.run.id,
      expectedRevision: 1,
      to: 'generating',
      at: NOW,
    }),
  )
  const attempt = expectOk(
    context.database.generation.startAttempt({
      id: id(),
      runId: context.run.id,
      attemptNumber: 1,
      provider: 'fake',
      modelId: 'fake-code',
      templateVersion: 'generation.v1',
      createdAt: NOW,
    }),
  )
  expectOk(
    context.database.generation.recordExternalCall({
      id: id(),
      runId: context.run.id,
      attemptId: attempt.id,
      operation: 'code_generate',
      provider: 'fake',
      modelId: 'fake-code',
      templateVersion: 'generation.v1',
      providerRequestId: `code-${context.run.id}`,
      codexThreadId: 'thread-1',
      stableErrorId: null,
      usage: {
        providerRequests: 1,
        inputTokens: 1,
        outputTokens: 1,
        costMicrousd: 1,
        artifactBytes: 1,
      },
      recordedAt: NOW,
    }),
  )
  const core = await stored(context.database, context.store, 'core-source', 'export default {}')
  const renderer = await stored(context.database, context.store, 'renderer-data', '{"kind":"x"}')
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
      generationAttemptId: attempt.id,
      artifactBundle,
      exportLicense: { kind: 'none' },
      createdAt: NOW,
    }),
  )
  for (const [expectedRevision, to] of [
    [2, 'executing'],
    [3, 'verifying'],
  ] as const) {
    expectOk(
      context.database.generation.transition({
        runId: context.run.id,
        expectedRevision,
        to,
        at: NOW,
      }),
    )
  }
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
      generationRunId: context.run.id,
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
      contentHash: sha(`policy-${context.run.id}`),
      createdAt: NOW,
    }),
  )
  const domainPack = expectOk(
    context.database.records.ensureDomainPackReference({
      id: id(),
      domainPackId: 'pendulum',
      version: '1.0.0',
      contentHash: sha(`pack-${context.run.id}`),
      createdAt: NOW,
    }),
  )
  const report = await stored(context.database, context.store, 'verification-report', '{}')
  const verificationRunId = id()
  const raw = new DatabaseSync(context.database.path)
  try {
    raw
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
        JSON.stringify(artifactBundle),
        policy.id,
        domainPack.id,
        policy.contentHash,
        domainPack.contentHash,
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
  } finally {
    raw.close()
  }
  return { attempt, artifactBundle, conceptSpecId, generatedArtifactId, verificationRunId }
}

function completion(
  evidence: Awaited<ReturnType<typeof scientificAttempt>>,
  outcome: 'verified' | 'rejected',
  verificationRunId: string | null,
) {
  return {
    id: evidence.attempt.id,
    outcome,
    providerRequestId: 'code-request',
    codexThreadId: 'thread-1',
    artifactHash: sha('candidate'),
    generatedArtifactId: evidence.generatedArtifactId,
    verificationRunId,
    findingsReference: outcome === 'rejected' ? 'findings:rejected' : null,
    completedAt: LATER,
  }
}

function settleVersion(
  path: string,
  versionId: string,
  evidence: Awaited<ReturnType<typeof scientificAttempt>>,
  state: 'verified' | 'rejected',
) {
  const raw = new DatabaseSync(path)
  try {
    raw
      .prepare(`UPDATE simulation_versions SET state=?,revision=revision+1,
      active_concept_spec_id=?,active_generated_artifact_id=?,active_artifact_bundle_json=?,
      active_verification_run_id=?,updated_at=? WHERE id=?`)
      .run(
        state,
        evidence.conceptSpecId,
        evidence.generatedArtifactId,
        JSON.stringify(evidence.artifactBundle),
        evidence.verificationRunId,
        LATER,
        versionId,
      )
  } finally {
    raw.close()
  }
}

describe('generation terminal aggregate consistency', () => {
  it.each([
    ['cancel', 'cancelled', null],
    ['invariant-failure', 'invariant_failed', 'orchestration.invariant-failed'],
  ] as const)('settles an active attempt atomically for %s', async (decision, outcome, errorId) => {
    const context = await draft(`active-${decision}`)
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'compiling',
          at: NOW,
        }),
      )
      expectOk(
        context.database.generation.recordExternalCall({
          id: id(),
          runId: context.run.id,
          attemptId: null,
          operation: 'concept_compile',
          provider: 'fake',
          modelId: 'fake-concept',
          templateVersion: 'concept.v1',
          providerRequestId: `concept-${decision}`,
          codexThreadId: null,
          stableErrorId: null,
          usage: {
            providerRequests: 1,
            inputTokens: 1,
            outputTokens: 1,
            costMicrousd: 1,
            artifactBytes: 0,
          },
          recordedAt: NOW,
        }),
      )
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 1,
          to: 'generating',
          at: NOW,
        }),
      )
      expectOk(
        context.database.generation.startAttempt({
          id: id(),
          runId: context.run.id,
          attemptNumber: 1,
          provider: 'fake',
          modelId: 'fake-code',
          templateVersion: 'generation.v1',
          createdAt: NOW,
        }),
      )

      expectOk(
        context.database.generation.settleConcept({
          decision,
          runId: context.run.id,
          expectedRunRevision: 2,
          at: LATER,
        }),
      )

      expect(expectOk(context.database.generation.attempts(context.run.id))[0]).toMatchObject({
        outcome,
        stableErrorId: errorId,
        completedAt: LATER,
      })
      expect(expectOk(context.database.generation.get(context.run.id)).state).toBe(outcome)
      expect(expectOk(context.database.getVersion(context.versionId)).state).toBe('draft')
    } finally {
      await context.cleanup()
    }
  })

  it('requires matching immutable verification evidence for scientific attempt completion', async () => {
    const context = await draft('scientific-attempt-evidence')
    try {
      const evidence = await scientificAttempt(context, 'rejected')
      expect(
        context.database.generation.completeAttempt(completion(evidence, 'rejected', null)),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(
        context.database.generation.completeAttempt(
          completion(evidence, 'verified', evidence.verificationRunId),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expectOk(
        context.database.generation.completeAttempt(
          completion(evidence, 'rejected', evidence.verificationRunId),
        ),
      )
    } finally {
      await context.cleanup()
    }
  })

  it('atomically returns a generating version to draft with an operational terminal', async () => {
    const context = await draft('operational-terminal-settlement')
    try {
      expectOk(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'invariant_failed',
          at: LATER,
          terminalClassification: 'invariant_failure',
          stableErrorId: 'orchestration.invariant-failed',
        }),
      )
      expect(expectOk(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'draft',
        activeConceptSpecId: null,
        activeGeneratedArtifactId: null,
        activeArtifactBundle: null,
        activeVerificationRunId: null,
      })
    } finally {
      await context.cleanup()
    }
  })

  it('settles operational version state in the same transaction and rolls back on a fault', async () => {
    const context = await draft('operational-terminal-atomic')
    try {
      const fault = new DatabaseSync(context.database.path)
      try {
        fault.exec(`CREATE TRIGGER fail_pipeline_terminal BEFORE UPDATE OF state
          ON generation_pipeline_runs WHEN NEW.completed_at IS NOT NULL
          BEGIN SELECT RAISE(ABORT,'forced terminal fault'); END;`)
      } finally {
        fault.close()
      }
      expect(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 0,
          to: 'invariant_failed',
          at: LATER,
          terminalClassification: 'invariant_failure',
          stableErrorId: 'orchestration.invariant-failed',
        }),
      ).toMatchObject({ ok: false, error: { code: 'database-error' } })
      expect(expectOk(context.database.getVersion(context.versionId)).state).toBe('generating')
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'queued',
        completedAt: null,
      })
      const repair = new DatabaseSync(context.database.path)
      try {
        repair.exec('DROP TRIGGER fail_pipeline_terminal')
        repair
          .prepare(`UPDATE simulation_versions SET state='draft',revision=revision+1,
            active_concept_spec_id=NULL,active_generated_artifact_id=NULL,
            active_artifact_bundle_json=NULL,active_verification_run_id=NULL,updated_at=?
            WHERE id=?`)
          .run(LATER, context.versionId)
      } finally {
        repair.close()
      }
      expectOk(context.database.generation.recoverInterrupted({ at: LATER }))
      expect(expectOk(context.database.getVersion(context.versionId)).state).toBe('draft')
    } finally {
      await context.cleanup()
    }
  })

  it('requires a settled scientific version and recovers a half-settled aggregate', async () => {
    const context = await draft('scientific-terminal-recovery')
    try {
      const evidence = await scientificAttempt(context, 'rejected')
      expectOk(
        context.database.generation.completeAttempt(
          completion(evidence, 'rejected', evidence.verificationRunId),
        ),
      )
      expect(
        context.database.generation.transition({
          runId: context.run.id,
          expectedRevision: 4,
          to: 'rejected',
          at: LATER,
          terminalClassification: 'scientific_rejection',
          findingsReference: 'findings:rejected',
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      settleVersion(context.database.path, context.versionId, evidence, 'rejected')
      expectOk(context.database.generation.recoverInterrupted({ at: LATER }))
      expect(expectOk(context.database.generation.get(context.run.id))).toMatchObject({
        state: 'rejected',
        terminalClassification: 'scientific_rejection',
      })
      expect(expectOk(context.database.getVersion(context.versionId)).state).toBe('rejected')
    } finally {
      await context.cleanup()
    }
  })
})
