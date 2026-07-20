import type { EducatorGenerationState } from '@simproof/contracts'

export interface GenerationStatePresentation {
  readonly state: EducatorGenerationState
  readonly label: string
  readonly description: string
  readonly terminal: boolean
  readonly tone: 'neutral' | 'positive' | 'negative'
}

const presentations = new Map<EducatorGenerationState, Omit<GenerationStatePresentation, 'state'>>([
  [
    'queued',
    {
      label: 'Queued',
      description: 'Your request is saved and waiting to begin.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'compiling',
    {
      label: 'Building concept',
      description:
        'Your prompt is being turned into a structured concept with exact parameters, units, and ranges.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'awaiting_confirmation',
    {
      label: 'Ready for concept review',
      description:
        'Review the exact domain, parameters, units, and ranges before the simulation is built.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'generating',
    {
      label: 'Building simulation',
      description: 'SimProof is building the simulation from the approved concept.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'executing',
    {
      label: 'Running safely',
      description: 'The draft is running inside a sealed sandbox, never in this browser.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'verifying',
    {
      label: 'Verifying science',
      description:
        'Independent scientific checks are comparing the results against the trusted physics model.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'repairing',
    {
      label: 'Repairing draft',
      description:
        'The draft is being revised against the recorded findings. The scientific checks stay unchanged.',
      terminal: false,
      tone: 'neutral',
    },
  ],
  [
    'verified',
    {
      label: 'Verified',
      description:
        'The draft passed every independent scientific check and is ready for your review.',
      terminal: true,
      tone: 'positive',
    },
  ],
  [
    'rejected',
    {
      label: 'Scientifically rejected',
      description: 'The draft did not pass the scientific checks after the allowed attempts.',
      terminal: true,
      tone: 'negative',
    },
  ],
  [
    'provider_failed',
    {
      label: 'Provider failed',
      description: 'The external AI provider could not complete this request.',
      terminal: true,
      tone: 'negative',
    },
  ],
  [
    'runner_failed',
    {
      label: 'Sandbox failed',
      description: 'The sealed sandbox could not finish running the draft.',
      terminal: true,
      tone: 'negative',
    },
  ],
  [
    'cancelled',
    {
      label: 'Cancelled',
      description:
        'Generation stopped after your cancellation request and no further work will start.',
      terminal: true,
      tone: 'neutral',
    },
  ],
  [
    'budget_exhausted',
    {
      label: 'Budget exhausted',
      description: 'The generation budget was used up before the checks could finish.',
      terminal: true,
      tone: 'negative',
    },
  ],
  [
    'invariant_failed',
    {
      label: 'Safety check stopped the run',
      description:
        'SimProof stopped the run because an internal safety check did not pass. Nothing unverified was saved.',
      terminal: true,
      tone: 'negative',
    },
  ],
])

export function generationStatePresentation(
  state: EducatorGenerationState,
): GenerationStatePresentation {
  const presentation = presentations.get(state)
  if (presentation === undefined) throw new TypeError('Unknown educator generation state.')
  return { ...presentation, state }
}
