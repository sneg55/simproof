import { writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { preparedReverification, reverifySnapshot } from './reverification.test-support.js'

describe('reverification fail-closed settlement', () => {
  it('refuses finalization when the installed authority changed', async () => {
    const context = await preparedReverification('changed-installed-authority')
    try {
      const before = reverifySnapshot(context)
      context.setInstalledEnvironment({ ...context.environment, runnerVersion: '2.0.0' })
      await expect(
        context.database.reverification.finalize(context.input, context.store),
      ).resolves.toMatchObject({ ok: false })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: {
          state: 'stale',
          activeVerificationRunId: context.priorVerificationRun.id,
        },
      })
      expect(context.database.generation.get(context.begun.run.id)).toEqual({
        ok: true,
        value: before.run,
      })
      expect(context.database.generation.attempts(context.begun.run.id)).toEqual({
        ok: true,
        value: before.attempts,
      })
    } finally {
      await context.cleanup()
    }
  })

  it.each(['concept', 'renderer', 'manifest', 'report'] as const)(
    'refuses finalization when the bound %s artifact is corrupt',
    async (kind) => {
      const context = await preparedReverification(`corrupt-${kind}`)
      try {
        const before = reverifySnapshot(context)
        const hash = corruptibleHash(context, kind)
        await writeFile(context.store.pathForHash(hash), `tampered ${kind}`)
        await expect(
          context.database.reverification.finalize(context.input, context.store),
        ).resolves.toMatchObject({ ok: false })
        expect(context.database.getVersion(context.versionId)).toMatchObject({
          ok: true,
          value: {
            state: 'stale',
            activeVerificationRunId: context.priorVerificationRun.id,
          },
        })
        expect(context.database.generation.get(context.begun.run.id)).toEqual({
          ok: true,
          value: before.run,
        })
        expect(context.database.generation.attempts(context.begun.run.id)).toEqual({
          ok: true,
          value: before.attempts,
        })
      } finally {
        await context.cleanup()
      }
    },
  )

  it('keeps cancellation as the sole winner when it settles first', async () => {
    const context = await preparedReverification('cancel-wins-race')
    try {
      expect(
        context.database.generation.requestCancellation({
          runId: context.begun.run.id,
          expectedRevision: context.verifying.revision,
          at: context.input.at,
        }),
      ).toMatchObject({ ok: true, value: { state: 'cancelled' } })
      await expect(
        context.database.reverification.finalize(context.input, context.store),
      ).resolves.toMatchObject({ ok: false })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'stale', activeVerificationRunId: context.priorVerificationRun.id },
      })
      expect(context.database.generation.attempts(context.begun.run.id)).toMatchObject({
        ok: true,
        value: [{ outcome: 'cancelled', verificationRunId: null }],
      })
    } finally {
      await context.cleanup()
    }
  })

  it('keeps scientific finalization as the sole winner when it settles first', async () => {
    const context = await preparedReverification('finalize-wins-race')
    try {
      await expect(
        context.database.reverification.finalize(context.input, context.store),
      ).resolves.toMatchObject({ ok: true })
      const finalized = reverifySnapshot(context)
      expect(
        context.database.generation.requestCancellation({
          runId: context.begun.run.id,
          expectedRevision: finalized.run.revision,
          at: context.input.at,
        }),
      ).toMatchObject({ ok: false })
      expect(reverifySnapshot(context)).toEqual(finalized)
    } finally {
      await context.cleanup()
    }
  })
})

function corruptibleHash(
  context: Awaited<ReturnType<typeof preparedReverification>>,
  kind: 'concept' | 'renderer' | 'manifest' | 'report',
): string {
  if (kind === 'concept') return context.evidence.conceptSpecArtifact.contentHash
  if (kind === 'report') return context.verificationRun.report.contentHash
  if (kind === 'renderer') return context.artifactBundle.renderer.contentHash
  return context.artifactBundle.manifest.contentHash
}
