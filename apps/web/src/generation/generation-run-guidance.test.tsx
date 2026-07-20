import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorGenerationApi } from '@/api/educator-api'
import { GenerationRun } from '@/generation/generation-workspace'
import { accepted, api, csrfToken, simulationId, status } from '@/generation/test-fixtures'

describe('generation run failure guidance', () => {
  it.each([
    {
      category: 'authentication' as const,
      state: 'provider_failed' as const,
      stableErrorId: 'provider.authentication-failed',
      outcome: 'provider_failed' as const,
      guidance: 'Ask an administrator to check the generation provider credentials.',
    },
    {
      category: 'quota' as const,
      state: 'provider_failed' as const,
      stableErrorId: 'provider.quota-exceeded',
      outcome: 'provider_failed' as const,
      guidance: 'Ask an administrator to review the generation provider quota.',
    },
    {
      category: 'malformed-response' as const,
      state: 'provider_failed' as const,
      stableErrorId: 'provider.malformed-response',
      outcome: 'malformed_response' as const,
      guidance: 'The provider returned output that could not pass strict validation.',
    },
    {
      category: 'transient' as const,
      state: 'provider_failed' as const,
      stableErrorId: 'provider.transient-failure',
      outcome: 'provider_failed' as const,
      guidance: 'The provider had a temporary problem. You can start a new run.',
    },
    {
      category: 'budget' as const,
      state: 'budget_exhausted' as const,
      stableErrorId: 'generation.budget-exhausted',
      outcome: 'budget_exhausted' as const,
      guidance: 'Increase the configured budget only after reviewing the run usage.',
    },
    {
      category: 'invariant' as const,
      state: 'invariant_failed' as const,
      stableErrorId: 'orchestration.invariant-failed',
      outcome: 'invariant_failed' as const,
      guidance:
        'SimProof stopped this run after an internal error. Start a new run, and share the run reference below with your administrator if it keeps happening.',
    },
  ])('renders safe $category guidance and bounded attempt evidence', async (scenario) => {
    const terminal = status(scenario.state, {
      completedAt: '2026-07-16T12:02:00.000Z',
      error: {
        category: scenario.category,
        stableErrorId: scenario.stableErrorId,
        retryable: scenario.category === 'transient',
      },
      attempts: [
        {
          attemptNumber: 1,
          kind: 'generation',
          outcome: scenario.outcome,
          artifactHash: null,
          verificationRunId: null,
          stableErrorId: scenario.stableErrorId,
          createdAt: '2026-07-16T12:01:00.000Z',
          completedAt: '2026-07-16T12:02:00.000Z',
        },
      ],
    })
    render(
      <GenerationRun
        accepted={accepted}
        api={api({
          generationStatus: vi
            .fn<EducatorGenerationApi['generationStatus']>()
            .mockResolvedValue({ ok: true, value: terminal }),
        })}
        csrfToken={csrfToken}
        onRestart={vi.fn()}
        simulationId={simulationId}
      />,
      { wrapper: MemoryRouter },
    )

    expect(await screen.findByText(scenario.guidance)).toBeVisible()
    expect(screen.getAllByText(`Error reference: ${scenario.stableErrorId}`)).toHaveLength(2)
    expect(screen.queryByText(/scientific rejection/iu)).not.toBeInTheDocument()
  })
})
