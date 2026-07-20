import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { backupPersistence, restorePersistence } from './backup.js'
import { sha256 } from './backup-manifest.js'
import { preparedReverification } from './reverification.test-support.js'
import { expectOk, id, NOW } from './test-helpers.js'

describe('reverification lineage validation', () => {
  it('rejects a borrowed same-version artifact that is not the exact bound candidate', async () => {
    const context = await preparedReverification('borrowed-same-version-artifact')
    try {
      const raw = new DatabaseSync(context.database.path)
      const source = raw
        .prepare(`SELECT artifact_bundle_json,core_artifact_id,renderer_artifact_id,
          manifest_artifact_id,export_license_json FROM generated_artifacts WHERE id=?`)
        .get(context.generatedArtifactId) as
        | {
            artifact_bundle_json: string
            core_artifact_id: string
            renderer_artifact_id: string
            manifest_artifact_id: string
            export_license_json: string
          }
        | undefined
      if (source === undefined) throw new TypeError('Expected source generated artifact.')
      const sourceRunId = id()
      const sourceAttemptId = id()
      const borrowedArtifactId = id()
      raw
        .prepare(`INSERT INTO generation_runs(
          id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at
        ) VALUES (?,?,'running',1,NULL,?,NULL)`)
        .run(sourceRunId, context.versionId, NOW)
      raw
        .prepare(`INSERT INTO generation_attempts(
          id,generation_run_id,attempt_number,outcome,generated_artifact_id,created_at
        ) VALUES (?,?,1,'pending',NULL,?)`)
        .run(sourceAttemptId, sourceRunId, NOW)
      raw
        .prepare(`INSERT INTO generated_artifacts(
          id,generation_attempt_id,artifact_bundle_json,core_artifact_id,renderer_artifact_id,
          manifest_artifact_id,export_license_json,created_at
        ) VALUES (?,?,?,?,?,?,?,?)`)
        .run(
          borrowedArtifactId,
          sourceAttemptId,
          source.artifact_bundle_json,
          source.core_artifact_id,
          source.renderer_artifact_id,
          source.manifest_artifact_id,
          source.export_license_json,
          NOW,
        )
      raw
        .prepare('UPDATE generation_attempts SET generated_artifact_id=? WHERE id=?')
        .run(borrowedArtifactId, context.attemptId)
      raw.close()

      await expect(context.database.validateStoredRecords(context.store)).resolves.toMatchObject({
        ok: false,
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects a reverification run with provider usage despite spoofed fixed metadata', async () => {
    const context = await preparedReverification('spoofed-reverification-usage')
    try {
      const raw = new DatabaseSync(context.database.path)
      raw
        .prepare('UPDATE generation_pipeline_runs SET used_input_tokens=1 WHERE id=?')
        .run(context.begun.run.id)
      raw.close()
      await expect(context.database.validateStoredRecords(context.store)).resolves.toMatchObject({
        ok: false,
      })
    } finally {
      await context.cleanup()
    }
  })

  it.each([
    ['provider', "provider='spoofed-reverify'"],
    ['model', "model_id='spoofed-model'"],
    ['template', "template_version='999'"],
    ['attempt metadata', 'attempt_number=2'],
  ] as const)('rejects restored reverification with spoofed %s identity', async (name, update) => {
    const context = await preparedReverification(`restore-spoofed-${name.replaceAll(' ', '-')}`)
    const parent = await mkdtemp(join(tmpdir(), 'simproof-reverify-restore-'))
    const backup = join(parent, 'backup')
    try {
      expectOk(
        await backupPersistence({
          database: context.database,
          artifacts: context.store,
          destination: backup,
          createdAt: NOW,
        }),
      )
      const raw = new DatabaseSync(join(backup, 'metadata.sqlite'))
      raw
        .prepare(`UPDATE generation_pipeline_attempts SET ${update} WHERE id=?`)
        .run(context.attemptId)
      raw.close()
      await rewriteDatabaseManifest(backup)
      await expect(
        restorePersistence({ backup, destination: join(parent, 'restored') }),
      ).resolves.toMatchObject({ ok: false })
    } finally {
      await context.cleanup()
      await rm(parent, { force: true, recursive: true })
    }
  })
})

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
