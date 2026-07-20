import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { PrivacyRepository } from './privacy-repository.js'
import { fixture, id, NOW } from './test-helpers.js'

const LATER = '2026-07-16T17:00:00.000Z'

describe('privacy repository', () => {
  it('defaults both privacy-sensitive features off and requires explicit prompt opt-in', async () => {
    const context = await fixture('privacy-defaults')
    const repository = new PrivacyRepository(context.database.path)
    try {
      expect(repository.settings()).toEqual({
        ok: true,
        value: {
          promptRetentionEnabled: false,
          externalDiagnosticsEnabled: false,
          revision: 0,
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      })
      expect(
        repository.storePrompt({
          id: id(),
          simulationId: id(),
          prompt: 'should not be retained',
          createdAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    } finally {
      repository.close()
      await context.cleanup()
    }
  })

  it('stores, lists, exports, and deletes bounded prompts only after opt-in', async () => {
    const context = await fixture('privacy-retention')
    const repository = new PrivacyRepository(context.database.path)
    const simulationId = id()
    const promptId = id()
    try {
      expect(
        context.database.createSimulation({
          id: simulationId,
          title: 'Retained prompt owner',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ).toMatchObject({ ok: true })
      expect(
        repository.updateSettings({
          expectedRevision: 0,
          promptRetentionEnabled: true,
          externalDiagnosticsEnabled: false,
          updatedAt: NOW,
        }),
      ).toMatchObject({ ok: true, value: { revision: 1, promptRetentionEnabled: true } })
      expect(
        repository.storePrompt({
          id: promptId,
          simulationId,
          prompt: 'Build a pendulum simulation.',
          createdAt: LATER,
        }),
      ).toMatchObject({ ok: true })
      expect(
        repository.storePrompt({
          id: promptId,
          simulationId,
          prompt: 'Build a pendulum simulation.',
          createdAt: NOW,
        }),
      ).toEqual({
        ok: true,
        value: {
          id: promptId,
          simulationId,
          prompt: 'Build a pendulum simulation.',
          createdAt: LATER,
        },
      })
      expect(
        repository.storePrompt({
          id: promptId,
          simulationId,
          prompt: 'A changed prompt must not reuse the durable identity.',
          createdAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(repository.listPrompts(simulationId)).toMatchObject({
        ok: true,
        value: [{ id: promptId, simulationId, prompt: 'Build a pendulum simulation.' }],
      })
      expect(repository.exportPrompts()).toMatchObject({
        ok: true,
        value: [{ id: promptId, simulationId }],
      })
      expect(repository.deletePrompts(simulationId)).toEqual({ ok: true, value: 1 })
      expect(repository.listPrompts(simulationId)).toEqual({ ok: true, value: [] })
    } finally {
      repository.close()
      await context.cleanup()
    }
  })

  it('cascades retained prompts when their local simulation is deleted', async () => {
    const context = await fixture('privacy-cascade')
    const repository = new PrivacyRepository(context.database.path)
    const simulationId = id()
    try {
      context.database.createSimulation({
        id: simulationId,
        title: 'Deleted locally',
        createdAt: NOW,
        updatedAt: NOW,
      })
      repository.updateSettings({
        expectedRevision: 0,
        promptRetentionEnabled: true,
        externalDiagnosticsEnabled: false,
        updatedAt: NOW,
      })
      repository.storePrompt({
        id: id(),
        simulationId,
        prompt: 'Delete this with its simulation.',
        createdAt: LATER,
      })

      const direct = new DatabaseSync(context.database.path, { enableForeignKeyConstraints: true })
      direct.prepare('DELETE FROM simulations WHERE id=?').run(simulationId)
      direct.close()

      expect(repository.listPrompts(simulationId)).toEqual({ ok: true, value: [] })
    } finally {
      repository.close()
      await context.cleanup()
    }
  })

  it('uses an optimistic singleton revision for concurrent settings changes', async () => {
    const context = await fixture('privacy-race')
    const first = new PrivacyRepository(context.database.path)
    const second = new PrivacyRepository(context.database.path)
    try {
      const input = {
        expectedRevision: 0,
        promptRetentionEnabled: true,
        externalDiagnosticsEnabled: true,
        updatedAt: NOW,
      }
      expect(first.updateSettings(input)).toMatchObject({ ok: true })
      expect(second.updateSettings(input)).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
    } finally {
      first.close()
      second.close()
      await context.cleanup()
    }
  })
})
