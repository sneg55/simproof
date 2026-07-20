import type { ConceptReview, GenerationPipelineTransition } from '@simproof/persistence'
import { describe, expect, it } from 'vitest'

import { publicGenerationHistory } from './public-generation-history.js'

const NOW = '2026-07-16T12:00:00.000Z'
const REVIEWED = '2026-07-16T12:00:01.000Z'
const RESOLVED = '2026-07-16T12:00:02.000Z'

const base: GenerationPipelineTransition[] = [
  { runId: 'run', sequence: 0, from: null, to: 'queued', transitionedAt: NOW },
  { runId: 'run', sequence: 1, from: 'queued', to: 'compiling', transitionedAt: REVIEWED },
]

const review = (status: ConceptReview['status']): ConceptReview => ({
  id: 'review',
  runId: 'run',
  simulationVersionId: 'version',
  conceptSpecId: 'concept',
  conceptHash: `sha256:${'a'.repeat(64)}`,
  status,
  revision: status === 'pending' ? 0 : 1,
  createdAt: REVIEWED,
  updatedAt: status === 'pending' ? REVIEWED : RESOLVED,
  resolvedAt: status === 'pending' ? null : RESOLVED,
})

describe('public generation transition history', () => {
  it('appends awaiting confirmation while the review is pending', () => {
    expect(publicGenerationHistory(base, review('pending'))).toEqual([
      { sequence: 0, from: null, to: 'queued', occurredAt: NOW },
      { sequence: 1, from: 'queued', to: 'compiling', occurredAt: REVIEWED },
      {
        sequence: 2,
        from: 'compiling',
        to: 'awaiting_confirmation',
        occurredAt: REVIEWED,
      },
    ])
  })

  it('preserves awaiting confirmation after acceptance advances the run', () => {
    const advanced: GenerationPipelineTransition[] = [
      ...base,
      {
        runId: 'run',
        sequence: 2,
        from: 'compiling',
        to: 'generating',
        transitionedAt: RESOLVED,
      },
    ]

    expect(publicGenerationHistory(advanced, review('confirmed'))).toEqual([
      { sequence: 0, from: null, to: 'queued', occurredAt: NOW },
      { sequence: 1, from: 'queued', to: 'compiling', occurredAt: REVIEWED },
      {
        sequence: 2,
        from: 'compiling',
        to: 'awaiting_confirmation',
        occurredAt: REVIEWED,
      },
      {
        sequence: 3,
        from: 'awaiting_confirmation',
        to: 'generating',
        occurredAt: RESOLVED,
      },
    ])
  })

  it('preserves awaiting confirmation after decline or cancellation', () => {
    const cancelled: GenerationPipelineTransition[] = [
      ...base,
      {
        runId: 'run',
        sequence: 2,
        from: 'compiling',
        to: 'cancelled',
        transitionedAt: RESOLVED,
      },
    ]

    expect(publicGenerationHistory(cancelled, review('cancelled')).at(-1)).toEqual({
      sequence: 3,
      from: 'awaiting_confirmation',
      to: 'cancelled',
      occurredAt: RESOLVED,
    })
    expect(publicGenerationHistory(cancelled, review('cancelled')).map(({ to }) => to)).toEqual([
      'queued',
      'compiling',
      'awaiting_confirmation',
      'cancelled',
    ])
  })
})
