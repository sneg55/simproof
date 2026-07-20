import {
  archiveVersionRequestSchema,
  cancelGenerationRequestSchema,
  cancellationAcceptedSchema,
  conceptReviewDecisionSchema,
  createDraftRequestSchema,
  duplicateSimulationRequestSchema,
  educatorGenerationStartRequestSchema,
  generationAcceptedSchema,
  generationStatusSchema,
  normalizedPreviewSchema,
  previewRequestSchema,
  publishVersionRequestSchema,
  reverifyVersionRequestSchema,
  simulationDetailSchema,
  startBlankVersionRequestSchema,
} from '@simproof/contracts'

import {
  type EducatorCommandRouteKey,
  type EducatorDispatchContext,
  educatorBodyResponse,
  educatorResourceBodyResponse,
  seedId,
  simulationExportResponse,
} from './educator-dispatch-support.js'
import type { EducatorHttpCallbacks, HttpResponse } from './types.js'

export class EducatorCommandDispatcher {
  constructor(readonly callbacks: EducatorHttpCallbacks) {}

  async dispatch(
    key: EducatorCommandRouteKey,
    context: EducatorDispatchContext,
    sessionId: string,
  ): Promise<HttpResponse> {
    const { body, origin, parameters } = context
    switch (key) {
      case 'seed-preview':
        return await educatorResourceBodyResponse({
          candidate: parameters.seedId,
          inputSchema: previewRequestSchema,
          outputSchema: normalizedPreviewSchema,
          body,
          invoke: (id, input) => this.callbacks.previewSeed(id, input, sessionId),
          origin,
          parseId: seedId,
        })
      case 'simulation-create':
        return await educatorBodyResponse({
          inputSchema: createDraftRequestSchema,
          outputSchema: simulationDetailSchema,
          body,
          invoke: (input) => this.callbacks.createSimulation(input, sessionId),
          origin,
          status: 201,
        })
      case 'simulation-version-create':
        return await educatorResourceBodyResponse({
          candidate: parameters.simulationId,
          inputSchema: startBlankVersionRequestSchema,
          outputSchema: simulationDetailSchema,
          body,
          invoke: (id, input) => this.callbacks.startBlankVersion(id, input, sessionId),
          origin,
          status: 201,
        })
      case 'simulation-duplicate':
        return await educatorResourceBodyResponse({
          candidate: parameters.simulationId,
          inputSchema: duplicateSimulationRequestSchema,
          outputSchema: simulationDetailSchema,
          body,
          invoke: (id, input) => this.callbacks.duplicateSimulation(id, input, sessionId),
          origin,
          status: 201,
        })
      case 'educator-generation-start':
        return await educatorBodyResponse({
          inputSchema: educatorGenerationStartRequestSchema,
          outputSchema: generationAcceptedSchema,
          body,
          invoke: (input) => this.callbacks.startGeneration(input, sessionId),
          origin,
          status: 202,
        })
      case 'educator-generation-concept':
        return await educatorResourceBodyResponse({
          candidate: parameters.runId,
          inputSchema: conceptReviewDecisionSchema,
          outputSchema: generationStatusSchema,
          body,
          invoke: (id, input) => this.callbacks.decideConcept(id, input, sessionId),
          origin,
        })
      case 'educator-generation-cancel':
        return await educatorResourceBodyResponse({
          candidate: parameters.runId,
          inputSchema: cancelGenerationRequestSchema,
          outputSchema: cancellationAcceptedSchema,
          body,
          invoke: (id, input) => this.callbacks.cancelGeneration(id, input, sessionId),
          origin,
          status: 202,
        })
      case 'version-publish':
        return await educatorResourceBodyResponse({
          candidate: parameters.versionId,
          inputSchema: publishVersionRequestSchema,
          outputSchema: simulationDetailSchema,
          body,
          invoke: (id, input) => this.callbacks.publishVersion(id, input, sessionId),
          origin,
        })
      case 'version-archive':
        return await educatorResourceBodyResponse({
          candidate: parameters.versionId,
          inputSchema: archiveVersionRequestSchema,
          outputSchema: simulationDetailSchema,
          body,
          invoke: (id, input) => this.callbacks.archiveVersion(id, input, sessionId),
          origin,
        })
      case 'version-reverify':
        return await educatorResourceBodyResponse({
          candidate: parameters.versionId,
          inputSchema: reverifyVersionRequestSchema,
          outputSchema: generationAcceptedSchema,
          body,
          invoke: (id, input) => this.callbacks.reverifyVersion(id, input, sessionId),
          origin,
          status: 202,
        })
      case 'simulation-export':
        return await simulationExportResponse({
          callback: (input, authenticatedSessionId) =>
            this.callbacks.exportSimulation(input, authenticatedSessionId),
          candidate: parameters.simulationId,
          body,
          sessionId,
          origin,
        })
      case 'version-preview':
        return await educatorResourceBodyResponse({
          candidate: parameters.versionId,
          inputSchema: previewRequestSchema,
          outputSchema: normalizedPreviewSchema,
          body,
          invoke: (id, input) => this.callbacks.previewVersion(id, input, sessionId),
          origin,
        })
    }
  }
}
