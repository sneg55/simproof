import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import type { RunnerRequest } from '@simproof/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EducatorReportProjection } from '../educator/report-projection.js'
import {
  cleanupReverificationRoots,
  NOW,
  reverifyRequest as request,
  setupReverification as setup,
  successfulResponse,
  terminal,
  unwrap,
} from './reverification.test-support.js'
import { ReverificationService } from './reverification-service.js'
import type { TrustedRunnerAdapter } from './trusted-runner-adapter.js'

afterEach(async () => {
  await cleanupReverificationRoots()
})

async function invalidateCore(
  context: Awaited<ReturnType<typeof setup>>,
  mode: 'missing-artifact' | 'corrupt-artifact',
): Promise<void> {
  const coreHash = context.stale.activeArtifactBundle?.core.contentHash
  if (coreHash === undefined) throw new TypeError('Expected bound core.')
  if (mode === 'missing-artifact') unwrap(await context.store.delete(coreHash))
  else await writeFile(context.store.pathForHash(coreHash), 'tampered core')
}

describe('reverification service', () => {
  it('executes the exact bound core, persists new evidence, and replays without provider calls', async () => {
    const context = await setup()
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner: context.runner,
      verifier: context.verifier,
      id: randomUUID,
      now: () => NOW,
    })
    try {
      const accepted = await service.start(context.versionId, request(context.stale.revision))
      expect(accepted).toMatchObject({ ok: true, value: { created: true, state: 'executing' } })
      if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
      const status = await terminal(service, accepted.value.runId)
      expect(status).toMatchObject({
        state: 'verified',
        attempts: [{ outcome: 'verified' }],
      })
      expect(service.owns(accepted.value.runId)).toBe(true)
      const current = unwrap(context.database.getVersion(context.versionId))
      expect(current).toMatchObject({ state: 'verified' })
      expect(current.activeVerificationRunId).not.toBe(context.oldVerificationRunId)
      expect(context.execute).toHaveBeenCalledTimes(2)
      const coreHash = context.stale.activeArtifactBundle?.core.contentHash
      if (coreHash === undefined) throw new TypeError('Expected bound core evidence.')
      const core = unwrap(await context.store.get(coreHash)).toString('utf8')
      const runnerRequest = context.execute.mock.calls.at(-1)?.[0] as RunnerRequest | undefined
      expect(runnerRequest?.artifact).toEqual({
        format: 'javascript-esm',
        content: core,
        hash: coreHash,
      })
      expect(context.providerCalls.compile).toHaveBeenCalledTimes(1)
      expect(context.providerCalls.generate).toHaveBeenCalledTimes(1)
      await expect(service.cancel(accepted.value.runId, status.revision)).resolves.toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      expect(unwrap(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'verified',
        activeVerificationRunId: current.activeVerificationRunId,
      })

      const replay = await service.start(context.versionId, request(context.stale.revision))
      expect(replay).toMatchObject({
        ok: true,
        value: { created: false, runId: accepted.value.runId, state: 'verified' },
      })
      expect(context.execute).toHaveBeenCalledTimes(2)
      expect(context.providerCalls.compile).toHaveBeenCalledTimes(1)
      expect(context.providerCalls.generate).toHaveBeenCalledTimes(1)
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it('persists scientific rejection as a new immutable report and version verdict', async () => {
    const context = await setup()
    context.execute.mockImplementation((input) =>
      Promise.resolve(successfulResponse(input as Parameters<typeof successfulResponse>[0], 2)),
    )
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner: context.runner,
      verifier: context.verifier,
    })
    try {
      const accepted = await service.start(
        context.versionId,
        request(context.stale.revision, 'reverify:service:rejected'),
      )
      if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
      expect(await terminal(service, accepted.value.runId)).toMatchObject({
        state: 'rejected',
        attempts: [{ outcome: 'rejected' }],
      })
      expect(service.owns(accepted.value.runId)).toBe(true)
      expect(unwrap(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'rejected',
      })
      expect(context.providerCalls.compile).toHaveBeenCalledTimes(1)
      expect(context.providerCalls.generate).toHaveBeenCalledTimes(1)
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it('rejects non-stale and conflicting revision requests before runner execution', async () => {
    const context = await setup()
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner: context.runner,
      verifier: context.verifier,
    })
    try {
      await expect(
        service.start(context.versionId, request(context.stale.revision - 1)),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      expect(context.execute).toHaveBeenCalledTimes(1)
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it('settles runner failure and invalid bound artifacts with the stale content preserved', async () => {
    for (const mode of ['runner', 'missing-artifact', 'corrupt-artifact'] as const) {
      const context = await setup()
      if (mode !== 'runner') await invalidateCore(context, mode)
      const runner: TrustedRunnerAdapter =
        mode === 'runner'
          ? {
              execute: vi.fn().mockResolvedValue({
                ok: false,
                stableErrorId: 'runner.execution-failed',
                diagnostics: [],
              }),
            }
          : context.runner
      const service = new ReverificationService({
        database: context.database,
        store: context.store,
        runner,
        verifier: context.verifier,
      })
      try {
        const accepted = await service.start(
          context.versionId,
          request(context.stale.revision, `reverify:service:${mode}`),
        )
        if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
        const status = await terminal(service, accepted.value.runId)
        expect(status.state).toBe(mode === 'runner' ? 'runner_failed' : 'invariant_failed')
        expect(service.owns(accepted.value.runId)).toBe(true)
        expect(unwrap(context.database.getVersion(context.versionId))).toMatchObject({
          state: 'stale',
          activeConceptSpecId: context.stale.activeConceptSpecId,
          activeGeneratedArtifactId: context.stale.activeGeneratedArtifactId,
          activeVerificationRunId: context.oldVerificationRunId,
        })
      } finally {
        await service.close()
        context.database.close()
      }
    }
  })

  it('aborts active runner work on close and preserves the bound stale snapshot', async () => {
    const context = await setup()
    const runner = {
      execute: vi.fn(
        async (_concept: unknown, _artifacts: unknown, signal?: AbortSignal) =>
          await new Promise<never>((_resolve, reject) => {
            if (signal?.aborted === true) {
              reject(new DOMException('Cancelled', 'AbortError'))
              return
            }
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Cancelled', 'AbortError')),
              { once: true },
            )
          }),
      ),
    } as TrustedRunnerAdapter
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner,
      verifier: context.verifier,
    })
    try {
      const accepted = await service.start(
        context.versionId,
        request(context.stale.revision, 'reverify:service:close'),
      )
      if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
      await new Promise<void>((resolve) => setImmediate(resolve))
      await service.close()
      const status = await service.status(accepted.value.runId)
      expect(status).toMatchObject({ ok: true, value: { state: 'cancelled' } })
      expect(service.owns(accepted.value.runId)).toBe(true)
      expect(unwrap(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'stale',
        activeGeneratedArtifactId: context.stale.activeGeneratedArtifactId,
      })
    } finally {
      await service.close()
      context.database.close()
    }
  })

  it('settles cancellation and scientific finalization as one consistent winner', async () => {
    const context = await setup()
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner: context.runner,
      verifier: context.verifier,
    })
    const original = context.database.reverification.finalize.bind(context.database.reverification)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = vi.fn()
    vi.spyOn(context.database.reverification, 'finalize').mockImplementation(async (...input) => {
      entered()
      await gate
      return await original(...input)
    })
    try {
      const accepted = await service.start(
        context.versionId,
        request(context.stale.revision, 'reverify:service:race'),
      )
      if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
      for (let turn = 0; turn < 200 && entered.mock.calls.length === 0; turn += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
      }
      expect(entered).toHaveBeenCalledOnce()
      const current = await service.status(accepted.value.runId)
      if (!current.ok) throw new TypeError('Expected active reverification status.')
      await expect(
        service.cancel(accepted.value.runId, current.value.revision),
      ).resolves.toMatchObject({
        ok: true,
      })
      release?.()
      const status = await terminal(service, accepted.value.runId)
      expect(status.state).toBe('cancelled')
      expect(service.owns(accepted.value.runId)).toBe(true)
      expect(status.attempts).toEqual([expect.objectContaining({ outcome: 'cancelled' })])
      expect(unwrap(context.database.getVersion(context.versionId))).toMatchObject({
        state: 'stale',
        activeVerificationRunId: context.oldVerificationRunId,
      })
    } finally {
      release?.()
      await service.close()
      context.database.close()
    }
  })

  it('preserves published history without attributing it to refreshed evidence', async () => {
    const context = await setup(undefined, true)
    const service = new ReverificationService({
      database: context.database,
      store: context.store,
      runner: context.runner,
      verifier: context.verifier,
    })
    try {
      const accepted = await service.start(
        context.versionId,
        request(context.stale.revision, 'reverify:service:published'),
      )
      if (!accepted.ok) throw new TypeError('Expected reverification acceptance.')
      expect((await terminal(service, accepted.value.runId)).state).toBe('verified')
      const current = unwrap(context.database.getVersion(context.versionId))
      expect(current.activeVerificationRunId).not.toBe(context.oldVerificationRunId)
      const exported = unwrap(
        await context.database.maintenance.exportSimulation(
          context.stale.simulationId,
          context.store,
        ),
      )
      expect(exported.records.publications).toEqual([
        expect.objectContaining({ verificationRunId: context.oldVerificationRunId }),
      ])
      const display = await new EducatorReportProjection(
        context.database,
        context.store,
        context.resolveInstalledEvidence,
      ).display(context.versionId)
      expect(display).toMatchObject({
        ok: true,
        value: { publication: { published: false }, publishable: true },
      })
    } finally {
      await service.close()
      context.database.close()
    }
  })
})
