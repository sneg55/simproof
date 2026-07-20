import type { EducatorGenerationState } from '@simproof/contracts'
import { Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Phase {
  readonly label: string
  readonly states: readonly EducatorGenerationState[]
}

const PHASES: readonly Phase[] = [
  { label: 'Request', states: ['queued'] },
  { label: 'Compile', states: ['compiling', 'awaiting_confirmation'] },
  { label: 'Generate', states: ['generating', 'repairing'] },
  { label: 'Execute', states: ['executing'] },
  { label: 'Verify', states: ['verifying'] },
  {
    label: 'Result',
    states: [
      'verified',
      'rejected',
      'provider_failed',
      'runner_failed',
      'cancelled',
      'budget_exhausted',
      'invariant_failed',
    ],
  },
]

const FAILED_STATES = new Set<EducatorGenerationState>([
  'rejected',
  'provider_failed',
  'runner_failed',
  'budget_exhausted',
  'invariant_failed',
])

type PhaseStatus = 'done' | 'active' | 'pending' | 'failed'

/**
 * A compact, animated pipeline of the durable generation lifecycle with the
 * current phase highlighted. Decorative reinforcement (aria-hidden): the run
 * badge, status region, and description carry the accessible status text. The
 * active-phase pulse is disabled automatically under reduced-motion by the
 * global stylesheet.
 */
export function GenerationPipeline({
  state,
  terminal,
}: {
  readonly state: EducatorGenerationState
  readonly terminal: boolean
}) {
  const found = PHASES.findIndex((phase) => phase.states.includes(state))
  const activeIndex = found === -1 ? 0 : found
  const failed = FAILED_STATES.has(state)
  return (
    <ol
      aria-hidden="true"
      className="flex items-start gap-0 overflow-x-auto rounded-md border border-border bg-muted/30 p-3"
    >
      {PHASES.map((phase, index) => {
        const status = phaseStatus(index, activeIndex, terminal, failed)
        return (
          <li className="flex min-w-14 flex-1 flex-col items-center gap-1.5" key={phase.label}>
            <div className="flex w-full items-center">
              <Connector filled={index <= activeIndex} hidden={index === 0} />
              <PhaseDot index={index} status={status} />
              <Connector filled={index < activeIndex} hidden={index === PHASES.length - 1} />
            </div>
            <span className={cn('text-[11px] font-medium', labelClass(status))}>{phase.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function phaseStatus(
  index: number,
  activeIndex: number,
  terminal: boolean,
  failed: boolean,
): PhaseStatus {
  if (index < activeIndex) return 'done'
  if (index > activeIndex) return 'pending'
  if (!terminal) return 'active'
  return failed ? 'failed' : 'done'
}

function Connector({ filled, hidden }: { readonly filled: boolean; readonly hidden: boolean }) {
  return (
    <span
      className={cn(
        'h-0.5 flex-1 rounded-full',
        hidden ? 'invisible' : filled ? 'bg-status-verified' : 'bg-border',
      )}
    />
  )
}

function PhaseDot({ index, status }: { readonly index: number; readonly status: PhaseStatus }) {
  const base =
    'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'
  if (status === 'done') {
    return (
      <span className={cn(base, 'bg-status-verified text-status-verified-foreground')}>
        <Check aria-hidden />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={cn(base, 'bg-destructive text-white')}>
        <X aria-hidden />
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className={cn(base, 'animate-pulse border-2 border-signal bg-background text-signal')}>
        {index + 1}
      </span>
    )
  }
  return (
    <span className={cn(base, 'border border-border bg-background text-muted-foreground')}>
      {index + 1}
    </span>
  )
}

function labelClass(status: PhaseStatus): string {
  if (status === 'active') return 'text-foreground'
  if (status === 'failed') return 'text-destructive'
  if (status === 'pending') return 'text-muted-foreground'
  return 'text-foreground'
}
