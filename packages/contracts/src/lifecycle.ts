import { z } from 'zod'

export const simulationLifecycleStateSchema = z.enum([
  'draft',
  'generating',
  'verifying',
  'rejected',
  'verified',
  'stale',
  'published',
  'archived',
])

export const generationRunStatusSchema = z.enum([
  'running',
  'succeeded',
  'rejected',
  'operational-failure',
  'cancelled',
  'budget-exhausted',
])

export const generationAttemptOutcomeSchema = z.enum([
  'pending',
  'running',
  'verified',
  'rejected',
  'provider-failed',
  'runner-failed',
  'invalid-output',
  'cancelled',
])

export type SimulationLifecycleState = z.infer<typeof simulationLifecycleStateSchema>
export type GenerationRunStatus = z.infer<typeof generationRunStatusSchema>
export type GenerationAttemptOutcome = z.infer<typeof generationAttemptOutcomeSchema>
