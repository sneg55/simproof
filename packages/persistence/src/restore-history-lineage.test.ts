import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { VerificationFinding, VerificationRun } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { expectOk, id, NOW, stored } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

type Context = Awaited<ReturnType<typeof verifiedFixture>>

describe('restore publication history and exact provenance', () => {
  it.each(['stale', 'archived'] as const)(
    'restores immutable publication history after the version becomes %s',
    async (state) => {
      const context = await verifiedFixture(`publication-history-${state}`)
      const parent = await mkdtemp(join(tmpdir(), `simproof-publication-history-${state}-`))
      try {
        await publish(context, 4)
        expectOk(
          context.database.transitionVersion({
            id: context.versionId,
            expectedRevision: 5,
            to: state,
            updatedAt: NOW,
          }),
        )
        expect(await roundTrip(context, parent)).toMatchObject({ ok: true })
      } finally {
        await context.cleanup()
        await rm(parent, { force: true, recursive: true })
      }
    },
  )

  it('restores every immutable publication after the same version is verified and published again', async () => {
    const context = await verifiedFixture('publication-history-republish')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-publication-history-republish-'))
    try {
      await publish(context, 4)
      expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 5,
          to: 'stale',
          updatedAt: NOW,
        }),
      )
      expectOk(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 6,
          to: 'verifying',
          updatedAt: NOW,
        }),
      )
      const nextRun = { ...context.verificationRun, id: id() }
      expectOk(await context.database.verification.insert(nextRun, [], context.store))
      expectOk(
        await context.database.verification.finalizeVersion(
          {
            versionId: context.versionId,
            expectedRevision: 7,
            verificationRunId: nextRun.id,
            updatedAt: NOW,
          },
          context.store,
        ),
      )
      await publish(context, 8)
      expect(await roundTrip(context, parent)).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a publication snapshot spliced to a rejected verification run', async () => {
    const context = await verifiedFixture('publication-rejected-run')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-publication-rejected-run-'))
    try {
      const rejected = await insertRejectedRun(context)
      await publish(context, 4)
      const result = await tamperedRoundTrip(context, parent, (database) => {
        database.exec('DROP TRIGGER immutable_publication')
        database
          .prepare(`UPDATE published_artifacts SET verification_run_id=?,
            verification_report_artifact_id=?,verification_report_hash=?`)
          .run(rejected.id, rejected.report.artifactId, rejected.report.contentHash)
        database
          .prepare('UPDATE simulation_versions SET active_verification_run_id=? WHERE id=?')
          .run(rejected.id, context.versionId)
      })
      expect(result).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a concept and generated artifact spliced across generation runs of one version', async () => {
    const context = await verifiedFixture('same-version-generation-splice')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-same-version-generation-splice-'))
    try {
      const result = await tamperedRoundTrip(context, parent, (database) => {
        const alternateRunId = id()
        database
          .prepare(`INSERT INTO generation_runs(
            id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
          ) SELECT ?,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
            FROM generation_runs WHERE id=?`)
          .run(alternateRunId, context.generationRunId)
        database.exec('DROP TRIGGER immutable_concept_spec')
        database
          .prepare('UPDATE concept_specs SET generation_run_id=? WHERE id=?')
          .run(alternateRunId, context.conceptSpecId)
      })
      expect(result).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a verification run whose concept snapshot differs from its immutable source', async () => {
    const context = await verifiedFixture('concept-snapshot-splice')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-concept-snapshot-splice-'))
    try {
      const alternate = await stored(
        context.database,
        context.store,
        'concept-spec',
        JSON.stringify({
          schemaVersion: '1',
          domain: 'pendulum',
          title: 'Alternate pendulum',
          parameters: {
            length: { unit: 'm', defaultValue: 1.5, requestedRange: { min: 0.5, max: 2 } },
            amplitude: { unit: 'deg', defaultValue: 5, requestedRange: { min: 0, max: 20 } },
          },
          requestedControls: ['length', 'amplitude'],
        }),
      )
      const result = await tamperedRoundTrip(context, parent, (database) => {
        database.exec('DROP TRIGGER immutable_concept_spec')
        database
          .prepare('UPDATE concept_specs SET artifact_id=?,artifact_hash=? WHERE id=?')
          .run(alternate.id, alternate.contentHash, context.conceptSpecId)
      })
      expect(result).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects a verification run whose bundle snapshot differs from its immutable source', async () => {
    const context = await verifiedFixture('bundle-snapshot-splice')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-bundle-snapshot-splice-'))
    try {
      const alternate = await stored(
        context.database,
        context.store,
        'renderer-data',
        '{"kind":"alternate-pendulum"}',
      )
      const bundle = {
        ...context.artifactBundle,
        renderer: {
          artifactId: alternate.id,
          role: 'renderer-data' as const,
          contentHash: alternate.contentHash,
        },
      }
      const result = await tamperedRoundTrip(context, parent, (database) => {
        database.exec('DROP TRIGGER immutable_generated_artifact')
        database
          .prepare(`UPDATE generated_artifacts SET artifact_bundle_json=?,renderer_artifact_id=?
            WHERE id=?`)
          .run(JSON.stringify(bundle), alternate.id, context.generatedArtifactId)
      })
      expect(result).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })

  it('rejects verified and rejected lifecycle states selecting the opposite verdict', async () => {
    const context = await verifiedFixture('lifecycle-verdict-selection')
    const parent = await mkdtemp(join(tmpdir(), 'simproof-lifecycle-verdict-selection-'))
    try {
      const rejected = await insertRejectedRun(context)
      expect(
        await tamperedRoundTrip(context, join(parent, 'verified'), (database) => {
          database
            .prepare('UPDATE simulation_versions SET active_verification_run_id=? WHERE id=?')
            .run(rejected.id, context.versionId)
        }),
      ).toMatchObject({ ok: false })
      expect(
        await tamperedRoundTrip(context, join(parent, 'rejected'), (database) => {
          database
            .prepare("UPDATE simulation_versions SET state='rejected' WHERE id=?")
            .run(context.versionId)
        }),
      ).toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })
})

async function publish(context: Context, expectedRevision: number): Promise<void> {
  expectOk(
    await context.database.verification.publish(
      {
        id: id(),
        simulationVersionId: context.versionId,
        exportLicense: { kind: 'none' },
        publishedAt: NOW,
      },
      expectedRevision,
      context.store,
    ),
  )
}

async function insertRejectedRun(context: Context): Promise<VerificationRun> {
  const reportBytes = expectOk(await context.store.get(context.evidence.report.contentHash))
  const finding: VerificationFinding = {
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
  const report = JSON.parse(reportBytes.toString('utf8')) as Record<string, unknown>
  const storedReport = await stored(
    context.database,
    context.store,
    'verification-report',
    JSON.stringify({
      ...report,
      reportId: id(),
      verdict: 'rejected',
      checks: [{ id: 'period.matches', outcome: 'failed', sampleCount: 1 }],
      findings: [finding],
    }),
  )
  const run: VerificationRun = {
    ...context.verificationRun,
    id: id(),
    verdict: 'rejected',
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

async function roundTrip(context: Context, parent: string) {
  return await tamperedRoundTrip(context, parent, () => undefined)
}

async function tamperedRoundTrip(
  context: Context,
  parent: string,
  tamper: (database: DatabaseSync) => void,
) {
  await mkdir(parent, { recursive: true })
  const backup = join(parent, 'backup')
  expectOk(
    await backupPersistence({
      database: context.database,
      artifacts: context.store,
      destination: backup,
      createdAt: NOW,
    }),
  )
  const database = new DatabaseSync(join(backup, 'metadata.sqlite'))
  try {
    tamper(database)
  } finally {
    database.close()
  }
  await rewriteDatabaseManifest(backup)
  return await restorePersistence({ backup, destination: join(parent, 'restored') })
}

async function rewriteDatabaseManifest(backup: string): Promise<void> {
  const database = await readFile(join(backup, 'metadata.sqlite'))
  const path = join(backup, 'manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    database: { sha256: string; byteLength: number }
  }
  manifest.database.sha256 = sha256(database)
  manifest.database.byteLength = database.byteLength
  await writeFile(path, JSON.stringify(manifest))
}
