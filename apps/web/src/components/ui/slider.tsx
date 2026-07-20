import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A native range slider primitive with the signal accent. Lives in components/ui
 * so feature code composes it instead of hand-rolling an <input type="range">.
 */
export function Slider({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-2 w-full cursor-pointer accent-signal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      data-slot="slider"
      {...props}
      type="range"
    />
  )
}
