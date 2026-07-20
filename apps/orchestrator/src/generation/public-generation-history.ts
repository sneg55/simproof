import type { GenerationStatus } from '@simproof/contracts'
import type { ConceptReview, GenerationPipelineTransition } from '@simproof/persistence'

type PublicTransition = GenerationStatus['transitions'][number]

export function publicGenerationHistory(
  history: readonly GenerationPipelineTransition[],
  review: ConceptReview | undefined,
): PublicTransition[] {
  const transitions: PublicTransition[] = history.map(({ sequence, from, to, transitionedAt }) => ({
    sequence,
    from,
    to,
    occurredAt: transitionedAt,
  }))
  if (review === undefined) return transitions
  const compilingIndex = transitions.findIndex(({ to }) => to === 'compiling')
  if (compilingIndex < 0) return transitions
  const next = transitions[compilingIndex + 1]
  if (review.status !== 'pending' && next === undefined) return transitions
  transitions.splice(compilingIndex + 1, 0, {
    sequence: 0,
    from: 'compiling',
    to: 'awaiting_confirmation',
    occurredAt: review.createdAt,
  })
  const following = transitions[compilingIndex + 2]
  if (following?.from === 'compiling') {
    transitions[compilingIndex + 2] = {
      ...following,
      from: 'awaiting_confirmation',
    }
  }
  return transitions.map((transition, sequence) => ({ ...transition, sequence }))
}
