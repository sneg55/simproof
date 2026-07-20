import type { VerificationFinding, VerificationRun } from '@simproof/contracts'

import type { FinalizeReverificationInput } from './reverification-finalization.js'
import { expectOk, id, NOW, stored } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

export const LATER = '2026-07-16T12:00:01.000Z'

const rejectedFinding: VerificationFinding = {
  id: 'pendulum.period.mismatch',
  category: 'mismatch',
  severity: 'error',
  checkId: 'period.matches',
  quantity: 'periodS',
  inputs: { length: { value: 1, unit: 'm' } },
  expected: { value: 2, unit: 's' },
  actual: { value: 3, unit: 's' },
  tolerance: { mode: 'absolute', absolute: 0.01, unit: 's' },
  error: { mode: 'absolute', value: 1, unit: 's' },
  explanation: 'The generated period is outside the trusted tolerance.',
}

export async function preparedReverification(
  name: string,
  outcome: 'verified' | 'rejected' = 'verified',
) {
  const context = await verifiedFixture(name)
  const priorVerificationRun = context.verificationRun
  const stale = expectOk(
    context.database.transitionVersion({
      id: context.versionId,
      expectedRevision: 4,
      to: 'stale',
      updatedAt: NOW,
    }),
  )
  const attemptId = id()
  const begun = expectOk(
    context.database.generation.beginOrReplayReverification({
      versionId: context.versionId,
      expectedRevision: stale.revision,
      idempotencyKey: `reverify:${name}`,
      runId: id(),
      attemptId,
      at: LATER,
    }),
  )
  const verifying = expectOk(
    context.database.generation.transition({
      runId: begun.run.id,
      expectedRevision: begun.run.revision,
      to: 'verifying',
      at: LATER,
    }),
  )
  const original = expectOk(await context.store.get(context.evidence.report.contentHash))
  const report = JSON.parse(original.toString('utf8')) as Record<string, unknown>
  const findings = outcome === 'rejected' ? [rejectedFinding] : []
  const reportArtifact = await stored(
    context.database,
    context.store,
    'verification-report',
    JSON.stringify({
      ...report,
      reportId: id(),
      createdAt: LATER,
      verdict: outcome,
      checks: [
        {
          id: 'period.matches',
          outcome: outcome === 'verified' ? 'passed' : 'failed',
          sampleCount: 1,
        },
      ],
      findings,
    }),
  )
  const verificationRun: VerificationRun = {
    ...context.verificationRun,
    id: id(),
    report: {
      artifactId: reportArtifact.id,
      role: 'verification-report',
      contentHash: reportArtifact.contentHash,
    },
    verdict: outcome,
    createdAt: LATER,
  }
  expectOk(
    await context.database.verification.insert(
      verificationRun,
      findings.map((finding, ordinal) => ({
        id: id(),
        verificationRunId: verificationRun.id,
        ordinal,
        finding,
        createdAt: LATER,
      })),
      context.store,
    ),
  )
  const input: FinalizeReverificationInput = {
    versionId: context.versionId,
    expectedVersionRevision: begun.version.revision,
    runId: begun.run.id,
    expectedRunRevision: verifying.revision,
    attemptId,
    verificationRunId: verificationRun.id,
    artifactHash: context.artifactBundle.core.contentHash,
    findingsReference: reportArtifact.contentHash,
    outcome,
    at: LATER,
  }
  return {
    ...context,
    priorVerificationRun,
    stale,
    begun,
    verifying,
    attemptId,
    verificationRun,
    input,
  }
}

export function reverifySnapshot(context: Awaited<ReturnType<typeof preparedReverification>>) {
  return {
    version: expectOk(context.database.getVersion(context.versionId)),
    run: expectOk(context.database.generation.get(context.begun.run.id)),
    attempts: expectOk(context.database.generation.attempts(context.begun.run.id)),
    history: expectOk(context.database.generation.history(context.begun.run.id)),
  }
}
