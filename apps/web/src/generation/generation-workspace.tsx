import type { GenerationAccepted } from '@simproof/contracts'
import { useRef, useState } from 'react'

import type { EducatorGenerationApi } from '@/api/educator-api'
import type { ApiFailure } from '@/api/http-client'
import { GenerationForm, type GenerationFormValue } from '@/generation/generation-form'
import { GenerationRun } from '@/generation/generation-run'
import {
  buildGenerationStartRequest,
  type GenerationTarget,
  generationStartFailureMessage,
} from '@/generation/generation-start'

export type { GenerationTarget } from '@/generation/generation-start'

export function GenerationWorkspace({
  api,
  csrfToken,
  idempotencyKeyFactory = defaultIdempotencyKey,
  initialRunId,
  onRunAccepted,
  onRunCleared,
  simulationId,
  target,
}: {
  readonly api: EducatorGenerationApi
  readonly csrfToken: string
  readonly idempotencyKeyFactory?: () => string
  readonly initialRunId?: string | undefined
  readonly onRunAccepted?: ((runId: string) => void) | undefined
  readonly onRunCleared?: (() => void) | undefined
  readonly simulationId: string
  readonly target: GenerationTarget
}) {
  const [accepted, setAccepted] = useState<GenerationAccepted | undefined>(() =>
    initialRunId === undefined
      ? undefined
      : { runId: initialRunId, created: false, state: 'queued', revision: 0 },
  )
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const pendingIdentity = useRef<
    { readonly formKey: string; readonly idempotencyKey: string } | undefined
  >(undefined)

  const start = async (form: GenerationFormValue) => {
    setSubmitting(true)
    setFailure(null)
    const formKey = JSON.stringify([form.prompt, form.promptRetention])
    const idempotencyKey =
      pendingIdentity.current?.formKey === formKey
        ? pendingIdentity.current.idempotencyKey
        : idempotencyKeyFactory()
    pendingIdentity.current = { formKey, idempotencyKey }
    const request = buildGenerationStartRequest(target, form, idempotencyKey)
    const result = await api.startGeneration(request, csrfToken)
    setSubmitting(false)
    if (!result.ok) {
      setFailure(result.error)
      return
    }
    pendingIdentity.current = undefined
    setAccepted(result.value)
    onRunAccepted?.(result.value.runId)
  }

  const restart = () => {
    pendingIdentity.current = undefined
    setAccepted(undefined)
    onRunCleared?.()
  }

  return accepted === undefined ? (
    <GenerationForm
      failure={failure === null ? null : generationStartFailureMessage(failure)}
      onStart={(form) => void start(form)}
      submitting={submitting}
    />
  ) : (
    <GenerationRun
      accepted={accepted}
      api={api}
      csrfToken={csrfToken}
      onRestart={restart}
      simulationId={simulationId}
    />
  )
}

function defaultIdempotencyKey(): string {
  return `web:${crypto.randomUUID()}`
}

export { GenerationRun }
