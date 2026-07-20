import { type ConceptSpec, conceptSpecSchema } from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'

import type { GenerationArtifactWriter } from './generation-artifact-writer.js'
import type { GeneratedArtifactSet } from './pipeline-types.js'

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (result.ok) return result.value
  throw new TypeError('Reverification persistence operation failed.')
}

async function stored(store: ArtifactStore, hash: string): Promise<string> {
  const object = await store.get(hash)
  if (!object.ok) throw new TypeError('Persisted reverification artifact is unavailable.')
  return object.value.toString('utf8')
}

export async function loadReverificationInput(options: {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly artifactWriter: GenerationArtifactWriter
  readonly runId: string
  readonly versionId: string
}): Promise<{
  readonly attemptId: string
  readonly generatedArtifactId: string
  readonly concept: ConceptSpec
  readonly artifacts: GeneratedArtifactSet
}> {
  const version = unwrap(options.database.getVersion(options.versionId))
  if (
    version.state !== 'verifying' ||
    version.activeConceptSpecId === null ||
    version.activeGeneratedArtifactId === null ||
    version.activeArtifactBundle === null
  ) {
    throw new TypeError('Reverification snapshot is unavailable.')
  }
  const record = unwrap(options.database.records.getConceptSpec(version.activeConceptSpecId))
  const attempts = unwrap(options.database.generation.attempts(options.runId))
  const attempt = attempts.at(0)
  if (attempt === undefined || attempt.provider !== 'simproof-reverify') {
    throw new TypeError('Reverification attempt is unavailable.')
  }
  const [conceptBytes, core, renderer, manifest] = await Promise.all([
    stored(options.store, record.artifact.contentHash),
    stored(options.store, version.activeArtifactBundle.core.contentHash),
    stored(options.store, version.activeArtifactBundle.renderer.contentHash),
    stored(options.store, version.activeArtifactBundle.manifest.contentHash),
  ])
  const parsed = conceptSpecSchema.safeParse(JSON.parse(conceptBytes))
  if (!parsed.success) throw new TypeError('Persisted concept specification is invalid.')
  options.artifactWriter.restoreConcept({
    runId: options.runId,
    conceptSpecId: record.id,
    artifactId: record.artifact.artifactId,
    hash: record.artifact.contentHash,
  })
  return {
    attemptId: attempt.id,
    generatedArtifactId: version.activeGeneratedArtifactId,
    concept: parsed.data,
    artifacts: {
      core: { path: 'core.mjs', content: core },
      renderer: { path: 'renderer.json', content: renderer },
      manifest: { path: 'manifest.json', content: manifest },
      testAdapter: { path: 'test-adapter.json', content: '{}' },
    },
  }
}
