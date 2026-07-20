import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { VerificationFinding, VerificationRun } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { backupPersistence, restorePersistence } from './backup.js'
import { createPersistence } from './database.js'
import { expectOk, id, NOW, stored } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('inapplicable verification lifecycle semantics', () => {
  it('finalizes to stale and remains durable without badge or publication eligibility', async () => {
    const context = await verifiedFixture('inapplicable-finalization')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-inapplicable-finalization-'))
    try {
      expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 4,
          to: 'stale',
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 5,
          to: 'verifying',
          updatedAt: NOW,
        }),
      )
      const run = await insertInapplicableRun(context)
      expect(
        expectOk(
          await context.database.verification.finalizeVersion(
            {
              versionId: context.versionId,
              expectedRevision: 6,
              verificationRunId: run.id,
              updatedAt: NOW,
            },
            context.store,
          ),
        ),
      ).toMatchObject({ state: 'stale', revision: 7, activeVerificationRunId: run.id })
      expectOk(await context.database.validateStoredRecords(context.store))
      expect(
        await context.database.verification.currentValidity(run.id, context.store),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(
        await context.database.verification.publish(
          {
            id: id(),
            simulationVersionId: context.versionId,
            exportLicense: { kind: 'none' },
            publishedAt: NOW,
          },
          7,
          context.store,
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })

      const backup = join(parent, 'backup')
      const restored = join(parent, 'restored')
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      expectOk(await restorePersistence({ backup, destination: restored }))
      const restoredDatabase = createPersistence(join(restored, 'metadata.sqlite'))
      try {
        expect(restoredDatabase.getVersion(context.versionId)).toMatchObject({
          ok: true,
          value: { state: 'stale', activeVerificationRunId: run.id },
        })
      } finally {
        restoredDatabase.close()
      }
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })
})

async function insertInapplicableRun(
  context: Awaited<ReturnType<typeof verifiedFixture>>,
): Promise<VerificationRun> {
  const finding: VerificationFinding = {
    id: 'pendulum.domain.inapplicable',
    category: 'applicability',
    severity: 'error',
    checkId: 'domain.applicable',
    quantity: 'amplitudeDeg',
    inputs: { amplitude: { value: 90, unit: 'deg' } },
    expected: { value: 20, unit: 'deg' },
    actual: { value: 90, unit: 'deg' },
    tolerance: { mode: 'absolute', absolute: 0, unit: 'deg' },
    error: { mode: 'absolute', value: 70, unit: 'deg' },
    explanation: 'The requested amplitude is outside this verifier policy domain.',
  }
  const original = expectOk(await context.store.get(context.evidence.report.contentHash))
  const report = JSON.parse(original.toString('utf8')) as Record<string, unknown>
  const storedReport = await stored(
    context.database,
    context.store,
    'verification-report',
    JSON.stringify({
      ...report,
      reportId: id(),
      verdict: 'inapplicable',
      checks: [{ id: 'domain.applicable', outcome: 'not-applicable', sampleCount: 1 }],
      findings: [finding],
    }),
  )
  const run: VerificationRun = {
    ...context.verificationRun,
    id: id(),
    verdict: 'inapplicable',
    report: {
      artifactId: storedReport.id,
      role: 'verification-report',
      contentHash: storedReport.contentHash,
    },
  }
  expectOk(
    await context.database.verification.insert(
      run,
      [{ id: id(), verificationRunId: run.id, ordinal: 0, finding, createdAt: NOW }],
      context.store,
    ),
  )
  return run
}
