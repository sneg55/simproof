import type {
  EducatorRuntimeConfig,
  GenerationAccepted,
  SimulationDetail,
} from '@simproof/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorApi, EducatorGenerationApi } from '@/api/educator-api'
import type { LibraryManagementApi } from '@/api/library-management-api'
import { NewSimulationPageView } from '@/generation/new-simulation-page'
import { managementApi } from '@/management/test-fixtures'

const csrfToken = 'c'.repeat(43)
const simulationId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const runId = '33333333-3333-4333-8333-333333333333'
const timestamp = '2026-07-16T12:00:00.000Z'

function runtimeConfig(
  generation: EducatorRuntimeConfig['generation'] = { available: true },
): EducatorRuntimeConfig {
  return {
    runtime: {
      deploymentMode: 'loopback',
      providerConfigured: true,
      maxRequestBytes: 65_536,
      maxPromptCharacters: 16_384,
      promptRetentionDefault: 'discard',
      telemetryEnabled: false,
      externalDiagnosticsEnabled: false,
    },
    generation,
    seedLibraryReady: true,
    supportedDomains: ['pendulum', 'projectile'],
  }
}

function createdDraft(): SimulationDetail {
  const summary = {
    id: versionId,
    versionNumber: 1,
    state: 'draft' as const,
    revision: 4,
    domain: null,
    verification: { status: 'none' as const },
    updatedAt: timestamp,
  }
  return {
    simulation: {
      id: simulationId,
      title: 'Pendulum Lab',
      source: { kind: 'teacher' },
      currentVersion: summary,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    selectedVersion: {
      summary,
      conceptSpec: null,
      exportLicense: null,
      generationProvenance: null,
      lineage: null,
      availableActions: ['start-generation'],
      createdAt: timestamp,
    },
  }
}

const accepted: GenerationAccepted = { runId, created: true, state: 'queued', revision: 0 }

function runtimeApi(
  generation?: EducatorRuntimeConfig['generation'],
): Pick<EducatorApi, 'runtimeConfig'> {
  return {
    runtimeConfig: vi
      .fn<EducatorApi['runtimeConfig']>()
      .mockResolvedValue({ ok: true, value: runtimeConfig(generation) }),
  }
}

function generationApi(overrides: Partial<EducatorGenerationApi> = {}): EducatorGenerationApi {
  return {
    startGeneration: vi
      .fn<EducatorGenerationApi['startGeneration']>()
      .mockResolvedValue({ ok: true, value: accepted }),
    generationStatus: vi.fn(),
    decideConcept: vi.fn(),
    cancelGeneration: vi.fn(),
    ...overrides,
  }
}

async function fillAndStart(title: string): Promise<void> {
  const titleField = await screen.findByRole('textbox', { name: 'Simulation title' })
  fireEvent.change(titleField, { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: /Use example: Explore pendulum length/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
  fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))
}

describe('new simulation page', () => {
  it('creates a named draft, starts one run against it, and hands off to the generate route', async () => {
    const createDraft = vi
      .fn<LibraryManagementApi['createDraft']>()
      .mockResolvedValue({ ok: true, value: createdDraft() })
    const startGeneration = vi
      .fn<EducatorGenerationApi['startGeneration']>()
      .mockResolvedValue({ ok: true, value: accepted })
    const onRunStarted = vi.fn()
    render(
      <MemoryRouter>
        <NewSimulationPageView
          csrfToken={csrfToken}
          generationApi={generationApi({ startGeneration })}
          idempotencyKeyFactory={() => 'web:new:fixture'}
          managementApi={managementApi({ createDraft })}
          onRunStarted={onRunStarted}
          runtimeApi={runtimeApi()}
        />
      </MemoryRouter>,
    )

    await fillAndStart('  Pendulum Lab  ')

    await waitFor(() =>
      expect(createDraft).toHaveBeenCalledWith({ title: 'Pendulum Lab' }, csrfToken),
    )
    expect(startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        simulationVersionId: versionId,
        expectedVersionRevision: 4,
        idempotencyKey: 'web:new:fixture',
        teacher: expect.objectContaining({
          externalProviderDisclosureAccepted: true,
          promptRetention: 'discard',
        }),
      }),
      csrfToken,
    )
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith(simulationId, runId))
  })

  it('surfaces a draft creation failure without starting a run', async () => {
    const createDraft = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { kind: 'network', id: 'web.network' } })
    const startGeneration = vi.fn<EducatorGenerationApi['startGeneration']>()
    const onRunStarted = vi.fn()
    render(
      <MemoryRouter>
        <NewSimulationPageView
          csrfToken={csrfToken}
          generationApi={generationApi({ startGeneration })}
          managementApi={managementApi({ createDraft })}
          onRunStarted={onRunStarted}
          runtimeApi={runtimeApi()}
        />
      </MemoryRouter>,
    )

    await fillAndStart('Pendulum Lab')

    expect(await screen.findByText('SimProof could not create the draft. Try again.')).toBeVisible()
    expect(startGeneration).not.toHaveBeenCalled()
    expect(onRunStarted).not.toHaveBeenCalled()
  })

  it('reuses the created draft and idempotency key when a start fails and is retried', async () => {
    const createDraft = vi.fn().mockResolvedValue({ ok: true, value: createdDraft() })
    const startGeneration = vi
      .fn<EducatorGenerationApi['startGeneration']>()
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network', id: 'web.network' } })
      .mockResolvedValueOnce({ ok: true, value: accepted })
    const idempotencyKeyFactory = vi.fn(() => 'web:stable:request')
    const onRunStarted = vi.fn()
    render(
      <MemoryRouter>
        <NewSimulationPageView
          csrfToken={csrfToken}
          generationApi={generationApi({ startGeneration })}
          idempotencyKeyFactory={idempotencyKeyFactory}
          managementApi={managementApi({ createDraft })}
          onRunStarted={onRunStarted}
          runtimeApi={runtimeApi()}
        />
      </MemoryRouter>,
    )

    await fillAndStart('Pendulum Lab')
    expect(await screen.findByText('Generation could not be started')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))

    await waitFor(() => expect(startGeneration).toHaveBeenCalledTimes(2))
    expect(createDraft).toHaveBeenCalledOnce()
    expect(idempotencyKeyFactory).toHaveBeenCalledOnce()
    expect(startGeneration.mock.calls[0]?.[0].idempotencyKey).toBe('web:stable:request')
    expect(startGeneration.mock.calls[1]?.[0].idempotencyKey).toBe('web:stable:request')
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith(simulationId, runId))
  })

  it('refuses to create a simulation when generation is unavailable', async () => {
    const createDraft = vi.fn()
    render(
      <MemoryRouter>
        <NewSimulationPageView
          csrfToken={csrfToken}
          generationApi={generationApi()}
          managementApi={managementApi({ createDraft })}
          onRunStarted={vi.fn()}
          runtimeApi={runtimeApi({ available: false, reason: 'provider-not-configured' })}
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Generation is unavailable' }),
    ).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Simulation title' })).toBeNull()
    expect(createDraft).not.toHaveBeenCalled()
  })
})
