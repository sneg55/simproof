import { writeFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

import { describe, expect, it } from 'vitest'
import { ArtifactStore } from './artifact-store.js'
import { PrivacyRepository } from './privacy-repository.js'
import { expectOk, id, NOW } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

class ConcurrentMutationStore extends ArtifactStore {
  readonly #mutate: () => Promise<void>
  #attempted = false

  constructor(root: string, mutate: () => Promise<void>) {
    super(root)
    this.#mutate = mutate
  }

  override async get(hash: string) {
    if (!this.#attempted) {
      this.#attempted = true
      await this.#mutate()
    }
    return await super.get(hash)
  }
}

class ReadCountingStore extends ArtifactStore {
  reads = 0

  override async get(hash: string) {
    this.reads += 1
    return await super.get(hash)
  }
}

describe('full teacher privacy export snapshot', () => {
  it('holds one metadata snapshot while verifying its referenced artifact bytes', async () => {
    const context = await verifiedFixture('privacy-export-snapshot')
    const privacy = new PrivacyRepository(context.database.path)
    const unexpectedId = id()
    let worker: Worker | undefined
    let mutationCompleted: Promise<void> | undefined
    try {
      expectOk(
        privacy.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
          updatedAt: NOW,
        }),
      )
      expectOk(
        privacy.storePrompt({
          id: id(),
          simulationId: context.simulationId,
          prompt: 'Export this retained prompt.',
          createdAt: NOW,
        }),
      )
      const store = new ConcurrentMutationStore(context.store.root, async () => {
        worker = new Worker(
          `const { parentPort, workerData } = require('node:worker_threads');
           const { DatabaseSync } = require('node:sqlite');
           const db = new DatabaseSync(workerData.path, {
             enableForeignKeyConstraints: true,
             timeout: 2000,
           });
           parentPort.postMessage('attempting');
           db.prepare('INSERT INTO simulations(id,title,created_at,updated_at) VALUES (?,?,?,?)')
             .run(workerData.id, workerData.title, workerData.now, workerData.now);
           db.close();
           parentPort.postMessage('completed');`,
          {
            eval: true,
            workerData: {
              path: context.database.path,
              id: unexpectedId,
              title: 'Must not enter the active snapshot',
              now: NOW,
            },
          },
        )
        let started!: () => void
        let completed!: () => void
        const mutationStarted = new Promise<void>((resolve) => {
          started = resolve
        })
        mutationCompleted = new Promise<void>((resolve, reject) => {
          completed = resolve
          worker?.once('error', reject)
        })
        worker.on('message', (message: unknown) => {
          if (message === 'attempting') started()
          if (message === 'completed') completed()
        })
        await mutationStarted
      })

      const snapshot = expectOk(
        await context.database.maintenance.exportTeacherPrivacySnapshot(store, 8_388_608),
      )

      expect(snapshot.simulations.map(({ simulation }) => simulation.id)).toEqual([
        context.simulationId,
      ])
      expect(snapshot.retainedPrompts).toMatchObject([
        { simulationId: context.simulationId, prompt: 'Export this retained prompt.' },
      ])
      expect(snapshot.privacySettings).toMatchObject({
        revision: 1,
        promptRetentionEnabled: true,
      })
      await mutationCompleted
      expect(context.database.getSimulation(unexpectedId)).toMatchObject({ ok: true })
    } finally {
      privacy.close()
      if (worker !== undefined) await worker.terminate()
      await context.cleanup()
    }
  })

  it('rejects a snapshot whose aggregate JSON exceeds the caller bound', async () => {
    const context = await verifiedFixture('privacy-export-limit')
    const store = new ReadCountingStore(context.store.root)
    try {
      await expect(
        context.database.maintenance.exportTeacherPrivacySnapshot(store, 256),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
      expect(store.reads).toBe(0)
    } finally {
      await context.cleanup()
    }
  })

  it('fails closed when referenced artifact bytes do not match snapshot metadata', async () => {
    const context = await verifiedFixture('privacy-export-corrupt-artifact')
    try {
      const [hash] = expectOk(context.database.referencedArtifactHashes())
      if (hash === undefined) throw new TypeError('Expected a referenced artifact fixture.')
      await writeFile(context.store.pathForHash(hash), 'tampered artifact bytes')

      await expect(
        context.database.maintenance.exportTeacherPrivacySnapshot(context.store, 8_388_608),
      ).resolves.toMatchObject({ ok: false, error: { code: 'corrupt-artifact' } })
    } finally {
      await context.cleanup()
    }
  })
})
