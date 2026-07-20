import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { createPersistence, inspectPersistence } from './database.js'
import { MigrationRunner } from './migration-runner.js'
import { MIGRATIONS } from './migrations.js'
import { fixture, id, NOW } from './test-helpers.js'

describe('persistence migrations and boundaries', () => {
  it('inspects migration state read-only with bounded safe output', async () => {
    const context = await fixture('migration-inspection')
    try {
      expect(inspectPersistence(context.database.path)).toEqual({
        ok: true,
        value: {
          status: 'current',
          expectedVersions: [1, 2, 3, 4, 5],
          appliedVersions: [1, 2, 3, 4, 5],
          checksumsValid: true,
        },
      })
      const tamper = new DatabaseSync(context.database.path)
      tamper.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('0'.repeat(64))
      tamper.close()
      expect(inspectPersistence(context.database.path)).toEqual({
        ok: true,
        value: {
          status: 'migration-invalid',
          expectedVersions: [1, 2, 3, 4, 5],
          appliedVersions: [1, 2, 3, 4, 5],
          checksumsValid: false,
        },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('does not create a missing database or expose its path in inspection errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-readonly-inspection-'))
    const path = join(root, 'missing.sqlite')
    try {
      const inspected = inspectPersistence(path)
      expect(inspected).toEqual({
        ok: false,
        error: { code: 'database-error', message: 'Persistence database is unavailable.' },
      })
      expect(JSON.stringify(inspected)).not.toContain(path)
      await expect(import('node:fs/promises').then(({ stat }) => stat(path))).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('reports an unavailable database after its connection is closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'simproof-readiness-unavailable-'))
    const database = createPersistence(join(root, 'metadata.sqlite'))
    try {
      expect(database.migrate()).toMatchObject({ ok: true })
      database.close()
      expect(database.readiness()).toEqual({ ok: false, reason: 'unavailable' })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('keeps public readiness bounded without invoking deep integrity inspection', async () => {
    const context = await fixture('readiness-bounded')
    const inspect = vi.spyOn(MigrationRunner.prototype, 'inspect').mockImplementation(() => {
      throw new TypeError('Public readiness must not run deep integrity inspection.')
    })
    const integrity = vi.spyOn(MigrationRunner.prototype, 'integrity').mockImplementation(() => {
      throw new TypeError('Public readiness must not run deep integrity validation.')
    })
    try {
      expect(context.database.readiness()).toEqual({ ok: true })
      expect(inspect).not.toHaveBeenCalled()
      expect(integrity).not.toHaveBeenCalled()
    } finally {
      inspect.mockRestore()
      integrity.mockRestore()
      await context.cleanup()
    }
  })

  it('applies checksummed migrations once and rejects journal tampering', async () => {
    const context = await fixture('migrations')
    try {
      expect(context.database.migrate()).toEqual({ ok: true, value: { applied: [] } })
      expect(context.database.appliedMigrations()).toEqual({ ok: true, value: [1, 2, 3, 4, 5] })
      expect(context.database.foreignKeysEnabled()).toBe(true)
      expect(context.database.readiness()).toEqual({ ok: true })
      const tamper = new DatabaseSync(context.database.path)
      tamper.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('0'.repeat(64))
      tamper.close()
      expect(context.database.migrate()).toMatchObject({
        ok: false,
        error: { code: 'database-error' },
      })
      expect(context.database.readiness()).toEqual({ ok: false, reason: 'migration' })
    } finally {
      await context.cleanup()
    }
  })

  it('validates strict record inputs and rolls back conflicting writes', async () => {
    const context = await fixture('boundaries')
    try {
      expect(
        context.database.createSimulation({
          id: 'not-a-uuid',
          title: 'Bad',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' },
      })
      const simulation = { id: id(), title: 'Valid', createdAt: NOW, updatedAt: NOW }
      expect(context.database.createSimulation({ ...simulation, unknown: true })).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' },
      })
      expect(context.database.createSimulation(simulation)).toMatchObject({ ok: true })
      expect(context.database.createSimulation(simulation)).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('uses optimistic revisions to reject stale two-connection transitions', async () => {
    const context = await fixture('revision')
    const contender = createPersistence(context.database.path)
    try {
      expect(contender.migrate()).toMatchObject({ ok: true })
      const simulationId = id()
      const versionId = id()
      expect(
        context.database.createSimulation({
          id: simulationId,
          title: 'Revision',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ).toMatchObject({ ok: true })
      expect(
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
      ).toMatchObject({ ok: true })
      expect(
        context.database.beginGeneration({
          versionId,
          expectedRevision: 0,
          updatedAt: NOW,
          run: {
            id: id(),
            simulationVersionId: versionId,
            status: 'running',
            maxAttempts: 3,
            codexSessionId: null,
            createdAt: NOW,
            completedAt: null,
          },
        }),
      ).toMatchObject({ ok: true })
      expect(
        contender.transitionVersion({
          id: versionId,
          expectedRevision: 0,
          to: 'archived',
          updatedAt: NOW,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
    } finally {
      contender.close()
      await context.cleanup()
    }
  })

  it('rejects same-connection writes while async maintenance is suspended', async () => {
    const context = await fixture('maintenance-guard')
    let release: () => void = () => {
      // Replaced by the gate resolver before use.
    }
    let entered: () => void = () => {
      // Replaced by the start resolver before use.
    }
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    try {
      const maintenance = context.database.withBackupLock(async () => {
        entered()
        await gate
        return { ok: true as const, value: true as const }
      })
      await started
      expect(
        context.database.createSimulation({
          id: id(),
          title: 'Blocked',
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      release()
      await expect(maintenance).resolves.toEqual({ ok: true, value: true })
    } finally {
      release()
      await context.cleanup()
    }
  })

  it('fails migration closed when foreign-key integrity is already corrupt', async () => {
    const context = await fixture('migration-integrity')
    try {
      const corrupt = new DatabaseSync(context.database.path, {
        enableForeignKeyConstraints: false,
      })
      corrupt
        .prepare(`INSERT INTO simulation_versions(
        id,simulation_id,version_number,state,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)`)
        .run(id(), id(), 1, 'draft', 0, NOW, NOW)
      corrupt.close()
      expect(context.database.migrate()).toMatchObject({
        ok: false,
        error: { code: 'database-error' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rolls back every migration and journal row when a later migration fails', () => {
    const database = new DatabaseSync(':memory:')
    const migrations = [
      {
        version: 1,
        name: 'create_probe',
        sql: 'CREATE TABLE probe(id INTEGER PRIMARY KEY) STRICT;',
      },
      { version: 2, name: 'fail_probe', sql: 'THIS IS NOT VALID SQL;' },
    ]
    try {
      const runner = new MigrationRunner(database, () => true, migrations)
      expect(runner.migrate()).toMatchObject({ ok: false, error: { code: 'database-error' } })
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name='probe'").get(),
      ).toBeUndefined()
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get(),
      ).toBeUndefined()
    } finally {
      database.close()
    }
  })

  it('upgrades a prior schema fixture by applying only the next numbered migration', () => {
    const database = new DatabaseSync(':memory:')
    const first = {
      version: 1,
      name: 'create_probe',
      sql: 'CREATE TABLE probe(id INTEGER PRIMARY KEY) STRICT;',
    }
    const second = {
      version: 2,
      name: 'add_label',
      sql: 'ALTER TABLE probe ADD COLUMN label TEXT;',
    }
    try {
      expect(new MigrationRunner(database, () => true, [first]).migrate()).toMatchObject({
        ok: true,
        value: { applied: [1] },
      })
      expect(new MigrationRunner(database, () => true, [first, second]).migrate()).toMatchObject({
        ok: true,
        value: { applied: [2] },
      })
      const columns = database.prepare('PRAGMA table_info(probe)').all() as Array<{ name: string }>
      expect(columns.map(({ name }) => name)).toEqual(['id', 'label'])
    } finally {
      database.close()
    }
  })

  it('upgrades the immutable version-one schema through current orchestration storage', () => {
    const database = new DatabaseSync(':memory:')
    const simulationId = id()
    try {
      expect(new MigrationRunner(database, () => true, [MIGRATIONS[0]!]).migrate()).toEqual({
        ok: true,
        value: { applied: [1] },
      })
      database
        .prepare('INSERT INTO simulations(id,title,created_at,updated_at) VALUES (?,?,?,?)')
        .run(simulationId, 'Preserved upgrade record', NOW, NOW)

      expect(new MigrationRunner(database, () => true, MIGRATIONS).migrate()).toEqual({
        ok: true,
        value: { applied: [2, 3, 4, 5] },
      })
      expect(
        database.prepare('SELECT title FROM simulations WHERE id=?').get(simulationId),
      ).toEqual({
        title: 'Preserved upgrade record',
      })
      expect(database.prepare('SELECT * FROM privacy_settings').get()).toMatchObject({
        singleton: 1,
        prompt_retention_enabled: 0,
        external_diagnostics_enabled: 0,
      })
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 })
    } finally {
      database.close()
    }
  })

  it('upgrades the authentication-and-privacy release fixture with migration three only', () => {
    const database = new DatabaseSync(':memory:')
    try {
      expect(new MigrationRunner(database, () => true, MIGRATIONS.slice(0, 2)).migrate()).toEqual({
        ok: true,
        value: { applied: [1, 2] },
      })
      expect(new MigrationRunner(database, () => true, MIGRATIONS).migrate()).toEqual({
        ok: true,
        value: { applied: [3, 4, 5] },
      })
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='generation_pipeline_runs'",
          )
          .get(),
      ).toEqual({ name: 'generation_pipeline_runs' })
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='generation_provider_reservations'",
          )
          .get(),
      ).toEqual({ name: 'generation_provider_reservations' })
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 })
    } finally {
      database.close()
    }
  })

  it('upgrades the orchestration release fixture with migration four only', () => {
    const database = new DatabaseSync(':memory:')
    try {
      expect(new MigrationRunner(database, () => true, MIGRATIONS.slice(0, 3)).migrate()).toEqual({
        ok: true,
        value: { applied: [1, 2, 3] },
      })
      expect(new MigrationRunner(database, () => true, MIGRATIONS).migrate()).toEqual({
        ok: true,
        value: { applied: [4, 5] },
      })
      for (const name of ['bundled_examples', 'generation_concept_reviews']) {
        expect(
          database
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(name),
        ).toEqual({ name })
      }
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 })
    } finally {
      database.close()
    }
  })
})
