import {
  bootstrapCapabilitySchema,
  educatorRuntimeConfigSchema,
  generationStatusSchema,
  libraryPageSchema,
  simulationDetailSchema,
  verificationReportDisplaySchema,
  versionComparisonSchema,
  versionHistorySchema,
} from '@simproof/contracts'

import { EducatorCommandDispatcher } from './educator-command-dispatcher.js'
import {
  comparisonQuerySchema,
  type EducatorDispatchContext,
  type EducatorReadRouteKey,
  educatorResponse,
  educatorUnavailable,
  invalidEducatorInput,
  isEducatorCommandRouteKey,
  isEducatorRouteKey,
  parseLibraryQuery,
  readEducatorResource,
  resourceId,
  seedId,
  seedListSchema,
} from './educator-dispatch-support.js'
import { failure } from './response.js'
import type { EducatorHttpCallbacks, HttpResponse } from './types.js'

export class EducatorDispatcher {
  constructor(readonly callbacks: EducatorHttpCallbacks | undefined) {}

  async dispatch(context: EducatorDispatchContext): Promise<HttpResponse | undefined> {
    if (!isEducatorRouteKey(context.route.key)) return undefined
    if (this.callbacks === undefined) return educatorUnavailable(context.origin)
    const key = context.route.key
    if (key === 'bootstrap-capability') {
      return educatorResponse(
        bootstrapCapabilitySchema,
        await this.callbacks.bootstrapCapability(),
        context.origin,
      )
    }
    const sessionId = context.sessionId
    if (sessionId === undefined) return failure(401, 'http.session-required', context.origin)
    if (isEducatorCommandRouteKey(key)) {
      return await new EducatorCommandDispatcher(this.callbacks).dispatch(key, context, sessionId)
    }
    return await this.#read(key, context, sessionId)
  }

  async #read(
    key: EducatorReadRouteKey,
    context: EducatorDispatchContext,
    sessionId: string,
  ): Promise<HttpResponse> {
    const { origin, parameters, query } = context
    const callbacks = this.callbacks
    if (callbacks === undefined) return educatorUnavailable(origin)
    switch (key) {
      case 'runtime-config':
        return educatorResponse(
          educatorRuntimeConfigSchema,
          await callbacks.runtimeConfig(sessionId),
          origin,
        )
      case 'seeds-list':
        return educatorResponse(seedListSchema, await callbacks.listSeeds(sessionId), origin)
      case 'seed-detail':
        return await readEducatorResource({
          schema: simulationDetailSchema,
          candidate: parameters.seedId,
          invoke: (id) => callbacks.getSeed(id, sessionId),
          origin,
          parseId: seedId,
        })
      case 'seed-report':
        return await readEducatorResource({
          schema: verificationReportDisplaySchema,
          candidate: parameters.seedId,
          invoke: (id) => callbacks.getSeedReport(id, sessionId),
          origin,
          parseId: seedId,
        })
      case 'simulations-list': {
        const parsed = parseLibraryQuery(query)
        return parsed === undefined
          ? invalidEducatorInput(origin)
          : educatorResponse(
              libraryPageSchema,
              await callbacks.listSimulations(parsed, sessionId),
              origin,
            )
      }
      case 'simulation-detail':
        return await readEducatorResource({
          schema: simulationDetailSchema,
          candidate: parameters.simulationId,
          invoke: (id) => callbacks.getSimulation(id, sessionId),
          origin,
        })
      case 'simulation-history':
        return await readEducatorResource({
          schema: versionHistorySchema,
          candidate: parameters.simulationId,
          invoke: (id) => callbacks.versionHistory(id, sessionId),
          origin,
        })
      case 'simulation-compare': {
        const simulationId = resourceId(parameters.simulationId)
        const compared = comparisonQuerySchema.safeParse(query)
        return simulationId === undefined || !compared.success
          ? invalidEducatorInput(origin)
          : educatorResponse(
              versionComparisonSchema,
              await callbacks.compareVersions(
                simulationId,
                compared.data.left,
                compared.data.right,
                sessionId,
              ),
              origin,
            )
      }
      case 'educator-generation-status':
        return await readEducatorResource({
          schema: generationStatusSchema,
          candidate: parameters.runId,
          invoke: (id) => callbacks.generationStatus(id, sessionId),
          origin,
        })
      case 'version-report':
        return await readEducatorResource({
          schema: verificationReportDisplaySchema,
          candidate: parameters.versionId,
          invoke: (id) => callbacks.getReport(id, sessionId),
          origin,
        })
    }
  }
}
