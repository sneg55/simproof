import type { SimulationDetail } from '@simproof/contracts'
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
import type { DownloadPort } from '@/management/download-port'
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

export function SimulationExportAction({
  api,
  csrfToken,
  download,
  onFeedback,
  onRefresh,
  passwordConfirmationRequired,
  simulation,
}: {
  readonly api: LibraryManagementApi
  readonly csrfToken: string
  readonly download: DownloadPort
  readonly onFeedback: (feedback: OperationFeedback) => void
  readonly onRefresh: () => Promise<void>
  readonly passwordConfirmationRequired: boolean
  readonly simulation: SimulationDetail['simulation']
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null)
  const [pending, setPending] = useState(false)

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setPassword('')
      setFeedback(null)
    }
  }
  const exportSelected = async () => {
    if ((passwordConfirmationRequired && password === '') || pending) return
    setPending(true)
    const result = await api.exportSimulation(
      simulation.id,
      confirmationPassword(passwordConfirmationRequired, password),
      csrfToken,
    )
    setPassword('')
    setPending(false)
    if (!result.ok) {
      setFeedback(
        feedbackForFailure(
          result.error,
          passwordConfirmationFailure(
            passwordConfirmationRequired,
            'The export was not created.',
            'The export was not created. Confirm the current password.',
          ),
        ),
      )
      return
    }
    setFeedback(null)
    setOpen(false)
    download.save({
      content: JSON.stringify(result.value, null, 2),
      fileName: `simproof-${simulation.id}.json`,
      mediaType: 'application/json',
    })
    onFeedback({ kind: 'success', message: 'The selected simulation export was downloaded.' })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Export selected simulation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm JSON export</DialogTitle>
          <DialogDescription>
            {passwordConfirmationInstructions(passwordConfirmationRequired, 'export')}
          </DialogDescription>
        </DialogHeader>
        <OperationFeedbackAlert feedback={feedback} onRefresh={() => void onRefresh()} />
        <PasswordConfirmationField
          id="export-password"
          onChange={setPassword}
          required={passwordConfirmationRequired}
          value={password}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={pending} variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={(passwordConfirmationRequired && password === '') || pending}
            onClick={() => void exportSelected()}
          >
            {pending ? 'Preparing export…' : 'Download JSON export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
