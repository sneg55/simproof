import type {
  ConceptReviewDecision,
  GenerationAccepted,
  GenerationStatus,
} from '@simproof/contracts'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { EducatorGenerationApi } from '@/api/educator-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConceptReviewPanel } from '@/generation/concept-review-panel'
import { GenerationRunCard } from '@/generation/generation-run-card'
import { generationStatePresentation } from '@/generation/generation-state'

export function GenerationRun({
  accepted,
  api,
  csrfToken,
  onRestart,
  pollInterval = 1_200,
  simulationId,
}: {
  readonly accepted: GenerationAccepted
  readonly api: EducatorGenerationApi
  readonly csrfToken: string
  readonly onRestart: () => void
  readonly pollInterval?: number
  readonly simulationId: string
}) {
  const [status, setStatus] = useState<GenerationStatus>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [requestFailed, setRequestFailed] = useState(false)
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [cancellationBusy, setCancellationBusy] = useState(false)
  const [cancellationRequested, setCancellationRequested] = useState(false)
  const state = status?.state ?? accepted.state
  const presentation = generationStatePresentation(state)

  useEffect(() => {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const result = await api.generationStatus(accepted.runId, controller.signal)
      if (controller.signal.aborted) return
      if (!result.ok) {
        setRequestFailed(true)
        return
      }
      setRequestFailed(false)
      setStatus(result.value)
      const next = generationStatePresentation(result.value.state)
      if (!next.terminal && result.value.state !== 'awaiting_confirmation') {
        timeout = setTimeout(() => void poll(), pollInterval)
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }, [accepted.runId, api, pollInterval, refreshKey])

  const decideConcept = async (decision: ConceptReviewDecision) => {
    setDecisionBusy(true)
    const result = await api.decideConcept(accepted.runId, decision, csrfToken)
    setDecisionBusy(false)
    if (!result.ok) {
      setRequestFailed(true)
      return
    }
    setRequestFailed(false)
    setStatus(result.value)
    setRefreshKey((key) => key + 1)
  }

  const cancel = async () => {
    const revision = status?.revision ?? accepted.revision
    setCancellationBusy(true)
    const result = await api.cancelGeneration(
      accepted.runId,
      { expectedRunRevision: revision },
      csrfToken,
    )
    setCancellationBusy(false)
    if (!result.ok) {
      setRequestFailed(true)
      return
    }
    setCancellationRequested(true)
    setRefreshKey((key) => key + 1)
  }

  return (
    <GenerationRunContent
      accepted={accepted}
      cancellationBusy={cancellationBusy}
      cancellationRequested={cancellationRequested}
      decisionBusy={decisionBusy}
      onCancel={() => void cancel()}
      onDecision={(decision) => void decideConcept(decision)}
      onRefresh={() => setRefreshKey((key) => key + 1)}
      onRestart={onRestart}
      presentation={presentation}
      requestFailed={requestFailed}
      simulationId={simulationId}
      status={status}
    />
  )
}

function GenerationRunContent({
  accepted,
  cancellationBusy,
  cancellationRequested,
  decisionBusy,
  onCancel,
  onDecision,
  onRefresh,
  onRestart,
  presentation,
  requestFailed,
  simulationId,
  status,
}: {
  readonly accepted: GenerationAccepted
  readonly cancellationBusy: boolean
  readonly cancellationRequested: boolean
  readonly decisionBusy: boolean
  readonly onCancel: () => void
  readonly onDecision: (decision: ConceptReviewDecision) => void
  readonly onRefresh: () => void
  readonly onRestart: () => void
  readonly presentation: ReturnType<typeof generationStatePresentation>
  readonly requestFailed: boolean
  readonly simulationId: string
  readonly status: GenerationStatus | undefined
}) {
  const pendingReview =
    status?.state === 'awaiting_confirmation' && status.conceptReview.status === 'pending'
      ? { review: status.conceptReview, runRevision: status.revision }
      : undefined

  return (
    <div className="grid gap-6">
      <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {cancellationRequested ? 'Cancellation requested. ' : ''}
        Generation status: {presentation.label}. {presentation.description}
      </div>
      <GenerationRunCard
        accepted={accepted}
        cancellationBusy={cancellationBusy}
        cancellationRequested={cancellationRequested}
        onCancel={onCancel}
        onRefresh={onRefresh}
        onRestart={onRestart}
        presentation={presentation}
        requestFailed={requestFailed}
        status={status}
      />
      {pendingReview !== undefined ? (
        <ConceptReviewPanel
          busy={decisionBusy}
          onDecision={onDecision}
          review={pendingReview.review}
          runRevision={pendingReview.runRevision}
        />
      ) : null}
      {presentation.terminal ? (
        <TerminalGuidance onRestart={onRestart} simulationId={simulationId} status={status} />
      ) : null}
    </div>
  )
}

function TerminalGuidance({
  onRestart,
  simulationId,
  status,
}: {
  readonly onRestart: () => void
  readonly simulationId: string
  readonly status: GenerationStatus | undefined
}) {
  if (status === undefined || status.error?.retryable === true) return null
  if (status.state === 'verified') {
    return (
      <Alert>
        <AlertTitle>Run complete</AlertTitle>
        <AlertDescription className="grid gap-3">
          <p>
            The draft passed every scientific check. Preview it to see what learners get, then
            review the verification report to publish this version.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to={`/versions/${status.simulationVersionId}/report`}>Review and publish</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/simulations/${simulationId}/preview`}>Open accessible preview</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/simulations/${simulationId}`}>Open simulation</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  if (status.state === 'rejected') {
    return (
      <Alert>
        <AlertTitle>Run complete</AlertTitle>
        <AlertDescription className="grid gap-3">
          <p>Review the verification findings before changing the lesson concept.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link to={`/versions/${status.simulationVersionId}/report`}>
                View verification report
              </Link>
            </Button>
            <Button onClick={onRestart} variant="outline">
              Revise prompt and start again
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <AlertTitle>Run complete</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>
          {status.state === 'cancelled'
            ? 'This run was cancelled before it finished.'
            : 'This run ended for the operational reason shown in its durable status.'}
        </p>
        {status.state === 'cancelled' ? (
          <div className="flex flex-wrap gap-3">
            <Button onClick={onRestart} variant="outline">
              Revise prompt and start again
            </Button>
            <Button asChild variant="outline">
              <Link to={`/simulations/${simulationId}`}>Back to simulation</Link>
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
