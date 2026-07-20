import type { SimulationDetail } from '@simproof/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorApi, EducatorGenerationApi } from '@/api/educator-api'
import { GenerationPageView } from '@/generation/generation-page'
import {
  detail,
  educatorApi,
  retryableFailure,
  runId,
  runtime,
  simulationId,
  verifyingStatus,
} from '@/generation/generation-page-fixtures'

describe('generation page recovery', () => {
  it('keeps loading and failure states titled, headed, and non-disruptive to focus', async () => {
    let resolveDetail:
      | ((result: Awaited<ReturnType<EducatorApi['simulationDetail']>>) => void)
      | undefined
    const pendingDetail = new Promise<Awaited<ReturnType<EducatorApi['simulationDetail']>>>(
      (resolve) => {
        resolveDetail = resolve
      },
    )
    const currentApi = educatorApi()
    const apiWithFailure = {
      ...currentApi,
      simulationDetail: vi.fn<EducatorApi['simulationDetail']>().mockReturnValue(pendingDetail),
    }
    render(
      <MemoryRouter>
        <button type="button">Existing focus target</button>
        <GenerationPageView
          api={apiWithFailure}
          csrfToken={'c'.repeat(43)}
          generationApi={{
            startGeneration: vi.fn(),
            generationStatus: vi.fn(),
            decideConcept: vi.fn(),
            cancelGeneration: vi.fn(),
          }}
          simulationId={simulationId}
        />
      </MemoryRouter>,
    )
    const focusTarget = screen.getByRole('button', { name: 'Existing focus target' })
    focusTarget.focus()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading generation workspace' }),
    ).toBeVisible()
    expect(document.title).toBe('Loading generation workspace | SimProof')
    expect(focusTarget).toHaveFocus()

    resolveDetail?.({ ok: false, error: { kind: 'unavailable', id: 'fixture.unavailable' } })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Generation workspace unavailable',
      }),
    ).toBeVisible()
    expect(document.title).toBe('Generation workspace unavailable | SimProof')
    expect(focusTarget).toHaveFocus()
  })

  it('recovers an existing run even when the version no longer allows a new start', async () => {
    const generationStatus = vi
      .fn<EducatorGenerationApi['generationStatus']>()
      .mockResolvedValue({ ok: true, value: verifyingStatus() })
    const generationApi: EducatorGenerationApi = {
      startGeneration: vi.fn(),
      generationStatus,
      decideConcept: vi.fn(),
      cancelGeneration: vi.fn(),
    }

    render(
      <MemoryRouter>
        <GenerationPageView
          api={educatorApi()}
          csrfToken={'c'.repeat(43)}
          generationApi={generationApi}
          initialRunId={runId}
          simulationId={simulationId}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Verifying science')).toBeInTheDocument()
    // During an active run the live run state is authoritative; the header lifecycle
    // badge must not compete with a stale "Generating" label.
    expect(screen.queryByText('Generating')).not.toBeInTheDocument()
    expect(generationStatus).toHaveBeenCalledWith(runId, expect.any(AbortSignal))
  })

  it('still blocks a new run when the lifecycle omits start-generation', async () => {
    const generationStatus = vi.fn<EducatorGenerationApi['generationStatus']>()
    render(
      <MemoryRouter>
        <GenerationPageView
          api={educatorApi()}
          csrfToken={'c'.repeat(43)}
          generationApi={{
            startGeneration: vi.fn(),
            generationStatus,
            decideConcept: vi.fn(),
            cancelGeneration: vi.fn(),
          }}
          simulationId={simulationId}
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Generation is not available for this version'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Generation is unavailable' }),
    ).toBeVisible()
    expect(document.title).toBe('Generation unavailable | SimProof')
    expect(generationStatus).not.toHaveBeenCalled()
  })

  it('blocks direct new-run routes when generation is not configured', async () => {
    const startGeneration = vi.fn<EducatorGenerationApi['startGeneration']>()
    const generationApi: EducatorGenerationApi = {
      startGeneration,
      generationStatus: vi.fn(),
      decideConcept: vi.fn(),
      cancelGeneration: vi.fn(),
    }
    const draftDetail: SimulationDetail = {
      ...detail,
      selectedVersion: { ...detail.selectedVersion, availableActions: ['start-generation'] },
    }
    render(
      <MemoryRouter>
        <GenerationPageView
          api={educatorApi({
            simulationDetail: vi.fn(() =>
              Promise.resolve({ ok: true as const, value: draftDetail }),
            ),
            runtimeConfig: vi.fn(() =>
              Promise.resolve({
                ok: true as const,
                value: {
                  ...runtime,
                  runtime: { ...runtime.runtime, providerConfigured: false },
                  generation: {
                    available: false as const,
                    reason: 'provider-not-configured' as const,
                  },
                },
              }),
            ),
          })}
          csrfToken={'c'.repeat(43)}
          generationApi={generationApi}
          simulationId={simulationId}
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(/Generation provider credentials are not configured/),
    ).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Describe the learning experience' })).toBeNull()
    expect(startGeneration).not.toHaveBeenCalled()
  })

  it('refetches the target revision before exposing a retry form', async () => {
    const refreshedDetail: SimulationDetail = {
      ...detail,
      simulation: {
        ...detail.simulation,
        currentVersion: { ...detail.simulation.currentVersion, state: 'draft', revision: 8 },
      },
      selectedVersion: {
        ...detail.selectedVersion,
        summary: { ...detail.selectedVersion.summary, state: 'draft', revision: 8 },
        availableActions: ['start-generation'],
      },
    }
    const simulationDetail = vi
      .fn<EducatorApi['simulationDetail']>()
      .mockResolvedValueOnce({ ok: true, value: detail })
      .mockResolvedValueOnce({ ok: true, value: refreshedDetail })
    const currentApi = educatorApi()
    const apiWithRefresh: EducatorApi = { ...currentApi, simulationDetail }
    const startGeneration = vi.fn<EducatorGenerationApi['startGeneration']>().mockResolvedValue({
      ok: true,
      value: { runId, created: true, state: 'queued', revision: 0 },
    })
    const generationApi: EducatorGenerationApi = {
      startGeneration,
      generationStatus: vi
        .fn<EducatorGenerationApi['generationStatus']>()
        .mockResolvedValue({ ok: true, value: retryableFailure() }),
      decideConcept: vi.fn(),
      cancelGeneration: vi.fn(),
    }

    render(
      <MemoryRouter>
        <GenerationPageView
          api={apiWithRefresh}
          csrfToken={'c'.repeat(43)}
          generationApi={generationApi}
          initialRunId={runId}
          simulationId={simulationId}
        />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start a new run' }))
    expect(
      await screen.findByRole('textbox', { name: 'Describe the learning experience' }),
    ).toBeVisible()
    expect(simulationDetail).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: /Use example: Test a prediction/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))

    await waitFor(() => expect(startGeneration).toHaveBeenCalledOnce())
    expect(startGeneration.mock.calls[0]?.[0].expectedVersionRevision).toBe(8)
  })
})
