import type { EducatorGenerationStartRequest } from '@simproof/contracts'

import type { ApiFailure } from '@/api/http-client'
import type { GenerationFormValue } from '@/generation/generation-form'

export interface GenerationTarget {
  readonly simulationTitle: string
  readonly simulationVersionId: string
  readonly expectedVersionRevision: number
}

const generationBudget: EducatorGenerationStartRequest['budget'] = {
  maxProviderRequests: 6,
  maxInputTokens: 120_000,
  maxOutputTokens: 30_000,
  maxCostMicrousd: 5_000_000,
  maxArtifactBytes: 2_000_000,
}

export function buildGenerationStartRequest(
  target: GenerationTarget,
  form: GenerationFormValue,
  idempotencyKey: string,
): EducatorGenerationStartRequest {
  return {
    schemaVersion: '1',
    simulationVersionId: target.simulationVersionId,
    expectedVersionRevision: target.expectedVersionRevision,
    idempotencyKey,
    teacher: {
      prompt: form.prompt,
      externalProviderDisclosureAccepted: true,
      promptRetention: form.promptRetention,
    },
    maxAttempts: 3,
    budget: generationBudget,
  }
}

export function generationStartFailureMessage(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'unavailable':
      return 'Generation services are unavailable. Ask a server administrator to check provider and runner configuration.'
    case 'conflict':
      return 'This simulation version changed before the request was accepted. Return to the simulation and review its current version.'
    case 'network':
      return 'SimProof could not reach the local service. Check the server connection and try again.'
    case 'rate-limit':
      return 'Too many generation requests were submitted. Try again after the current requests finish.'
    case 'authentication':
      return 'The educator session is no longer valid. Sign in again before starting generation.'
    case 'permission':
      return 'The server did not permit this generation request. Ask an administrator to review the generation configuration.'
    case 'invalid-request':
    case 'invalid-response':
      return 'The generation request could not be validated. Return to the simulation and review its current version.'
  }
}
