import { useEffect, useRef } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export type OperationFeedback =
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'failure'; readonly message: string }
  | { readonly kind: 'success'; readonly message: string }

export function OperationFeedbackAlert({
  feedback,
  onRefresh,
}: {
  readonly feedback: OperationFeedback | null
  readonly onRefresh?: (() => void) | undefined
}) {
  const alertRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (feedback === null) return
    const frame = requestAnimationFrame(() => alertRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [feedback])

  if (feedback === null) return null
  const conflict = feedback.kind === 'conflict'
  return (
    <Alert
      ref={alertRef}
      tabIndex={-1}
      variant={feedback.kind === 'success' ? 'default' : 'destructive'}
    >
      <AlertTitle>
        {conflict
          ? 'This simulation changed on the server'
          : feedback.kind === 'success'
            ? 'Action completed'
            : 'Action could not be completed'}
      </AlertTitle>
      <AlertDescription className="grid gap-3">
        <span>{feedback.message}</span>
        {conflict && onRefresh !== undefined ? (
          <Button className="w-fit" onClick={onRefresh} variant="outline">
            Refresh authoritative version
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function feedbackForFailure(
  failure: { readonly kind: string },
  message: string,
): OperationFeedback {
  return failure.kind === 'conflict'
    ? {
        kind: 'conflict',
        message: 'Refresh before trying again so the next command uses the current revision.',
      }
    : { kind: 'failure', message }
}
