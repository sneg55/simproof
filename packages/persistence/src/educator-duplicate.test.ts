import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { validateEducatorRecords } from './educator-record-validator.js'
import { expectOk, fixture, id, NOW } from './test-helpers.js'

const LATER = '2026-07-16T12:01:00.000Z'

describe('educator content duplication', () => {
  it('clones editable records with explicit lineage but no trust-bearing evidence', async () => {
    const context = await fixture('educator-content-duplicate')
    try {
      const source = draft('Source content')
      expectOk(context.database.educator.createDraft(source))
      const sourceContent = seedEditableCandidate(context.database.path, source.version.id)
      const destination = draft('Editable copy')
      const copied = expectOk(
        context.database.educator.duplicateToDraft({
          sourceVersionId: source.version.id,
          expectedSourceRevision: 0,
          simulation: destination.simulation,
          versionId: destination.version.id,
          copiedRecordIds: duplicateRecordIds(),
          createdAt: LATER,
        }),
      )
      expect(copied.version).toMatchObject({
        state: 'draft',
        revision: 0,
        activeVerificationRunId: null,
        activeArtifactBundle: sourceContent.bundle,
      })
      expect(copied.version.activeConceptSpecId).not.toBe(sourceContent.conceptSpecId)
      expect(copied.version.activeGeneratedArtifactId).not.toBe(sourceContent.generatedArtifactId)
      assertCopiedTrustBoundary({
        path: context.database.path,
        versionId: copied.version.id,
        conceptId: copied.version.activeConceptSpecId,
        candidateId: copied.version.activeGeneratedArtifactId,
        source: sourceContent,
      })
    } finally {
      await context.cleanup()
    }
  })

  it('rejects corrupted duplicate lineage during record validation', async () => {
    const context = await fixture('educator-duplicate-lineage-validation')
    try {
      const source = draft('Source content')
      expectOk(context.database.educator.createDraft(source))
      const destination = draft('Editable copy')
      expectOk(
        context.database.educator.duplicateToDraft({
          sourceVersionId: source.version.id,
          expectedSourceRevision: 0,
          simulation: destination.simulation,
          versionId: destination.version.id,
          copiedRecordIds: duplicateRecordIds(),
          createdAt: LATER,
        }),
      )
      const raw = new DatabaseSync(context.database.path, { enableForeignKeyConstraints: false })
      try {
        raw.exec(
          'PRAGMA ignore_check_constraints=ON; DROP TRIGGER immutable_version_lineage_update',
        )
        raw.prepare('UPDATE version_lineage SET source_revision=-1').run()
        expect(() => validateEducatorRecords(raw)).toThrow('Stored duplicate lineage is invalid.')
      } finally {
        raw.close()
      }
    } finally {
      await context.cleanup()
    }
  })
})

