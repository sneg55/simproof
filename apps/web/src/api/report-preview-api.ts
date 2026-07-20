import {
  type GenerationAccepted,
  generationAcceptedSchema,
  identifierSchema,
  type NormalizedPreview,
  normalizedPreviewSchema,
  type PreviewRequest,
  type PublishVersionRequest,
  previewRequestSchema,
  publishVersionRequestSchema,
  type ReverifyVersionRequest,
  reverifyVersionRequestSchema,
  type SimulationDetail,
  simulationDetailSchema,
  type VerificationReportDisplay,
  verificationReportDisplaySchema,
} from '@simproof/contracts'
import { z } from 'zod'

import type { ApiResult, HttpClient } from '@/api/http-client'
import { createHttpClient } from '@/api/http-client'

export interface ReportPreviewApi {
  versionReport(id: string, signal?: AbortSignal): Promise<ApiResult<VerificationReportDisplay>>
  seedReport(seedId: string, signal?: AbortSignal): Promise<ApiResult<VerificationReportDisplay>>
  versionPreview(
    id: string,
    request: PreviewRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<NormalizedPreview>>
  seedPreview(
    seedId: string,
    request: PreviewRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<NormalizedPreview>>
  publishVersion(
    id: string,
    request: PublishVersionRequest,
    csrfToken: string,
  ): Promise<ApiResult<SimulationDetail>>
  reverifyVersion(
    id: string,
    request: ReverifyVersionRequest,
    csrfToken: string,
  ): Promise<ApiResult<GenerationAccepted>>
}

export function createReportPreviewApi(client: HttpClient = createHttpClient()): ReportPreviewApi {
  return {
    versionReport: async (id, signal) =>
      validVersionId(id)
        ? await client.request(`/api/versions/${id}/report`, verificationReportDisplaySchema, {
            signal,
          })
        : invalidInput(),
    seedReport: async (seedId, signal) =>
      validSeedId(seedId)
        ? await client.request(
            `/api/seeds/${encodeURIComponent(seedId)}/report`,
            verificationReportDisplaySchema,
            { signal },
          )
        : invalidInput(),
    versionPreview: async (id, request, csrfToken, signal) =>
      await previewCommand({
        client,
        path: `/api/versions/${id}/preview`,
        validId: validVersionId(id),
        request,
        csrfToken,
        signal,
      }),
    seedPreview: async (seedId, request, csrfToken, signal) =>
      await previewCommand({
        client,
        path: `/api/seeds/${encodeURIComponent(seedId)}/preview`,
        validId: validSeedId(seedId),
        request,
        csrfToken,
        signal,
      }),
    publishVersion: async (id, request, csrfToken) => {
      const parsed = publishVersionRequestSchema.safeParse(request)
      return validVersionId(id) && parsed.success
        ? await client.request(`/api/versions/${id}/publish`, simulationDetailSchema, {
            method: 'POST',
            body: parsed.data,
            csrfToken,
          })
        : invalidInput()
    },
    reverifyVersion: async (id, request, csrfToken) => {
      const parsed = reverifyVersionRequestSchema.safeParse(request)
      return validVersionId(id) && parsed.success
        ? await client.request(`/api/versions/${id}/reverify`, generationAcceptedSchema, {
            method: 'POST',
            body: parsed.data,
            csrfToken,
          })
        : invalidInput()
    },
  }
}

async function previewCommand({
  client,
  path,
  validId,
  request,
  csrfToken,
  signal,
}: {
  readonly client: HttpClient
  readonly path: string
  readonly validId: boolean
  readonly request: PreviewRequest
  readonly csrfToken: string
  readonly signal: AbortSignal | undefined
}): Promise<ApiResult<NormalizedPreview>> {
  const parsed = previewRequestSchema.safeParse(request)
  return validId && parsed.success
    ? await client.request(path, normalizedPreviewSchema, {
        method: 'POST',
        body: parsed.data,
        csrfToken,
        signal,
      })
    : invalidInput()
}

function validVersionId(candidate: string): boolean {
  return z.uuid().safeParse(candidate).success
}

function validSeedId(candidate: string): boolean {
  return identifierSchema.safeParse(candidate).success
}

function invalidInput(): ApiResult<never> {
  return { ok: false, error: { kind: 'invalid-request', id: 'web.invalid-request' } }
}

export const browserReportPreviewApi = createReportPreviewApi()
