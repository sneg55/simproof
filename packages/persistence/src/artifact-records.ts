import type { DatabaseSync } from 'node:sqlite'

import type { GeneratedArtifact, Sha256 } from '@simproof/contracts'

import { sqliteFailure } from './sqlite.js'
import { ok, type Result } from './types.js'

export interface ArtifactFormat {
  hash: Sha256
  roles: readonly string[]
  normalizationVersions: readonly number[]
}

export class ArtifactRecords {
  constructor(readonly database: DatabaseSync) {}

  referencedHashes(): Result<readonly Sha256[]> {
    try {
      const rows = this.database
        .prepare(`SELECT DISTINCT s.content_hash AS hash FROM stored_artifacts s WHERE
        EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=s.id) OR
        EXISTS(SELECT 1 FROM generated_artifacts g WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
        EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=s.id)
        ORDER BY hash`)
        .all() as unknown as Array<{ hash: Sha256 }>
      return ok(rows.map(({ hash }) => hash))
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  referencedFormats(): Result<readonly ArtifactFormat[]> {
    return this.#formats(`SELECT DISTINCT s.content_hash AS hash,s.role,s.normalization_version
      FROM stored_artifacts s WHERE
      EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=s.id) OR
      EXISTS(SELECT 1 FROM generated_artifacts g WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
      EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=s.id)
      ORDER BY hash,s.role,s.normalization_version`)
  }

  allFormats(): Result<readonly ArtifactFormat[]> {
    return this.#formats(`SELECT content_hash AS hash,role,normalization_version
      FROM stored_artifacts ORDER BY content_hash,role,normalization_version`)
  }

  bindingMatches(id: string, role: string, hash: Sha256): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM stored_artifacts WHERE id=? AND role=? AND content_hash=?')
        .get(id, role, hash) !== undefined
    )
  }

  bundleMatches(bundle: GeneratedArtifact['artifactBundle']): boolean {
    return [bundle.core, bundle.renderer, bundle.manifest].every(
      ({ artifactId, role, contentHash }) => this.bindingMatches(artifactId, role, contentHash),
    )
  }

  #formats(query: string): Result<readonly ArtifactFormat[]> {
    try {
      const rows = this.database.prepare(query).all() as unknown as Array<{
        hash: Sha256
        role: string
        normalization_version: number
      }>
      const grouped = new Map<Sha256, { roles: Set<string>; versions: Set<number> }>()
      for (const row of rows) {
        const value = grouped.get(row.hash) ?? { roles: new Set(), versions: new Set() }
        value.roles.add(row.role)
        value.versions.add(row.normalization_version)
        grouped.set(row.hash, value)
      }
      return ok(
        [...grouped].map(([hash, value]) => ({
          hash,
          roles: [...value.roles].sort(),
          normalizationVersions: [...value.versions].sort((left, right) => left - right),
        })),
      )
    } catch (error) {
      return sqliteFailure(error)
    }
  }
}
