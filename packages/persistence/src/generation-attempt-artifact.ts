import type { DatabaseSync } from 'node:sqlite'

import type {
  CompleteGenerationAttemptInput,
  GenerationPipelineAttempt,
} from './generation-types.js'
import { isExactReverificationAttempt } from './reverification-identity.js'

export function retainedGeneratedArtifactId(
  database: DatabaseSync,
  current: GenerationPipelineAttempt,
  input: CompleteGenerationAttemptInput,
  operational: boolean,
): string | null {
  if (input.generatedArtifactId === null) return null
  const generated = database
    .prepare('SELECT id FROM generated_artifacts WHERE id=? AND generation_attempt_id=?')
    .get(input.generatedArtifactId, input.id) as { id: string } | undefined
  if (generated !== undefined) return generated.id
  const exactReverification =
    operational &&
    current.generatedArtifactId === input.generatedArtifactId &&
    isExactReverificationAttempt(database, {
      runId: current.runId,
      attemptId: input.id,
      generatedArtifactId: input.generatedArtifactId,
    })
  return exactReverification ? input.generatedArtifactId : null
}
