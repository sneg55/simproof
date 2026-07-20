import type { EducatorGenerationState } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { generationStatePresentation } from '@/generation/generation-state'

describe('generation state presentation', () => {
  it('gives every public state a distinct truthful label and explanation', () => {
    const states: EducatorGenerationState[] = [
      'queued',
      'compiling',
      'awaiting_confirmation',
      'generating',
      'executing',
      'verifying',
      'repairing',
      'verified',
      'rejected',
      'provider_failed',
      'runner_failed',
      'cancelled',
      'budget_exhausted',
      'invariant_failed',
    ]

    const presentations = states.map(generationStatePresentation)

    expect(new Set(presentations.map(({ label }) => label)).size).toBe(states.length)
    for (const presentation of presentations) {
      expect(presentation.description.length).toBeGreaterThan(20)
    }
    expect(generationStatePresentation('verified').description).toContain('passed')
    expect(generationStatePresentation('rejected').description).toContain('did not pass')
    expect(generationStatePresentation('runner_failed').description).not.toContain('rejected')
  })
})
