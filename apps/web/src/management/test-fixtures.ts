import type {
  EducatorVersionDetail,
  GenerationAccepted,
  SimulationDetail,
  VersionComparison,
  VersionHistory,
} from '@simproof/contracts'
import { vi } from 'vitest'

import type { LibraryManagementApi } from '@/api/library-management-api'

export const simulationId = '11111111-1111-4111-8111-111111111111'
export const versionOneId = '22222222-2222-4222-8222-222222222222'
export const versionTwoId = '33333333-3333-4333-8333-333333333333'
const verificationId = '44444444-4444-4444-8444-444444444444'
const hash = 'a'.repeat(64)
const timestamp = '2026-07-16T12:00:00.000Z'

export function versionOne(): EducatorVersionDetail {
  return {
    summary: {
      id: versionOneId,
      versionNumber: 1,
      state: 'draft',
      revision: 3,
      domain: 'pendulum',
      verification: { status: 'none' },
      updatedAt: timestamp,
    },
    conceptSpec: null,
    exportLicense: null,
    generationProvenance: null,
    lineage: null,
    availableActions: ['duplicate', 'export'],
    createdAt: timestamp,
  }
}

export function versionTwo(): EducatorVersionDetail {
  return {
    summary: {
      id: versionTwoId,
      versionNumber: 2,
      state: 'stale',
      revision: 9,
      domain: 'pendulum',
      verification: {
        status: 'stale',
        verificationRunId: verificationId,
        verdict: 'verified',
        artifactHash: hash,
        reportHash: hash,
        reasons: ['policy-changed'],
      },
      updatedAt: timestamp,
    },
    conceptSpec: null,
    exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
    generationProvenance: null,
    lineage: null,
    availableActions: [
      'start-blank-version',
      'duplicate',
      'export',
      'archive',
      'delete',
      'reverify',
    ],
    createdAt: timestamp,
  }
}

export function simulationDetail(): SimulationDetail {
  const selectedVersion = versionTwo()
  return {
    simulation: {
      id: simulationId,
      title: 'Pendulum lesson',
      source: { kind: 'teacher' },
      currentVersion: selectedVersion.summary,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    selectedVersion,
  }
}

export function versionHistory(): VersionHistory {
  return { simulationId, versions: [versionOne(), versionTwo()] }
}

export function comparison(): VersionComparison {
  return {
    simulationId,
    left: versionOne(),
    right: versionTwo(),
    rows: [
      'state',
      'artifact',
      'concept',
      'policy',
      'domain-pack',
      'runner',
      'verdict',
      'findings',
      'assumptions',
      'limitations',
      'publication',
      'export-license',
    ].map((field) => ({
      field,
      changed: ['state', 'policy', 'findings', 'publication'].includes(field),
      left: comparisonValue(`Left ${field}`),
      right: comparisonValue(`Right ${field}`),
    })) as VersionComparison['rows'],
  }
}

export function accepted(): GenerationAccepted {
  return {
    runId: '55555555-5555-4555-8555-555555555555',
    created: true,
    state: 'queued',
    revision: 0,
  }
}

export function managementApi(overrides: Partial<LibraryManagementApi> = {}): LibraryManagementApi {
  return {
    createDraft: vi.fn(),
    simulationDetail: vi.fn().mockResolvedValue({ ok: true, value: simulationDetail() }),
    versionHistory: vi.fn().mockResolvedValue({ ok: true, value: versionHistory() }),
    compareVersions: vi.fn().mockResolvedValue({ ok: true, value: comparison() }),
    startBlankVersion: vi.fn().mockResolvedValue({ ok: true, value: simulationDetail() }),
    duplicateSimulation: vi.fn().mockResolvedValue({ ok: true, value: simulationDetail() }),
    exportSimulation: vi.fn(),
    archiveVersion: vi.fn().mockResolvedValue({ ok: true, value: simulationDetail() }),
    deleteSimulation: vi.fn(),
    reverifyVersion: vi.fn().mockResolvedValue({ ok: true, value: accepted() }),
    ...overrides,
  }
}

function comparisonValue(summary: string): VersionComparison['rows'][number]['left'] {
  return { summary, details: [], totalDetailCount: 0, truncated: false }
}
