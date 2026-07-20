import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { preparedReverification, reverifySnapshot } from './reverification.test-support.js'
import { id, sha } from './test-helpers.js'

describe('atomic reverification finalization', () => {
  it.each(['verified', 'rejected'] as const)(
    'atomically selects new immutable %s evidence and settles both run records',
    async (outcome) => {
      const context = await preparedReverification(`finalize-${outcome}`, outcome)
      try {
        const finalized = await context.database.reverification.finalize(
          context.input,
          context.store,
        )
        expect(finalized).toMatchObject({
          ok: true,
          value: {
            version: {
              state: outcome,
              activeVerificationRunId: context.verificationRun.id,
            },
          },
        })
        expect(context.database.generation.attempts(context.begun.run.id)).toMatchObject({
          ok: true,
          value: [
            {
              outcome,
              verificationRunId: context.verificationRun.id,
              findingsReference: context.verificationRun.report.contentHash,
            },
          ],
        })
        expect(context.database.generation.get(context.begun.run.id)).toMatchObject({
          ok: true,
          value: {
            state: outcome,
            terminalClassification: outcome === 'verified' ? 'verified' : 'scientific_rejection',
            findingsReference:
              outcome === 'verified' ? null : context.verificationRun.report.contentHash,
          },
        })
        const raw = new DatabaseSync(context.database.path)
        expect(
          raw.prepare('SELECT status FROM generation_runs WHERE id=?').get(context.begun.run.id),
        ).toEqual({ status: outcome === 'verified' ? 'succeeded' : 'rejected' })
        raw.close()
      } finally {
        await context.cleanup()
      }
    },
  )

  it.each([
    ['findings reference', (_context: Context) => ({ findingsReference: sha('wrong-report') })],
    ['artifact hash', (_context: Context) => ({ artifactHash: sha('wrong-core') })],
    ['attempt identity', (_context: Context) => ({ attemptId: id() })],
    ['verification identity', (_context: Context) => ({ verificationRunId: id() })],
    [
      'borrowed prior evidence',
      (context: Context) => ({
        verificationRunId: context.priorVerificationRun.id,
        findingsReference: context.priorVerificationRun.report.contentHash,
      }),
    ],
    ['version revision', (_context: Context) => ({ expectedVersionRevision: 0 })],
    ['run revision', (_context: Context) => ({ expectedRunRevision: 0 })],
    ['report verdict', (_context: Context) => ({ outcome: 'rejected' as const })],
  ] as const)('rejects a mismatched %s without changing the aggregate', async (_name, patch) => {
    const context = await preparedReverification(`mismatch-${String(_name).replaceAll(' ', '-')}`)
    try {
      const before = reverifySnapshot(context)
      const result = await context.database.reverification.finalize(
        { ...context.input, ...patch(context) },
        context.store,
      )
      expect(result).toMatchObject({ ok: false })
      expect(reverifySnapshot(context)).toEqual(before)
    } finally {
      await context.cleanup()
    }
  })

  it('rolls every aggregate write back when legacy settlement fails late', async () => {
    const context = await preparedReverification('late-sql-rollback')
    try {
      const before = reverifySnapshot(context)
      const raw = new DatabaseSync(context.database.path)
      raw.exec(`CREATE TRIGGER injected_reverify_failure BEFORE UPDATE ON generation_runs
        WHEN NEW.id='${context.begun.run.id}' BEGIN SELECT RAISE(ABORT,'injected'); END`)
      raw.close()
      await expect(
        context.database.reverification.finalize(context.input, context.store),
      ).resolves.toMatchObject({ ok: false })
      expect(reverifySnapshot(context)).toEqual(before)
    } finally {
      await context.cleanup()
    }
  })

  it('rejects a tampered verification report hash without partially settling', async () => {
    const context = await preparedReverification('report-hash-tamper')
    try {
      const before = reverifySnapshot(context)
      const raw = new DatabaseSync(context.database.path)
      raw.exec('DROP TRIGGER immutable_verification_run')
      raw
        .prepare('UPDATE verification_runs SET report_hash=? WHERE id=?')
        .run(sha('tampered-report'), context.verificationRun.id)
      raw.close()
      await expect(
        context.database.reverification.finalize(context.input, context.store),
      ).resolves.toMatchObject({ ok: false })
      expect(reverifySnapshot(context)).toEqual(before)
    } finally {
      await context.cleanup()
    }
  })
})

type Context = Awaited<ReturnType<typeof preparedReverification>>
