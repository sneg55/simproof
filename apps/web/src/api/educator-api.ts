import {
  adminBootstrapRequestSchema,
  bootstrapCapabilitySchema,
  type CancelGenerationRequest,
  type CancellationAccepted,
  type ConceptReviewDecision,
  cancelGenerationRequestSchema,
  cancellationAcceptedSchema,
  conceptReviewDecisionSchema,
  type EducatorGenerationStartRequest,
  type EducatorRuntimeConfig,
  type EducatorSession,
  educatorGenerationStartRequestSchema,
  educatorRuntimeConfigSchema,
  educatorSessionSchema,
  type GenerationAccepted,
  type GenerationStatus,
  generationAcceptedSchema,
  generationStatusSchema,
  type LibraryPage,
  type LibraryQuery,
  libraryPageSchema,
  loginRequestSchema,
  type SeedMetadata,
  type SimulationDetail,
  seedMetadataSchema,
  simulationDetailSchema,
} from '@simproof/contracts'
import { z } from 'zod'

import type { ApiResult, HttpClient } from '@/api/http-client'
import { createHttpClient } from '@/api/http-client'

const bootstrapResultSchema = z.object({ credentialVersion: z.number().int().positive() }).strict()
const seedListSchema = z.array(seedMetadataSchema).max(100)

export interface EducatorApi {
  bootstrapCapability(signal?: AbortSignal): Promise<ApiResult<{ bootstrapAvailable: boolean }>>
  session(signal?: AbortSignal): Promise<ApiResult<EducatorSession>>
  login(password: string): Promise<ApiResult<EducatorSession>>
  logout(csrfToken: string): Promise<ApiResult<true>>
  bootstrap(
    bootstrapSecret: string,
    newPassword: string,
  ): Promise<ApiResult<{ credentialVersion: number }>>
  runtimeConfig(signal?: AbortSignal): Promise<ApiResult<EducatorRuntimeConfig>>
  listSeeds(signal?: AbortSignal): Promise<ApiResult<SeedMetadata[]>>
  listSimulations(query: LibraryQuery, signal?: AbortSignal): Promise<ApiResult<LibraryPage>>
  simulationDetail(id: string, signal?: AbortSignal): Promise<ApiResult<SimulationDetail>>
  seedDetail(seedId: string, signal?: AbortSignal): Promise<ApiResult<SimulationDetail>>
}

export interface EducatorGenerationApi {
  startGeneration(
    request: EducatorGenerationStartRequest,
    csrfToken: string,
  ): Promise<ApiResult<GenerationAccepted>>
  generationStatus(runId: string, signal?: AbortSignal): Promise<ApiResult<GenerationStatus>>
  decideConcept(
    runId: string,
    decision: ConceptReviewDecision,
    csrfToken: string,
  ): Promise<ApiResult<GenerationStatus>>
  cancelGeneration(
    runId: string,
    request: CancelGenerationRequest,
    csrfToken: string,
  ): Promise<ApiResult<CancellationAccepted>>
}

export function createEducatorApi(client: HttpClient = createHttpClient()): EducatorApi {
  return {
    bootstrapCapability: async (signal) =>
      await client.request('/api/bootstrap-capability', bootstrapCapabilitySchema, { signal }),
    session: async (signal) =>
      await client.request('/api/session', educatorSessionSchema, { signal }),
    login: async (password) => {
      const input = loginRequestSchema.safeParse({ password })
      return input.success
        ? await client.request('/api/auth/login', educatorSessionSchema, {
            method: 'POST',
            body: input.data,
            sessionlessUnsafe: true,
          })
        : invalidInput()
    },
    logout: async (csrfToken) =>
      await client.request('/api/auth/logout', z.literal(true), {
        method: 'POST',
        csrfToken,
      }),
    bootstrap: async (bootstrapSecret, newPassword) => {
      const input = adminBootstrapRequestSchema.safeParse({ bootstrapSecret, newPassword })
      return input.success
        ? await client.request('/api/auth/bootstrap', bootstrapResultSchema, {
            method: 'POST',
            body: input.data,
            sessionlessUnsafe: true,
          })
        : invalidInput()
    },
    runtimeConfig: async (signal) =>
      await client.request('/api/runtime-config', educatorRuntimeConfigSchema, { signal }),
    listSeeds: async (signal) => await client.request('/api/seeds', seedListSchema, { signal }),
    listSimulations: async (query, signal) =>
      await client.request(`/api/simulations${libraryQueryString(query)}`, libraryPageSchema, {
        signal,
      }),
    simulationDetail: async (id, signal) =>
      await client.request(`/api/simulations/${encodeURIComponent(id)}`, simulationDetailSchema, {
        signal,
      }),
    seedDetail: async (seedId, signal) =>
      await client.request(`/api/seeds/${encodeURIComponent(seedId)}`, simulationDetailSchema, {
        signal,
      }),
  }
}

export function createEducatorGenerationApi(
  client: HttpClient = createHttpClient(),
): EducatorGenerationApi {
  return {
    startGeneration: async (request, csrfToken) => {
      const parsed = educatorGenerationStartRequestSchema.safeParse(request)
      return parsed.success
        ? await client.request('/api/generations', generationAcceptedSchema, {
            method: 'POST',
            body: parsed.data,
            csrfToken,
          })
        : invalidInput()
    },
    generationStatus: async (runId, signal) =>
      validRecordId(runId)
        ? await client.request(`/api/generations/${runId}`, generationStatusSchema, { signal })
        : invalidInput(),
    decideConcept: async (runId, decision, csrfToken) => {
      const parsed = conceptReviewDecisionSchema.safeParse(decision)
      return validRecordId(runId) && parsed.success
        ? await client.request(`/api/generations/${runId}/concept-review`, generationStatusSchema, {
            method: 'POST',
            body: parsed.data,
            csrfToken,
          })
        : invalidInput()
    },
    cancelGeneration: async (runId, request, csrfToken) => {
      const parsed = cancelGenerationRequestSchema.safeParse(request)
      return validRecordId(runId) && parsed.success
        ? await client.request(
            `/api/generations/${runId}/cancellation`,
            cancellationAcceptedSchema,
            { method: 'POST', body: parsed.data, csrfToken },
          )
        : invalidInput()
    },
  }
}

function libraryQueryString(query: LibraryQuery): string {
  const entries: [string, string][] = []
  if (query.cursor !== undefined) entries.push(['cursor', query.cursor])
  if (query.domains.length > 0) entries.push(['domain', query.domains.join(',')])
  entries.push(['limit', String(query.limit)])
  if (query.search !== '') entries.push(['search', query.search])
  if (query.sources.length > 0) entries.push(['source', query.sources.join(',')])
  if (query.states.length > 0) entries.push(['state', query.states.join(',')])
  const encoded = entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
  return encoded === '' ? '' : `?${encoded}`
}

function invalidInput(): ApiResult<never> {
  return { ok: false, error: { kind: 'invalid-request', id: 'web.invalid-request' } }
}

function validRecordId(candidate: string): boolean {
  return z.uuid().safeParse(candidate).success
}

export const browserEducatorApi = createEducatorApi()
export const browserEducatorGenerationApi = createEducatorGenerationApi()
