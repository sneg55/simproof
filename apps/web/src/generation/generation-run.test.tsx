import type { CancellationAccepted } from '@simproof/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorGenerationApi } from '@/api/educator-api'
import { GenerationRun } from '@/generation/generation-workspace'
import {
  accepted,
  api,
  csrfToken,
  runId,
  simulationId,
  status,
  target,
} from '@/generation/test-fixtures'

describe('generation run controls', () => {
  it('cancels with the displayed revision and offers restart only for retryable failures', async () => {
    const cancellation: CancellationAccepted = {
      runId,
      cancellationRequestedAt: '2026-07-16T12:01:00.000Z',
    }
    const running = status('executing', { revision: 7 })
    const restart = vi.fn()
    const cancelGeneration = vi
      .fn<EducatorGenerationApi['cancelGeneration']>()
      .mockResolvedValue({ ok: true, value: cancellation })
    const generationApi = api({
      generationStatus: vi
        .fn<EducatorGenerationApi['generationStatus']>()
        .mockResolvedValue({ ok: true, value: running }),
      cancelGeneration,
    })
    const { rerender } = render(
      <GenerationRun
        accepted={accepted}
        api={generationApi}
        csrfToken={csrfToken}
        onRestart={restart}
        simulationId={simulationId}
      />,
      { wrapper: MemoryRouter },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel generation' }))
    await waitFor(() =>
      expect(cancelGeneration).toHaveBeenCalledWith(runId, { expectedRunRevision: 7 }, csrfToken),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Cancellation requested')

    const failed = status('provider_failed', {
      completedAt: '2026-07-16T12:02:00.000Z',
      error: {
        category: 'transient',
        stableErrorId: 'provider.transient-failure',
        retryable: true,
      },
      attempts: [
        {
          attemptNumber: 1,
          kind: 'generation',
          outcome: 'provider_failed',
          artifactHash: null,
          verificationRunId: null,
          stableErrorId: 'provider.transient-failure',
          createdAt: '2026-07-16T12:01:00.000Z',
          completedAt: '2026-07-16T12:02:00.000Z',
        },
      ],
    })
    rerender(
      <GenerationRun
        accepted={accepted}
        api={api({
          generationStatus: vi
            .fn<EducatorGenerationApi['generationStatus']>()
            .mockResolvedValue({ ok: true, value: failed }),
        })}
        csrfToken={csrfToken}
        onRestart={restart}
        simulationId={simulationId}
      />,
    )
    expect(
      await screen.findByText('The provider had a temporary problem. You can start a new run.'),
    ).toBeVisible()
    expect(screen.getAllByText('Error reference: provider.transient-failure')).toHaveLength(2)
    expect(screen.getByText('Attempt 1: generation')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Start a new run' }))
    expect(restart).toHaveBeenCalledOnce()
  })

  it('announces polling changes without moving keyboard focus', async () => {
    let resolveStatus:
      | ((result: Awaited<ReturnType<EducatorGenerationApi['generationStatus']>>) => void)
      | undefined
    const pendingStatus = new Promise<
      Awaited<ReturnType<EducatorGenerationApi['generationStatus']>>
    >((resolve) => {
      resolveStatus = resolve
    })
    const generationApi = api({
      generationStatus: vi
        .fn<EducatorGenerationApi['generationStatus']>()
        .mockReturnValue(pendingStatus),
    })
    render(
      <GenerationRun
        accepted={accepted}
        api={generationApi}
        csrfToken={csrfToken}
        onRestart={vi.fn()}
        simulationId={simulationId}
      />,
      { wrapper: MemoryRouter },
    )

    const cancel = screen.getByRole('button', { name: 'Cancel generation' })
    cancel.focus()
    resolveStatus?.({ ok: true, value: status('executing') })

    expect(await screen.findByText('Running safely')).toBeInTheDocument()
    expect(cancel).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Generation status: Running safely')
  })

  it('routes a verified run to publish, preview, and the simulation without a false publish promise', async () => {
    const verified = status('verified', { completedAt: '2026-07-16T12:02:00.000Z' })
    render(
      <GenerationRun
        accepted={accepted}
        api={api({
          generationStatus: vi
            .fn<EducatorGenerationApi['generationStatus']>()
            .mockResolvedValue({ ok: true, value: verified }),
        })}
        csrfToken={csrfToken}
        onRestart={vi.fn()}
        simulationId={simulationId}
      />,
      { wrapper: MemoryRouter },
    )

    expect(await screen.findByRole('link', { name: 'Review and publish' })).toHaveAttribute(
      'href',
      `/versions/${target.simulationVersionId}/report`,
    )
    expect(screen.getByRole('link', { name: 'Open accessible preview' })).toHaveAttribute(
      'href',
      `/simulations/${simulationId}/preview`,
    )
    expect(screen.getByRole('link', { name: 'Open simulation' })).toHaveAttribute(
      'href',
      `/simulations/${simulationId}`,
    )
    expect(screen.queryByRole('link', { name: /publish this version/i })).toBeNull()
  })
})
