import { z } from 'zod'

const registeredOperationalEventIds = [
  'diagnostics.bundle-created',
  'generation.accepted',
  'generation.attempt.started',
  'generation.run.failed',
  'generation.transition',
  'generation.transition.persisted',
  'http.request.completed',
  'persistence.migration.failed',
  'persistence.recovery.failed',
  'persistence.startup.checked',
  'provider.call.completed',
  'runner.execution.completed',
  'telemetry.export.failed',
  'telemetry.shutdown.failed',
  'verification.completed',
] as const

export const operationalEventIdSchema = z.enum(registeredOperationalEventIds)
export type OperationalEventId = z.infer<typeof operationalEventIdSchema>

export const operationalEventIds: readonly OperationalEventId[] = Object.freeze([
  ...registeredOperationalEventIds,
])

export const operationalEventRegistry: Readonly<Record<OperationalEventId, true>> = Object.freeze(
  Object.fromEntries(operationalEventIds.map((eventId) => [eventId, true])) as Record<
    OperationalEventId,
    true
  >,
)
