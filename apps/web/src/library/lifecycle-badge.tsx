import type { SimulationLifecycleState } from '@simproof/contracts'

import { Badge } from '@/components/ui/badge'
import { VerificationBadge } from '@/components/ui/verification-badge'

function stateLabel(state: SimulationLifecycleState): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

/**
 * Maps a durable lifecycle state to the shared verification treatment where it
 * carries verdict meaning (verified/published/rejected/stale) and falls back to
 * a neutral badge for in-progress states. Label text is preserved so status
 * remains screen-reader legible and stable for tests. Shared by the library and
 * simulation detail views so the treatment stays identical everywhere.
 */
export function LifecycleBadge({ state }: { readonly state: SimulationLifecycleState }) {
  const label = stateLabel(state)
  if (state === 'verified') return <VerificationBadge state="verified" />
  if (state === 'published') return <VerificationBadge label={label} state="verified" />
  if (state === 'rejected') return <VerificationBadge label={label} state="rejected" />
  if (state === 'stale') return <VerificationBadge label={label} state="stale" />
  return <Badge variant="outline">{label}</Badge>
}
