import type { GenerationPipelineRun } from './generation-types.js'
import type { SimulationVersion } from './types.js'

export type ConceptReviewStatus = 'pending' | 'confirmed' | 'cancelled'

export interface ConceptReview {
  readonly id: string
  readonly runId: string
  readonly simulationVersionId: string
  readonly conceptSpecId: string
  readonly conceptHash: string
  readonly status: ConceptReviewStatus
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly resolvedAt: string | null
}

export interface ConceptReviewSnapshot {
  readonly review: ConceptReview
  readonly run: GenerationPipelineRun
  readonly version: SimulationVersion
}
