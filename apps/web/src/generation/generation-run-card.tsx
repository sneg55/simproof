import type { GenerationAccepted, GenerationStatus } from '@simproof/contracts'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GenerationPipeline } from '@/generation/generation-pipeline'
import type { GenerationStatePresentation } from '@/generation/generation-state'

function toneVariant(
  tone: GenerationStatePresentation['tone'],
): 'success' | 'destructive' | 'secondary' {
  if (tone === 'positive') return 'success'
  if (tone === 'negative') return 'destructive'
  return 'secondary'
}

const errorGuidance: Record<NonNullable<GenerationStatus['error']>['category'], string> = {
  authentication: 'Ask an administrator to check the generation provider credentials.',
  quota: 'Ask an administrator to review the generation provider quota.',
  transient: 'The provider had a temporary problem. You can start a new run.',
  'malformed-response': 'The provider returned output that could not pass strict validation.',
  cancellation: 'The run ended after a cancellation request.',
  budget: 'Increase the configured budget only after reviewing the run usage.',
  runner: 'The sealed sandbox could not run the draft safely.',
  'verifier-rejection': 'Review the retained scientific findings before revising the concept.',
  invariant:
    'SimProof stopped this run after an internal error. Start a new run, and share the run reference below with your administrator if it keeps happening.',
}

export function GenerationRunCard({
  accepted,
  cancellationBusy,
  cancellationRequested,
  onCancel,
  onRefresh,
  onRestart,
  presentation,
  requestFailed,
  status,
}: {
  readonly accepted: GenerationAccepted
  readonly cancellationBusy: boolean
  readonly cancellationRequested: boolean
  readonly onCancel: () => void
  readonly onRefresh: () => void
  readonly onRestart: () => void
  readonly presentation: GenerationStatePresentation
  readonly requestFailed: boolean
  readonly status: GenerationStatus | undefined
}) {
  const canCancel =
    !presentation.terminal && !cancellationRequested && (status !== undefined || accepted.created)
  const retryable = presentation.terminal && status?.error?.retryable === true
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={toneVariant(presentation.tone)}>{presentation.label}</Badge>
          <span className="text-xs text-muted-foreground" data-dynamic-number>
            Run revision {status?.revision ?? accepted.revision}
          </span>
        </div>
        <CardTitle>
          <h2>Generation progress</h2>
        </CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">{presentation.description}</p>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div aria-label="Current generation step" className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current step
          </p>
          <GenerationPipeline state={presentation.state} terminal={presentation.terminal} />
        </div>
        {status === undefined ? (
          <p className="text-sm text-muted-foreground">
            The server accepted this run. Waiting for the first durable status update.
          </p>
        ) : (
          <GenerationEvidence status={status} />
        )}
        <RunFeedback cancellationRequested={cancellationRequested} requestFailed={requestFailed} />
        <RunActions
          canCancel={canCancel}
          cancellationBusy={cancellationBusy}
          onCancel={onCancel}
          onRefresh={onRefresh}
          onRestart={onRestart}
          requestFailed={requestFailed}
          retryable={retryable}
        />
      </CardContent>
    </Card>
  )
}

function GenerationEvidence({ status }: { readonly status: GenerationStatus }) {
  return (
    <div className="grid gap-4">
      {status.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>{status.error.category.replace('-', ' ')} failure</AlertTitle>
          <AlertDescription>
            {errorGuidance[status.error.category]}
            <span className="mt-2 block font-mono text-xs">
              Error reference: {status.error.stableErrorId}
            </span>
          </AlertDescription>
        </Alert>
      )}
      {status.attempts.length === 0 ? null : (
        <div>
          <h3 className="text-sm font-medium">Attempt history</h3>
          <ol className="mt-2 grid gap-2">
            {status.attempts.map((attempt) => (
              <li className="rounded-md border p-3 text-sm" key={attempt.attemptNumber}>
                <span className="font-medium">
                  Attempt {attempt.attemptNumber}: {attempt.kind}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {attempt.outcome.replaceAll('_', ' ')}
                </span>
                {attempt.stableErrorId === null ? null : (
                  <span className="mt-1 block font-mono text-xs">
                    Error reference: {attempt.stableErrorId}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function RunFeedback({
  cancellationRequested,
  requestFailed,
}: {
  readonly cancellationRequested: boolean
  readonly requestFailed: boolean
}) {
  return (
    <>
      {requestFailed ? (
        <Alert variant="destructive">
          <AlertTitle>The latest generation update is unavailable</AlertTitle>
          <AlertDescription>
            The run remains on the server. Check its status again without starting a duplicate.
          </AlertDescription>
        </Alert>
      ) : null}
      {cancellationRequested ? (
        <Alert>
          <AlertTitle>Cancellation requested</AlertTitle>
          <AlertDescription>
            SimProof is stopping the active stage and will report a cancelled terminal state.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

function RunActions({
  canCancel,
  cancellationBusy,
  onCancel,
  onRefresh,
  onRestart,
  requestFailed,
  retryable,
}: {
  readonly canCancel: boolean
  readonly cancellationBusy: boolean
  readonly onCancel: () => void
  readonly onRefresh: () => void
  readonly onRestart: () => void
  readonly requestFailed: boolean
  readonly retryable: boolean
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {requestFailed ? (
        <Button onClick={onRefresh} variant="outline">
          Check status again
        </Button>
      ) : null}
      {canCancel ? (
        <Button disabled={cancellationBusy} onClick={onCancel} variant="destructive">
          {cancellationBusy ? 'Requesting cancellation…' : 'Cancel generation'}
        </Button>
      ) : null}
      {retryable ? <Button onClick={onRestart}>Start a new run</Button> : null}
    </div>
  )
}
