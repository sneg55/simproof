import type { SimulationDetail } from '@simproof/contracts'
import { useState } from 'react'

import type { LibraryManagementApi } from '@/api/library-management-api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
import { browserDownloadPort, type DownloadPort } from '@/management/download-port'
import {
  feedbackForFailure,
  type OperationFeedback,
  OperationFeedbackAlert,
} from '@/management/operation-feedback'
import {
  confirmationPassword,
  PasswordConfirmationField,
  passwordConfirmationFailure,
  passwordConfirmationInstructions,
} from '@/management/password-confirmation'
import { SimulationExportAction } from '@/management/simulation-export-action'

export function PortabilityActions({
  api,
  csrfToken,
  detail,
  download = browserDownloadPort,
  onArchived,
  onDeleted,
  onFeedback,
  onRefresh,
  passwordConfirmationRequired,
}: {
  readonly api: LibraryManagementApi
  readonly csrfToken: string
  readonly detail: SimulationDetail
  readonly download?: DownloadPort | undefined
  readonly onArchived: (detail: SimulationDetail) => void
  readonly onDeleted: (title: string) => void
  readonly onFeedback: (feedback: OperationFeedback) => void
  readonly onRefresh: () => Promise<void>
  readonly passwordConfirmationRequired: boolean
}) {
  const { simulation, selectedVersion } = detail
  const actions = new Set(selectedVersion.availableActions)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteFeedback, setDeleteFeedback] = useState<OperationFeedback | null>(null)
  const [pending, setPending] = useState(false)

  const changeDeleteOpen = (open: boolean) => {
    setDeleteOpen(open)
    if (!open) {
      setDeletePassword('')
      setDeleteConfirmation('')
      setDeleteFeedback(null)
    }
  }

  const archive = async () => {
    if (pending) return
    setPending(true)
    const result = await api.archiveVersion(
      selectedVersion.summary.id,
      { expectedRevision: selectedVersion.summary.revision },
      csrfToken,
    )
    setPending(false)
    if (result.ok) {
      onArchived(result.value)
    } else {
      onFeedback(feedbackForFailure(result.error, 'The version was not archived.'))
    }
  }

  const deleteSimulation = async () => {
    if (
      (passwordConfirmationRequired && deletePassword === '') ||
      deleteConfirmation !== 'delete' ||
      pending
    )
      return
    setPending(true)
    const result = await api.deleteSimulation(
      simulation.id,
      confirmationPassword(passwordConfirmationRequired, deletePassword),
      csrfToken,
    )
    setDeletePassword('')
    setPending(false)
    if (result.ok) {
      setDeleteFeedback(null)
      setDeleteConfirmation('')
      setDeleteOpen(false)
      onFeedback({
        kind: 'success',
        message: 'The simulation and its files were deleted.',
      })
      onDeleted(simulation.title)
    } else {
      setDeleteFeedback(
        feedbackForFailure(
          result.error,
          passwordConfirmationFailure(
            passwordConfirmationRequired,
            'The simulation was not deleted.',
            'The simulation was not deleted. Confirm the current password.',
          ),
        ),
      )
    }
  }

  return (
    <section aria-labelledby="portability-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-heading text-lg font-medium" id="portability-heading">
          Export, archive, or delete
        </h2>
        <p className="text-pretty text-sm text-muted-foreground">
          Download this simulation to share it, archive a version to retire it, or delete the whole
          simulation. Archiving cannot be undone here, and deleting is permanent.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {actions.has('export') ? (
          <SimulationExportAction
            api={api}
            csrfToken={csrfToken}
            download={download}
            onFeedback={onFeedback}
            onRefresh={onRefresh}
            passwordConfirmationRequired={passwordConfirmationRequired}
            simulation={simulation}
          />
        ) : null}
        {actions.has('archive') ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Archive this version</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Archive {simulation.title} version {selectedVersion.summary.versionNumber}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Archiving retires this version. You can still export it or duplicate it into a new
                  draft, but it cannot be un-archived here.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep version active</AlertDialogCancel>
                <AlertDialogAction onClick={() => void archive()}>
                  Confirm archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {actions.has('delete') ? (
          <Dialog open={deleteOpen} onOpenChange={changeDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">Delete simulation</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {simulation.title}?</DialogTitle>
                <DialogDescription>
                  This permanently deletes every version of this simulation, including archived
                  ones, and all of its files.{' '}
                  {passwordConfirmationInstructions(passwordConfirmationRequired, 'delete')}
                </DialogDescription>
              </DialogHeader>
              <OperationFeedbackAlert
                feedback={deleteFeedback}
                onRefresh={() => void onRefresh()}
              />
              <FieldGroup>
                <PasswordConfirmationField
                  id="delete-password"
                  onChange={setDeletePassword}
                  required={passwordConfirmationRequired}
                  value={deletePassword}
                />
                <Field>
                  <FieldLabel htmlFor="delete-confirmation">Type delete</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="delete-confirmation"
                    onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
                    value={deleteConfirmation}
                  />
                  <FieldDescription>The confirmation is case-sensitive.</FieldDescription>
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
                    (passwordConfirmationRequired && deletePassword === '') ||
                    deleteConfirmation !== 'delete' ||
                    pending
                  }
                  onClick={() => void deleteSimulation()}
                  variant="destructive"
                >
                  {pending ? 'Deleting simulation…' : 'Permanently delete simulation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </section>
  )
}
