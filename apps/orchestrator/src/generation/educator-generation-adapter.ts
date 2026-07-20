import type {
  CancelGenerationRequest,
  ConceptReviewDecision,
  EducatorGenerationStartRequest,
  ReverifyVersionRequest,
} from '@simproof/contracts'

import type { EducatorGenerationPort } from '../educator/ports.js'
import type { DurableGenerationCoordinator } from './durable-generation-coordinator.js'
import type { ReverificationService } from './reverification-service.js'

export interface EducatorGenerationRuntime extends EducatorGenerationPort {
  readonly close: () => Promise<void>
}

export function createEducatorGenerationAdapter(
  coordinator: DurableGenerationCoordinator | undefined,
  reverification?: ReverificationService,
): EducatorGenerationRuntime {
  return Object.freeze({
    start: (input: EducatorGenerationStartRequest, _sessionId: string) =>
      coordinator?.start(input) ?? unavailable(),
    status: (runId: string, _sessionId: string) =>
      reverification?.owns(runId) === true
        ? reverification.status(runId)
        : (coordinator?.status(runId) ?? unavailable()),
    decide: (runId: string, input: ConceptReviewDecision, _sessionId: string) =>
      coordinator?.decide(runId, input) ?? unavailable(),
    cancel: (runId: string, input: CancelGenerationRequest, _sessionId: string) =>
      reverification?.owns(runId) === true
        ? reverification.cancel(runId, input.expectedRunRevision)
        : (coordinator?.cancel(runId, input.expectedRunRevision) ?? unavailable()),
    reverify: (versionId: string, input: ReverifyVersionRequest, _sessionId: string) =>
      reverification?.start(versionId, input) ?? unavailable(),
    close: async () => {
      await Promise.all([coordinator?.close(), reverification?.close()])
    },
  })
}

const unavailable = () =>
  Promise.resolve({
    ok: false as const,
    error: {
      code: 'operation-failed' as const,
      message: 'Generation service is unavailable.',
    },
  })
