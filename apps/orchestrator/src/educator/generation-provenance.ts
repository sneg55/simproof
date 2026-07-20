import {
  type EducatorVersionDetail,
  type PortableSimulationExport,
  publicProviderProvenanceSchema,
} from '@simproof/contracts'
import type {
  GenerationExternalCall,
  PersistenceDatabase,
  SimulationVersion,
} from '@simproof/persistence'

import type { HttpOperationResult } from '../http/types.js'
import { failed, fromPersistence, succeeded } from './results.js'

export function generationProvenanceFor(
  database: PersistenceDatabase,
  version: SimulationVersion,
  exported: PortableSimulationExport,
): HttpOperationResult<EducatorVersionDetail['generationProvenance']> {
  const concept = exported.records.conceptSpecs.find(({ id }) => id === version.activeConceptSpecId)
  const generated = exported.records.generatedArtifacts.find(
    ({ id }) => id === version.activeGeneratedArtifactId,
  )
  if (concept === undefined || generated === undefined) return succeeded(null)
  const pipelineRun = database.generation.get(concept.generationRunId)
  if (!pipelineRun.ok) {
    return pipelineRun.error.code === 'not-found' ? succeeded(null) : fromPersistence(pipelineRun)
  }
  const calls = database.generation.externalCalls(concept.generationRunId)
  if (!calls.ok) return fromPersistence(calls)
  const conceptCall = calls.value.find(
    ({ operation, stableErrorId }) => operation === 'concept_compile' && stableErrorId === null,
  )
  const codeCall = calls.value.findLast(
    ({ attemptId, operation, stableErrorId }) =>
      attemptId === generated.generationAttemptId &&
      (operation === 'code_generate' || operation === 'code_repair') &&
      stableErrorId === null,
  )
  if (conceptCall === undefined || codeCall === undefined) {
    return failed('operation-failed', 'Generation provenance is incomplete.')
  }
  const conceptCompiler = publicProvenance(conceptCall)
  const codeGenerator = publicProvenance(codeCall)
  return conceptCompiler === null || codeGenerator === null
    ? failed('operation-failed', 'Generation provenance is invalid.')
    : succeeded({ conceptCompiler, codeGenerator })
}

function publicProvenance(call: GenerationExternalCall) {
  const parsed = publicProviderProvenanceSchema.safeParse({
    provider: call.provider,
    model: call.modelId,
    templateVersion: call.templateVersion,
    usage: {
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      requestCount: call.usage.providerRequests,
      costMicrousd: call.usage.costMicrousd,
    },
  })
  return parsed.success ? parsed.data : null
}
