import { CircleSlash, CircleX, Clock, ShieldCheck, TriangleAlert } from 'lucide-react'
import type * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type VerificationState =
  | 'verified'
  | 'active'
  | 'rejected'
  | 'inapplicable'
  | 'stale'
  | 'pending'

interface StateConfig {
  readonly variant: 'success' | 'destructive' | 'warning' | 'secondary'
  readonly Icon: React.ComponentType<{ readonly 'aria-hidden'?: boolean }>
  readonly label: string
}

function resolveState(state: VerificationState): StateConfig {
  switch (state) {
    case 'verified':
      return { variant: 'success', Icon: ShieldCheck, label: 'Verified' }
    case 'active':
      return { variant: 'success', Icon: ShieldCheck, label: 'Active verification' }
    case 'rejected':
      return { variant: 'destructive', Icon: CircleX, label: 'Rejected' }
    // A distinct, neutral outcome: the policy did not apply. Must never be shown
    // as a scientific rejection (PRODUCT_SPEC forbids that mislabeling).
    case 'inapplicable':
      return { variant: 'secondary', Icon: CircleSlash, label: 'Inapplicable' }
    case 'stale':
      return { variant: 'warning', Icon: TriangleAlert, label: 'Stale' }
    case 'pending':
      return { variant: 'warning', Icon: Clock, label: 'Pending' }
  }
}

/**
 * The single, consistent way to show a verification verdict across the app.
 * Never color-only: always renders the state icon alongside its label so the
 * meaning survives without color (WCAG). `label` overrides the default text
 * without changing the visual treatment.
 */
export function VerificationBadge({
  state,
  label,
  className,
  ...props
}: {
  readonly state: VerificationState
  readonly label?: string
  readonly className?: string
} & Omit<React.ComponentProps<typeof Badge>, 'variant'>) {
  const { variant, Icon, label: defaultLabel } = resolveState(state)
  return (
    <Badge className={cn('gap-1', className)} variant={variant} {...props}>
      <Icon aria-hidden />
      {label ?? defaultLabel}
    </Badge>
  )
}