function draft(title: string) {
  const simulationId = id()
  return {
    simulation: { id: simulationId, title, createdAt: NOW, updatedAt: NOW },
    version: {
      id: id(),
      simulationId,
      versionNumber: 1,
      state: 'draft' as const,
      revision: 0,
      activeConceptSpecId: null,
      activeGeneratedArtifactId: null,
      activeArtifactBundle: null,
      activeVerificationRunId: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  }
}

function duplicateRecordIds() {
  return {
    generationRunId: id(),
    conceptSpecId: id(),
    generationAttemptId: id(),
    generatedArtifactId: id(),
  }
}

function assertCopiedTrustBoundary(input: {
  path: string
  versionId: string
  conceptId: string | null
  candidateId: string | null
  source: ReturnType<typeof seedEditableCandidate>
}) {
  const { path, versionId, conceptId, candidateId, source } = input
  const raw = new DatabaseSync(path)
  try {
    expect(
      raw.prepare('SELECT artifact_id,artifact_hash FROM concept_specs WHERE id=?').get(conceptId),
    ).toEqual(source.conceptArtifact)
    expect(
      raw
        .prepare(
          `SELECT core_artifact_id,renderer_artifact_id,manifest_artifact_id FROM generated_artifacts WHERE id=?`,
        )
        .get(candidateId),
    ).toEqual(source.candidateArtifacts)
    expect(
      raw
        .prepare(
          `SELECT r.status,a.outcome FROM generation_runs r JOIN generation_attempts a ON a.generation_run_id=r.id JOIN generated_artifacts g ON g.generation_attempt_id=a.id WHERE g.id=?`,
        )
        .get(candidateId),
    ).toEqual({ status: 'cancelled', outcome: 'cancelled' })
    expect(
      raw
        .prepare('SELECT COUNT(*) AS count FROM verification_runs WHERE simulation_version_id=?')
        .get(versionId),
    ).toEqual({ count: 0 })
    expect(
      raw
        .prepare('SELECT COUNT(*) AS count FROM published_artifacts WHERE simulation_version_id=?')
        .get(versionId),
    ).toEqual({ count: 0 })
    expect(
      raw
        .prepare(
          'SELECT kind,source_version_id FROM version_lineage WHERE destination_version_id=?',
        )
        .get(versionId),
    ).toMatchObject({ kind: 'duplicate' })
  } finally {
    raw.close()
  }
}

function seedEditableCandidate(path: string, versionId: string) {
  const raw = new DatabaseSync(path)
  const runId = id(),
    attemptId = id(),
    conceptSpecId = id(),
    generatedArtifactId = id()
  const conceptArtifact = { artifact_id: id(), artifact_hash: `sha256:${'a'.repeat(64)}` }
  const candidateArtifacts = {
    core_artifact_id: id(),
    renderer_artifact_id: id(),
    manifest_artifact_id: id(),
  }
  const bundle = {
    core: {
      artifactId: candidateArtifacts.core_artifact_id,
      role: 'core-source' as const,
      contentHash: `sha256:${'b'.repeat(64)}`,
    },
    renderer: {
      artifactId: candidateArtifacts.renderer_artifact_id,
      role: 'renderer-data' as const,
      contentHash: `sha256:${'c'.repeat(64)}`,
    },
    manifest: {
      artifactId: candidateArtifacts.manifest_artifact_id,
      role: 'manifest' as const,
      contentHash: `sha256:${'d'.repeat(64)}`,
    },
  }
  try {
    for (const artifact of [
      {
        id: conceptArtifact.artifact_id,
        role: 'concept-spec',
        hash: conceptArtifact.artifact_hash,
      },
      { id: bundle.core.artifactId, role: bundle.core.role, hash: bundle.core.contentHash },
      {
        id: bundle.renderer.artifactId,
        role: bundle.renderer.role,
        hash: bundle.renderer.contentHash,
      },
      {
        id: bundle.manifest.artifactId,
        role: bundle.manifest.role,
        hash: bundle.manifest.contentHash,
      },
    ])
      raw
        .prepare(
          `INSERT INTO stored_artifacts(id,role,content_hash,media_type,byte_length,normalization_version,created_at) VALUES (?,?,?,?,1,1,?)`,
        )
        .run(
          artifact.id,
          artifact.role,
          artifact.hash,
          artifact.role === 'core-source' ? 'text/javascript' : 'application/json',
          NOW,
        )
    raw
      .prepare(
        `INSERT INTO generation_runs(id,simulation_version_id,status,max_attempts,codex_session_id,created_at,completed_at) VALUES (?,?,'succeeded',1,NULL,?,?)`,
      )
      .run(runId, versionId, NOW, NOW)
    raw
      .prepare(
        `INSERT INTO generation_attempts(id,generation_run_id,attempt_number,outcome,generated_artifact_id,stable_error_id,created_at,completed_at) VALUES (?,?,1,'running',NULL,NULL,?,NULL)`,
      )
      .run(attemptId, runId, NOW)
    raw
      .prepare(
        `INSERT INTO concept_specs(id,simulation_version_id,generation_run_id,schema_version,domain,artifact_id,artifact_hash,created_at) VALUES (?,?,?,'1','projectile',?,?,?)`,
      )
      .run(
        conceptSpecId,
        versionId,
        runId,
        conceptArtifact.artifact_id,
        conceptArtifact.artifact_hash,
        NOW,
      )
    raw
      .prepare(
        `INSERT INTO generated_artifacts(id,generation_attempt_id,artifact_bundle_json,core_artifact_id,renderer_artifact_id,manifest_artifact_id,export_license_json,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        generatedArtifactId,
        attemptId,
        JSON.stringify(bundle),
        candidateArtifacts.core_artifact_id,
        candidateArtifacts.renderer_artifact_id,
        candidateArtifacts.manifest_artifact_id,
        JSON.stringify({ kind: 'spdx', id: 'MIT' }),
        NOW,
      )
    raw
      .prepare(
        `UPDATE generation_attempts SET outcome='verified',generated_artifact_id=?,completed_at=? WHERE id=?`,
      )
      .run(generatedArtifactId, NOW, attemptId)
    raw
      .prepare(
        `UPDATE simulation_versions SET active_concept_spec_id=?,active_generated_artifact_id=?,active_artifact_bundle_json=? WHERE id=?`,
      )
      .run(conceptSpecId, generatedArtifactId, JSON.stringify(bundle), versionId)
  } finally {
    raw.close()
  }
  return { bundle, conceptSpecId, generatedArtifactId, conceptArtifact, candidateArtifacts }
}
