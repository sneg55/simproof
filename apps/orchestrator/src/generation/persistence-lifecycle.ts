import type { GenerationState } from '@simproof/contracts'
import type {
  ArtifactStore,
  GenerationPipelineRun,
  PersistenceDatabase,
} from '@simproof/persistence'

import {
  GenerationJournalError,
  unwrapJournalResult as unwrap,
} from './persistence-journal-mapping.js'
import type { AttemptCompletion } from './pipeline-types.js'

export async function settleSimulationVersion(options: {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly run: GenerationPipelineRun
  readonly state: GenerationState
  readonly at: string
  readonly details?: AttemptCompletion
}): Promise<void> {
  const version = unwrap(options.database.getVersion(options.run.simulationVersionId))
  if (options.state === 'verified' || options.state === 'rejected') {
    if (options.details?.verificationRunId === undefined) {
      throw new GenerationJournalError('verification-run-not-recorded')
    }
    const verifying = unwrap(
      options.database.transitionVersion({
        id: version.id,
        expectedRevision: version.revision,
        to: 'verifying',
        updatedAt: options.at,
      }),
    )
    unwrap(
      await options.database.verification.finalizeVersion(
        {
          versionId: verifying.id,
          expectedRevision: verifying.revision,
          verificationRunId: options.details.verificationRunId,
          updatedAt: options.at,
        },
        options.store,
      ),
    )
    return
  }
  if (version.state === 'generating') {
    unwrap(
      options.database.transitionVersion({
        id: version.id,
        expectedRevision: version.revision,
        to: 'draft',
        updatedAt: options.at,
      }),
    )
  }
}
