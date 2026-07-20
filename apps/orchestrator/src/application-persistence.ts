import {
  createPersistence,
  type InstalledEvidenceResolver,
  type PersistenceDatabase,
} from '@simproof/persistence'

import type { ServerConfig } from './config/environment.js'
import type { ObservabilityRuntime } from './operations/observability-runtime.js'

export function initializePersistence(
  config: ServerConfig,
  resolveInstalledEvidence: InstalledEvidenceResolver | undefined,
  observability: ObservabilityRuntime,
): PersistenceDatabase {
  const database = createPersistence(config.databasePath, resolveInstalledEvidence)
  const migrated = database.migrate()
  if (!migrated.ok) {
    observability.logger.emit({
      severity: 'error',
      component: 'persistence',
      event: 'persistence.migration.failed',
      errorId: 'migration.failed',
    })
    return initializationFailure(database, observability, 'Persistence initialization failed.')
  }
  const recovered = database.generation.recoverInterrupted({ at: new Date().toISOString() })
  if (!recovered.ok) {
    observability.logger.emit({
      severity: 'error',
      component: 'persistence',
      event: 'persistence.recovery.failed',
      errorId: 'orchestration.interrupted',
    })
    return initializationFailure(database, observability, 'Generation recovery failed.')
  }
  for (const transition of recovered.value.transitions) {
    observability.generation.withRun(transition.runId, transition.simulationVersionId, () =>
      observability.generation.transition(transition.runId, transition.from, transition.to),
    )
  }
  observability.logger.emit({
    severity: 'info',
    component: 'persistence',
    event: 'persistence.startup.checked',
  })
  return database
}

function initializationFailure(
  database: PersistenceDatabase,
  observability: ObservabilityRuntime,
  message: string,
): never {
  database.close()
  void observability.close()
  throw new TypeError(message)
}
