import {
  type ArchiveVersionRequest,
  archiveVersionRequestSchema,
  type CreateDraftRequest,
  createDraftRequestSchema,
  type DuplicateSimulationRequest,
  duplicateSimulationRequestSchema,
  type GenerationAccepted,
  generationAcceptedSchema,
  type PortableSimulationExport,
  portableSimulationExportSchema,
  type ReverifyVersionRequest,
  reverifyVersionRequestSchema,
  type SimulationDetail,
  type StartBlankVersionRequest,
  sha256Schema,
  simulationDetailSchema,
  startBlankVersionRequestSchema,
  type VersionComparison,
  type VersionHistory,
  versionComparisonSchema,
  versionHistorySchema,
} from '@simproof/contracts'
import { z } from 'zod'

import type { ApiResult, HttpClient } from '@/api/http-client'
import { createHttpClient } from '@/api/http-client'

const recordIdSchema = z.uuid()
const deletionResponseSchema = z
  .object({
    deletedArtifacts: z.array(sha256Schema).max(100_000),
    deferredArtifacts: z.array(sha256Schema).max(100_000),
  })
  .strict()

export type SimulationDeletionResult = z.infer<typeof deletionResponseSchema>

export interface LibraryManagementApi {
  createDraft(request: CreateDraftRequest, csrfToken: string): Promise<ApiResult<SimulationDetail>>
  simulationDetail(id: string, signal?: AbortSignal): Promise<ApiResult<SimulationDetail>>
  versionHistory(id: string, signal?: AbortSignal): Promise<ApiResult<VersionHistory>>
  compareVersions(
    simulationId: string,
    leftVersionId: string,
    rightVersionId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<VersionComparison>>
  startBlankVersion(
    simulationId: string,
    request: StartBlankVersionRequest,
    csrfToken: string,
  ): Promise<ApiResult<SimulationDetail>>
  duplicateSimulation(
    simulationId: string,
    request: DuplicateSimulationRequest,
    csrfToken: string,
  ): Promise<ApiResult<SimulationDetail>>
  exportSimulation(
    simulationId: string,
    currentPassword: string,
    csrfToken: string,
  ): Promise<ApiResult<PortableSimulationExport>>
  archiveVersion(
    versionId: string,
    request: ArchiveVersionRequest,
    csrfToken: string,
  ): Promise<ApiResult<SimulationDetail>>
  deleteSimulation(
    simulationId: string,
    currentPassword: string,
    csrfToken: string,
  ): Promise<ApiResult<SimulationDeletionResult>>
  reverifyVersion(
    versionId: string,
    request: ReverifyVersionRequest,
    csrfToken: string,
  ): Promise<ApiResult<GenerationAccepted>>
}

export function createLibraryManagementApi(
  client: HttpClient = createHttpClient(),
): LibraryManagementApi {
  return {
    createDraft: async (request, csrfToken) =>
      await bodyCommand(client, {
        path: '/api/simulations',
        inputSchema: createDraftRequestSchema,
        request,
        outputSchema: simulationDetailSchema,
        csrfToken,
      }),
    simulationDetail: async (id, signal) =>
      validId(id)
        ? await client.request(`/api/simulations/${id}`, simulationDetailSchema, { signal })
        : invalidInput(),
    versionHistory: async (id, signal) =>
      validId(id)
        ? await client.request(`/api/simulations/${id}/versions`, versionHistorySchema, { signal })
        : invalidInput(),
    compareVersions: async (simulationId, leftVersionId, rightVersionId, signal) => {
      if (
        !validId(simulationId) ||
        !validId(leftVersionId) ||
        !validId(rightVersionId) ||
        leftVersionId === rightVersionId
      ) {
        return invalidInput()
      }
      return await client.request(
        `/api/simulations/${simulationId}/compare?left=${leftVersionId}&right=${rightVersionId}`,
        versionComparisonSchema,
        { signal },
      )
    },
    startBlankVersion: async (simulationId, request, csrfToken) =>
      validId(simulationId)
        ? await bodyCommand(client, {
            path: `/api/simulations/${simulationId}/versions`,
            inputSchema: startBlankVersionRequestSchema,
            request,
            outputSchema: simulationDetailSchema,
            csrfToken,
          })
        : invalidInput(),
    duplicateSimulation: async (simulationId, request, csrfToken) =>
      validId(simulationId)
        ? await bodyCommand(client, {
            path: `/api/simulations/${simulationId}/duplicate`,
            inputSchema: duplicateSimulationRequestSchema,
            request,
            outputSchema: simulationDetailSchema,
            csrfToken,
          })
        : invalidInput(),
    exportSimulation: async (simulationId, currentPassword, csrfToken) =>
      validId(simulationId) && validPassword(currentPassword)
        ? await client.request(
            `/api/simulations/${simulationId}/export`,
            portableSimulationExportSchema,
            {
              method: 'POST',
              body: { simulationId, currentPassword },
              csrfToken,
            },
          )
        : invalidInput(),
    archiveVersion: async (versionId, request, csrfToken) =>
      validId(versionId)
        ? await bodyCommand(client, {
            path: `/api/versions/${versionId}/archive`,
            inputSchema: archiveVersionRequestSchema,
            request,
            outputSchema: simulationDetailSchema,
            csrfToken,
          })
        : invalidInput(),
    deleteSimulation: async (simulationId, currentPassword, csrfToken) =>
      validId(simulationId) && validPassword(currentPassword)
        ? await client.request('/api/privacy/simulation', deletionResponseSchema, {
            method: 'DELETE',
            body: { simulationId, currentPassword, confirmation: 'delete' },
            csrfToken,
          })
        : invalidInput(),
    reverifyVersion: async (versionId, request, csrfToken) =>
      validId(versionId)
        ? await bodyCommand(client, {
            path: `/api/versions/${versionId}/reverify`,
            inputSchema: reverifyVersionRequestSchema,
            request,
            outputSchema: generationAcceptedSchema,
            csrfToken,
          })
        : invalidInput(),
  }
}

async function bodyCommand<Input, Output>(
  client: HttpClient,
  options: {
    readonly path: string
    readonly inputSchema: z.ZodType<Input>
    readonly request: Input
    readonly outputSchema: z.ZodType<Output>
    readonly csrfToken: string
  },
): Promise<ApiResult<Output>> {
  const parsed = options.inputSchema.safeParse(options.request)
  return parsed.success
    ? await client.request(options.path, options.outputSchema, {
        method: 'POST',
        body: parsed.data,
        csrfToken: options.csrfToken,
      })
    : invalidInput()
}

function validId(candidate: string): boolean {
  return recordIdSchema.safeParse(candidate).success
}

function validPassword(candidate: string): boolean {
  const bytes = new TextEncoder().encode(candidate).byteLength
  return !candidate.includes('\0') && bytes >= 1 && bytes <= 1_024
}

function invalidInput(): ApiResult<never> {
  return { ok: false, error: { kind: 'invalid-request', id: 'web.invalid-request' } }
}

export const browserLibraryManagementApi = createLibraryManagementApi()
