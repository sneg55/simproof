import type { GenerationAccepted, SimulationDetail, VersionHistory } from '@simproof/contracts'
import { useState } from 'react'

import type { LibraryManagementApi } from '@/api/library-management-api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  feedbackForFailure,
  type OperationFeedback,
  OperationFeedbackAlert,
} from '@/management/operation-feedback'

export function VersionActions({
  api,
  csrfToken,
  detail,
  history,
  onDuplicated,
  onFeedback,
  onRefresh,
  onReverifyAccepted,
  onUpdated,
}: {
  readonly api: LibraryManagementApi
  readonly csrfToken: string
  readonly detail: SimulationDetail
  readonly history: VersionHistory
  readonly onFeedback: (feedback: OperationFeedback) => void
  readonly onRefresh: () => Promise<void>
  readonly onDuplicated: (detail: SimulationDetail) => void
  readonly onReverifyAccepted?: ((accepted: GenerationAccepted) => void) | undefined
  readonly onUpdated: (detail: SimulationDetail) => void
}) {
  const { simulation, selectedVersion } = detail
  const initialSourceId = selectedVersion.summary.id
  const [sourceVersionId, setSourceVersionId] = useState(initialSourceId)
  const [duplicateTitle, setDuplicateTitle] = useState(`${simulation.title} copy`)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateFeedback, setDuplicateFeedback] = useState<OperationFeedback | null>(null)
  const [pending, setPending] = useState(false)
  const source =
    history.versions.find(({ summary }) => summary.id === sourceVersionId) ?? selectedVersion
  const sourceActions = new Set(source.availableActions)

  const startBlankVersion = async () => {
    if (pending) return
    setPending(true)
    const result = await api.startBlankVersion(
      simulation.id,
      {
        sourceVersionId: source.summary.id,
        expectedSourceRevision: source.summary.revision,
      },
      csrfToken,
    )
    setPending(false)
    if (result.ok) {
      onUpdated(result.value)
      onFeedback({
        kind: 'success',
        message: 'A new blank version was started in this simulation.',
      })
    } else {
      onFeedback(feedbackForFailure(result.error, 'A blank version was not started.'))
    }
  }

  const duplicate = async () => {
    const title = duplicateTitle.trim()
    if (title === '' || title.length > 120 || pending) return
    setPending(true)
    const result = await api.duplicateSimulation(
      simulation.id,
      {
        sourceVersionId: source.summary.id,
        expectedSourceRevision: source.summary.revision,
        title,
      },
      csrfToken,
    )
    setPending(false)
    if (result.ok) {
      setDuplicateFeedback(null)
      setDuplicateOpen(false)
      onDuplicated(result.value)
      onFeedback({
        kind: 'success',
        message: 'The setup was duplicated into a new draft simulation.',
      })
    } else {
      setDuplicateFeedback(feedbackForFailure(result.error, 'The simulation was not duplicated.'))
    }
  }

  const reverify = async () => {
    if (pending || selectedVersion.summary.verification.status !== 'stale') return
    setPending(true)
    const summary = selectedVersion.summary
    const result = await api.reverifyVersion(
      summary.id,
      {
        expectedRevision: summary.revision,
        idempotencyKey: `reverify:${summary.id}:${summary.revision}`,
      },
      csrfToken,
    )
    setPending(false)
    if (result.ok) {
      onFeedback({
        kind: 'success',
        message: 'Reverification was accepted for the exact stale revision.',
      })
      onReverifyAccepted?.(result.value)
    } else {
      onFeedback(feedbackForFailure(result.error, 'Reverification was not accepted.'))
    }
  }

  return (
    <section aria-labelledby="version-actions-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-heading text-lg font-medium" id="version-actions-heading">
          Make another version
        </h2>
        <p className="text-pretty text-sm text-muted-foreground">
          Start a fresh blank version in this simulation, or duplicate a version into a separate new
          draft. Duplicating copies the editable setup, but never the verification results or
          published status.
        </p>
      </div>
      <Field className="max-w-sm">
        <FieldLabel htmlFor="source-version">Source version</FieldLabel>
        <Select onValueChange={setSourceVersionId} value={source.summary.id}>
          <SelectTrigger className="w-full" id="source-version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {history.versions.map(({ summary }) => (
              <SelectItem key={summary.id} value={summary.id}>
                Version {summary.versionNumber} · revision {summary.revision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>The actions below act on the version you select here.</FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-3">
        {sourceActions.has('start-blank-version') ? (
          <Button disabled={pending} onClick={() => void startBlankVersion()}>
            {pending ? 'Starting blank version…' : 'Start blank next version'}
          </Button>
        ) : null}
        {sourceActions.has('duplicate') ? (
          <Dialog
            open={duplicateOpen}
            onOpenChange={(open) => {
              setDuplicateOpen(open)
              if (!open) setDuplicateFeedback(null)
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">Duplicate selected version</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Duplicate into a new simulation</DialogTitle>
                <DialogDescription>
                  The editable setup from version {source.summary.versionNumber} becomes a new draft
                  in its own simulation. Its verification results and published status start fresh
                  and must be earned again.
                </DialogDescription>
              </DialogHeader>
              <OperationFeedbackAlert
                feedback={duplicateFeedback}
                onRefresh={() => void onRefresh()}
              />
              <FieldGroup>
                <Field data-invalid={duplicateTitle.trim().length > 120}>
                  <FieldLabel htmlFor="duplicate-title">New simulation title</FieldLabel>
                  <Input
                    id="duplicate-title"
                    maxLength={121}
                    onChange={(event) => setDuplicateTitle(event.currentTarget.value)}
                    value={duplicateTitle}
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={pending} variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={
                    duplicateTitle.trim() === '' || duplicateTitle.trim().length > 120 || pending
                  }
                  onClick={() => void duplicate()}
                >
                  {pending ? 'Duplicating…' : 'Create duplicate'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {selectedVersion.availableActions.includes('reverify') &&
        selectedVersion.summary.verification.status === 'stale' ? (
          <Button disabled={pending} onClick={() => void reverify()} variant="outline">
            {pending ? 'Requesting reverification…' : 'Reverify stale version'}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
