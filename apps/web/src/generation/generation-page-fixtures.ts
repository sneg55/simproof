import type { EducatorRuntimeConfig, GenerationStatus, SimulationDetail } from '@simproof/contracts'
import { vi } from 'vitest'

import type { EducatorApi } from '@/api/educator-api'

export const simulationId = '11111111-1111-4111-8111-111111111111'
export const versionId = '22222222-2222-4222-8222-222222222222'
export const runId = '33333333-3333-4333-8333-333333333333'
const CREATED_AT = '2026-07-16T12:00:00.000Z'

export const runtime: EducatorRuntimeConfig = {
  runtime: {
    deploymentMode: 'loopback',
    providerConfigured: true,
    maxRequestBytes: 65_536,
    maxPromptCharacters: 16_384,
    promptRetentionDefault: 'discard',
    telemetryEnabled: false,
    externalDiagnosticsEnabled: false,
  },
  generation: { available: true },
  seedLibraryReady: true,
  supportedDomains: ['pendulum', 'projectile'],
}

export const detail: SimulationDetail = {
  simulation: {
    id: simulationId,
    title: 'Active pendulum generation',
    source: { kind: 'teacher' },
    currentVersion: {
      id: versionId,
      versionNumber: 1,
      state: 'generating',
      revision: 2,
      domain: 'pendulum',
      verification: { status: 'none' },
      updatedAt: CREATED_AT,
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  selectedVersion: {
    summary: {
      id: versionId,
      versionNumber: 1,
      state: 'generating',
      revision: 2,
      domain: 'pendulum',
      verification: { status: 'none' },
      updatedAt: CREATED_AT,
    },
    conceptSpec: null,
    exportLicense: null,
    generationProvenance: null,
    lineage: null,
    availableActions: ['cancel-generation'],
    createdAt: CREATED_AT,
  },
}

export function educatorApi(overrides: Partial<EducatorApi> = {}): EducatorApi {
  return {
    bootstrapCapability: vi.fn(),
    session: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    bootstrap: vi.fn(),
    runtimeConfig: vi.fn(() => Promise.resolve({ ok: true as const, value: runtime })),
    listSeeds: vi.fn(),
    listSimulations: vi.fn(),
    simulationDetail: vi
      .fn<EducatorApi['simulationDetail']>()
      .mockResolvedValue({ ok: true, value: detail }),
    seedDetail: vi.fn(),
    ...overrides,
  }
}

export function verifyingStatus(): GenerationStatus {
  const timestamp = '2026-07-16T12:01:00.000Z'
  return {
    runId,
    simulationVersionId: versionId,
    state: 'verifying',
    revision: 6,
    maxAttempts: 3,
    budget: {
      limits: {
        maxProviderRequests: 6,
        maxInputTokens: 120_000,
        maxOutputTokens: 30_000,
        maxCostMicrousd: 5_000_000,
        maxArtifactBytes: 2_000_000,
      },
      consumed: {
        providerRequests: 2,
        inputTokens: 1_000,
        outputTokens: 500,
        costMicrousd: 20_000,
        artifactBytes: 10_000,
      },
    },
    conceptReview: { status: 'not-ready' },
    cancellationRequestedAt: null,
    error: null,
    attempts: [],
    transitions: [{ sequence: 0, from: null, to: 'verifying', occurredAt: timestamp }],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  }
}

export function retryableFailure(): GenerationStatus {
  const base = verifyingStatus()
  return {
    ...base,
    state: 'provider_failed',
    revision: 7,
    error: {
      category: 'transient',
      stableErrorId: 'provider.transient-failure',
      retryable: true,
    },
    transitions: [
      {
        sequence: 0,
        from: null,
        to: 'provider_failed',
        occurredAt: '2026-07-16T12:02:00.000Z',
      },
    ],
    completedAt: '2026-07-16T12:02:00.000Z',
  }
}
