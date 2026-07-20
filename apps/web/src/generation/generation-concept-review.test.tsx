import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorGenerationApi } from '@/api/educator-api'
import { GenerationRun } from '@/generation/generation-workspace'
import {
  accepted,
  api,
  conceptSpecHash,
  csrfToken,
  runId,
  simulationId,
  status,
} from '@/generation/test-fixtures'

describe('generation concept review', () => {
  it('renders and accepts the exact concept domain, units, defaults, and ranges', async () => {
    const pending = status('awaiting_confirmation', {
      conceptReview: {
        status: 'pending',
        reviewRevision: 0,
        conceptSpecHash,
        conceptSpec: {
          schemaVersion: '1',
          domain: 'pendulum',
          title: 'Pendulum period explorer',
          parameters: {
            length: { unit: 'm', defaultValue: 1.5, requestedRange: { min: 0.5, max: 3 } },
            amplitude: {
              unit: 'deg',
              defaultValue: 20,
              requestedRange: { min: 0, max: 45 },
            },
          },
          requestedControls: ['length', 'amplitude'],
        },
      },
    })
    const afterAcceptance = status('generating', { revision: 5 })
    const generationStatus = vi
      .fn<EducatorGenerationApi['generationStatus']>()
      .mockResolvedValueOnce({ ok: true, value: pending })
      .mockImplementation(() => new Promise(() => undefined))
    const decideConcept = vi
      .fn<EducatorGenerationApi['decideConcept']>()
      .mockResolvedValue({ ok: true, value: afterAcceptance })
    const generationApi = api({ generationStatus, decideConcept })

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

    expect(await screen.findByRole('heading', { name: 'Pendulum period explorer' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'Length' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '1.5' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'm' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '0.5 to 3' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Accept concept and continue' }))

    await waitFor(() =>
      expect(decideConcept).toHaveBeenCalledWith(
        runId,
        {
          expectedRunRevision: 4,
          expectedReviewRevision: 0,
          conceptSpecHash,
          decision: 'accept',
        },
        csrfToken,
      ),
    )
    expect(await screen.findByText('Building simulation')).toBeInTheDocument()
  })

  it('declines only the exact review revision', async () => {
    const pending = status('awaiting_confirmation', {
      revision: 8,
      conceptReview: {
        status: 'pending',
        reviewRevision: 9,
        conceptSpecHash,
        conceptSpec: {
          schemaVersion: '1',
          domain: 'projectile',
          title: 'Launch comparison',
          parameters: {
            initialSpeed: {
              unit: 'm/s',
              defaultValue: 20,
              requestedRange: { min: 5, max: 40 },
            },
            launchAngle: {
              unit: 'deg',
              defaultValue: 45,
              requestedRange: { min: 10, max: 80 },
            },
          },
          requestedControls: ['initialSpeed', 'launchAngle'],
        },
      },
    })
    const declined = status('cancelled', {
      revision: 9,
      conceptReview: {
        status: 'declined',
        reviewRevision: 10,
        conceptSpecHash,
        declinedAt: '2026-07-16T12:03:00.000Z',
      },
      completedAt: '2026-07-16T12:03:00.000Z',
    })
    const generationStatus = vi
      .fn<EducatorGenerationApi['generationStatus']>()
      .mockResolvedValueOnce({ ok: true, value: pending })
      .mockImplementation(() => new Promise(() => undefined))
    const decideConcept = vi
      .fn<EducatorGenerationApi['decideConcept']>()
      .mockResolvedValue({ ok: true, value: declined })
    const generationApi = api({ generationStatus, decideConcept })

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

    const decline = await screen.findByRole('button', { name: 'Decline concept' })
    decline.focus()
    expect(decline).toHaveFocus()
    fireEvent.click(decline)
    fireEvent.click(screen.getByRole('button', { name: 'Decline and end run' }))

    await waitFor(() =>
      expect(decideConcept).toHaveBeenCalledWith(
        runId,
        {
          expectedRunRevision: 8,
          expectedReviewRevision: 9,
          conceptSpecHash,
          decision: 'decline',
        },
        csrfToken,
      ),
    )
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  })
})
