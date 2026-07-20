import type { PortableSimulationExport, SimulationVersion } from '@simproof/contracts'
import type { PersistenceDatabase } from '@simproof/persistence'
import { describe, expect, it } from 'vitest'

import { generationProvenanceFor } from './generation-provenance.js'

describe('public educator generation provenance', () => {
  it('projects bounded usage while excluding request, thread, session, and prompt data', () => {
    const conceptId = '10000000-0000-4000-8000-000000000001'
    const artifactId = '10000000-0000-4000-8000-000000000002'
    const runId = '10000000-0000-4000-8000-000000000003'
    const attemptId = '10000000-0000-4000-8000-000000000004'
    const calls = [
      call({ runId, attemptId: null, operation: 'concept_compile', provider: 'openai-responses' }),
      call({ runId, attemptId, operation: 'code_generate', provider: 'codex-sdk' }),
    ]
    const database = {
      generation: {
        get: () => ({ ok: true as const, value: {} }),
        externalCalls: () => ({ ok: true as const, value: calls }),
      },
    } as unknown as PersistenceDatabase
    const version = {
      activeConceptSpecId: conceptId,
      activeGeneratedArtifactId: artifactId,
    } as SimulationVersion
    const exported = {
      records: {
        conceptSpecs: [{ id: conceptId, generationRunId: runId }],
        generatedArtifacts: [{ id: artifactId, generationAttemptId: attemptId }],
      },
    } as PortableSimulationExport

    const result = generationProvenanceFor(database, version, exported)
    if (!result.ok) throw new Error('provenance was not projected')
    const projected = result.value
    expect(projected).toEqual({
      conceptCompiler: {
        provider: 'openai-responses',
        model: 'model-safe',
        templateVersion: '1.0.0',
        usage: { inputTokens: 10, outputTokens: 20, requestCount: 1, costMicrousd: 30 },
      },
      codeGenerator: {
        provider: 'codex-sdk',
        model: 'model-safe',
        templateVersion: '1.0.0',
        usage: { inputTokens: 10, outputTokens: 20, requestCount: 1, costMicrousd: 30 },
      },
    })
    expect(JSON.stringify(projected)).not.toMatch(/request-secret|thread-secret|prompt|session/u)
  })
})

function call(input: {
  runId: string
  attemptId: string | null
  operation: 'concept_compile' | 'code_generate'
  provider: 'openai-responses' | 'codex-sdk'
}) {
  return {
    id: crypto.randomUUID(),
    ...input,
    modelId: 'model-safe',
    templateVersion: '1.0.0',
    providerRequestId: 'request-secret',
    codexThreadId: input.provider === 'codex-sdk' ? 'thread-secret' : null,
    stableErrorId: null,
    usage: {
      providerRequests: 1,
      inputTokens: 10,
      outputTokens: 20,
      costMicrousd: 30,
      artifactBytes: 40,
    },
    recordedAt: '2026-07-16T12:00:00.000Z',
  }
}
