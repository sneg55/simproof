import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorGenerationApi } from '@/api/educator-api'
import { GenerationWorkspace } from '@/generation/generation-workspace'
import { api, csrfToken, runId, simulationId, status, target } from '@/generation/test-fixtures'

describe('generation workspace', () => {
  it('offers guided prompts and records explicit provider disclosure before accepting a run', async () => {
    const startGeneration = vi.fn<EducatorGenerationApi['startGeneration']>().mockResolvedValue({
      ok: true,
      value: { runId, created: true, state: 'queued', revision: 0 },
    })
    const generationApi = api({ startGeneration })
    render(
      <GenerationWorkspace
        api={generationApi}
        csrfToken={csrfToken}
        idempotencyKeyFactory={() => 'web:pendulum:fixture'}
        simulationId={simulationId}
        target={target}
      />,
    )

    const prompt = screen.getByRole('textbox', { name: 'Describe the learning experience' })
    expect(screen.getByRole('button', { name: 'Review disclosure and start' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Use example: Explore pendulum length/i }))
    expect((prompt as HTMLTextAreaElement).value).toContain('pendulum')
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('external AI provider')
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))

    await waitFor(() => expect(startGeneration).toHaveBeenCalledOnce())
    expect(startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        simulationVersionId: target.simulationVersionId,
        expectedVersionRevision: 3,
        idempotencyKey: 'web:pendulum:fixture',
        teacher: expect.objectContaining({
          externalProviderDisclosureAccepted: true,
          promptRetention: 'discard',
        }),
      }),
      csrfToken,
    )
    expect(await screen.findByText('Queued')).toBeInTheDocument()
  })

  it('replays the same idempotency key after an ambiguous start failure', async () => {
    const startGeneration = vi
      .fn<EducatorGenerationApi['startGeneration']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'network', id: 'web.network-unavailable' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { runId, created: true, state: 'queued', revision: 0 },
      })
    const idempotencyKeyFactory = vi.fn(() => 'web:stable:request')
    render(
      <GenerationWorkspace
        api={api({ startGeneration })}
        csrfToken={csrfToken}
        idempotencyKeyFactory={idempotencyKeyFactory}
        simulationId={simulationId}
        target={target}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Use example: Test a prediction/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))
    expect(await screen.findByText('Generation could not be started')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))

    await waitFor(() => expect(startGeneration).toHaveBeenCalledTimes(2))
    expect(startGeneration.mock.calls[0]?.[0].idempotencyKey).toBe('web:stable:request')
    expect(startGeneration.mock.calls[1]?.[0].idempotencyKey).toBe('web:stable:request')
    expect(idempotencyKeyFactory).toHaveBeenCalledOnce()
  })

  it('identifies unavailable generation services instead of blaming the version', async () => {
    render(
      <GenerationWorkspace
        api={api({
          startGeneration: vi.fn().mockResolvedValue({
            ok: false,
            error: { kind: 'unavailable', id: 'http.educator-unavailable' },
          }),
        })}
        csrfToken={csrfToken}
        simulationId={simulationId}
        target={target}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Use example: Test a prediction/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Review disclosure and start' }))
    fireEvent.click(screen.getByRole('button', { name: 'I understand and start' }))

    expect(
      await screen.findByText(/Ask a server administrator to check provider and runner/),
    ).toBeVisible()
    expect(screen.queryByText(/Check the simulation version/)).toBeNull()
  })

  it('resumes a durable run from its server identifier after navigation recovery', async () => {
    const generationStatus = vi
      .fn<EducatorGenerationApi['generationStatus']>()
      .mockResolvedValue({ ok: true, value: status('verifying') })
    render(
      <GenerationWorkspace
        api={api({ generationStatus })}
        csrfToken={csrfToken}
        initialRunId={runId}
        simulationId={simulationId}
        target={target}
      />,
    )

    expect(await screen.findByText('Verifying science')).toBeInTheDocument()
    expect(generationStatus).toHaveBeenCalledWith(runId, expect.any(AbortSignal))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
