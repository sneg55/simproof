import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { expectOk, id, NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

const LATER = '2026-07-16T12:00:01.000Z'

describe('durable reverification lifecycle', () => {
  it('atomically accepts a stale bound version and replays the original run', async () => {
    const context = await verifiedFixture('reverification-replay')
    try {
      const stale = expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 4,
          to: 'stale',
          updatedAt: NOW,
        }),
      )
      const input = {
        versionId: context.versionId,
        expectedRevision: stale.revision,
        idempotencyKey: 'reverify:persistence:replay',
        runId: id(),
        attemptId: id(),
        at: LATER,
      }
      const begun = expectOk(context.database.generation.beginOrReplayReverification(input))
      expect(begun).toMatchObject({ created: true, run: { state: 'executing', revision: 0 } })
      expect(begun.version).toMatchObject({
        state: 'verifying',
        revision: stale.revision + 1,
        activeConceptSpecId: context.conceptSpecId,
        activeGeneratedArtifactId: context.generatedArtifactId,
        activeVerificationRunId: context.verificationRun.id,
      })

      const replay = expectOk(
        context.database.generation.beginOrReplayReverification({
          ...input,
          runId: id(),
          attemptId: id(),
        }),
      )
      expect(replay).toMatchObject({ created: false, run: { id: begun.run.id } })
      expect(context.database.generation.attempts(begun.run.id)).toMatchObject({
        ok: true,
        value: [{ provider: 'simproof-reverify', outcome: 'pending' }],
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects wrong revisions, non-stale states, and cross-operation idempotency keys', async () => {
    const context = await verifiedFixture('reverification-rejection')
    try {
      const base = {
        versionId: context.versionId,
        expectedRevision: 4,
        idempotencyKey: 'reverify:persistence:reject',
        runId: id(),
        attemptId: id(),
        at: LATER,
      }
      expect(context.database.generation.beginOrReplayReverification(base)).toMatchObject({
        ok: false,
        error: { code: 'invalid-state' },
      })
      const stale = expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 4,
          to: 'stale',
          updatedAt: NOW,
        }),
      )
      expect(
        context.database.generation.beginOrReplayReverification({
          ...base,
          expectedRevision: stale.revision - 1,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
    } finally {
      await context.cleanup()
    }
  })

  it('cancels and recovers without clearing the immutable bound content', async () => {
    for (const mode of ['cancel', 'recover'] as const) {
      const context = await verifiedFixture(`reverification-${mode}`)
      try {
        const stale = expectOk(
          context.database.transitionVersion({
            id: context.versionId,
            expectedRevision: 4,
            to: 'stale',
            updatedAt: NOW,
          }),
        )
        const begun = expectOk(
          context.database.generation.beginOrReplayReverification({
            versionId: context.versionId,
            expectedRevision: stale.revision,
            idempotencyKey: `reverify:persistence:${mode}`,
            runId: id(),
            attemptId: id(),
            at: LATER,
          }),
        )
        if (mode === 'cancel') {
          expectOk(
            context.database.generation.requestCancellation({
              runId: begun.run.id,
              expectedRevision: begun.run.revision,
              at: LATER,
            }),
          )
        } else {
          expectOk(context.database.generation.recoverInterrupted({ at: LATER }))
        }
        expect(context.database.getVersion(context.versionId)).toMatchObject({
          ok: true,
          value: {
            state: 'stale',
            activeConceptSpecId: context.conceptSpecId,
            activeGeneratedArtifactId: context.generatedArtifactId,
            activeVerificationRunId: context.verificationRun.id,
          },
        })
      } finally {
        await context.cleanup()
      }
    }
  })

  it.each(['cancel', 'recover'] as const)(
    'rejects malformed reserved identity during operational %s without clearing selections',
    async (mode) => {
      const context = await verifiedFixture(`reverification-malformed-${mode}`)
      try {
        const stale = expectOk(
          context.database.transitionVersion({
            id: context.versionId,
            expectedRevision: 4,
            to: 'stale',
            updatedAt: NOW,
          }),
        )
        const begun = expectOk(
          context.database.generation.beginOrReplayReverification({
            versionId: context.versionId,
            expectedRevision: stale.revision,
            idempotencyKey: `reverify:persistence:malformed:${mode}`,
            runId: id(),
            attemptId: id(),
            at: LATER,
          }),
        )
        const raw = new DatabaseSync(context.database.path)
        raw
          .prepare(
            "UPDATE generation_pipeline_attempts SET model_id='spoofed-model' WHERE run_id=?",
          )
          .run(begun.run.id)
        raw.close()

        const result =
          mode === 'cancel'
            ? context.database.generation.requestCancellation({
                runId: begun.run.id,
                expectedRevision: begun.run.revision,
                at: LATER,
              })
            : context.database.generation.recoverInterrupted({ at: LATER })
        expect(result).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
        expect(context.database.getVersion(context.versionId)).toMatchObject({
          ok: true,
          value: {
            state: 'verifying',
            activeConceptSpecId: context.conceptSpecId,
            activeGeneratedArtifactId: context.generatedArtifactId,
            activeVerificationRunId: context.verificationRun.id,
          },
        })
        expect(context.database.generation.get(begun.run.id)).toMatchObject({
          ok: true,
          value: { state: 'executing', completedAt: null },
        })
        expect(context.database.generation.attempts(begun.run.id)).toMatchObject({
          ok: true,
          value: [{ outcome: 'pending', generatedArtifactId: context.generatedArtifactId }],
        })
      } finally {
        await context.cleanup()
      }
    },
  )
})
