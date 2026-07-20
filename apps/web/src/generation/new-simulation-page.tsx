import type { EducatorRuntimeConfig, SimulationDetail } from '@simproof/contracts'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { EducatorApi, EducatorGenerationApi } from '@/api/educator-api'
import { browserEducatorGenerationApi } from '@/api/educator-api'
import {
  browserLibraryManagementApi,
  type LibraryManagementApi,
} from '@/api/library-management-api'
import { DocumentTitle } from '@/app/document-title'
import { PageStateHeading } from '@/app/page-state-heading'
import { useEducatorSession } from '@/auth/session-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  generationUnavailableDescription,
  isDemoGeneration,
} from '@/generation/generation-availability'
import { GenerationForm, type GenerationFormValue } from '@/generation/generation-form'
import {
  buildGenerationStartRequest,
  type GenerationTarget,
  generationStartFailureMessage,
} from '@/generation/generation-start'
import { feedbackForFailure } from '@/management/operation-feedback'

type RuntimeState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly generation: EducatorRuntimeConfig['generation'] }

export function NewSimulationPage() {
  const { api, session } = useEducatorSession()
  const navigate = useNavigate()
  return (
    <NewSimulationPageView
      csrfToken={session.csrfToken}
      generationApi={browserEducatorGenerationApi}
      managementApi={browserLibraryManagementApi}
      onRunStarted={(simulationId, runId) => {
        void navigate(`/simulations/${simulationId}/generate?runId=${encodeURIComponent(runId)}`, {
          replace: true,
        })
      }}
      runtimeApi={api}
    />
  )
}

export function NewSimulationPageView({
  csrfToken,
  generationApi,
  idempotencyKeyFactory = defaultIdempotencyKey,
  managementApi,
  onRunStarted,
  runtimeApi,
}: {
  readonly csrfToken: string
  readonly generationApi: EducatorGenerationApi
  readonly idempotencyKeyFactory?: () => string
  readonly managementApi: LibraryManagementApi
  readonly onRunStarted: (simulationId: string, runId: string) => void
  readonly runtimeApi: Pick<EducatorApi, 'runtimeConfig'>
}) {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const createdDraft = useRef<SimulationDetail | undefined>(undefined)
  const pendingIdentity = useRef<
    { readonly formKey: string; readonly idempotencyKey: string } | undefined
  >(undefined)

  useEffect(() => {
    const controller = new AbortController()
    void runtimeApi.runtimeConfig(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setRuntime(
        result.ok ? { status: 'ready', generation: result.value.generation } : { status: 'error' },
      )
    })
    return () => controller.abort()
  }, [runtimeApi])

  const start = async (form: GenerationFormValue) => {
    setSubmitting(true)
    setFailure(null)
    let draft = createdDraft.current
    if (draft === undefined) {
      const created = await managementApi.createDraft({ title: form.title ?? '' }, csrfToken)
      if (!created.ok) {
        setSubmitting(false)
        setFailure(
          feedbackForFailure(created.error, 'SimProof could not create the draft. Try again.')
            .message,
        )
        return
      }
      draft = created.value
      createdDraft.current = draft
    }
    const target: GenerationTarget = {
      simulationTitle: draft.simulation.title,
      simulationVersionId: draft.selectedVersion.summary.id,
      expectedVersionRevision: draft.selectedVersion.summary.revision,
    }
    const formKey = JSON.stringify([form.prompt, form.promptRetention])
    const idempotencyKey =
      pendingIdentity.current?.formKey === formKey
        ? pendingIdentity.current.idempotencyKey
        : idempotencyKeyFactory()
    pendingIdentity.current = { formKey, idempotencyKey }
    const started = await generationApi.startGeneration(
      buildGenerationStartRequest(target, form, idempotencyKey),
      csrfToken,
    )
    setSubmitting(false)
    if (!started.ok) {
      setFailure(generationStartFailureMessage(started.error))
      return
    }
    pendingIdentity.current = undefined
    onRunStarted(draft.simulation.id, started.value.runId)
  }

  if (runtime.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="New simulation">New simulation</PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading the new simulation workspace</span>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }
  if (runtime.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="New simulation unavailable">
          New simulation unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>The new simulation workspace could not be loaded</AlertTitle>
          <AlertDescription>Return to the library and try again.</AlertDescription>
        </Alert>
        <BackToLibrary />
      </div>
    )
  }

  const unavailable = generationUnavailableDescription(runtime.generation)
  if (unavailable !== null) {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Generation unavailable">
          Generation is unavailable
        </PageStateHeading>
        <Alert>
          <AlertTitle>A new simulation cannot be generated right now</AlertTitle>
          <AlertDescription>{unavailable}</AlertDescription>
        </Alert>
        <BackToLibrary />
      </div>
    )
  }

  return (
    <>
      <DocumentTitle value="New simulation | SimProof" />
      <div className="grid gap-8">
        <BackToLibrary />
        <header className="grid max-w-prose gap-3">
          <div className="flex flex-wrap gap-2">
            {isDemoGeneration(runtime.generation) ? (
              <Badge variant="signal">Demo mode</Badge>
            ) : null}
          </div>
          <h1 className="text-page-title font-heading font-semibold tracking-tight">
            New simulation
          </h1>
          <p className="text-muted-foreground">
            Name your simulation and describe the lesson. SimProof compiles a structured concept for
            your review, then drafts the simulation and checks the physics in a sealed sandbox.
          </p>
        </header>
        {isDemoGeneration(runtime.generation) ? (
          <Alert className="max-w-prose">
            <AlertTitle>Demo mode: runs use a scripted provider</AlertTitle>
            <AlertDescription>
              Generation here is served by a bundled scripted provider instead of a live model, so
              it needs no credentials. The trusted verifier and policy are real, so a verified
              result is genuinely checked, but the model output is not from a live generation.
            </AlertDescription>
          </Alert>
        ) : null}
        <GenerationForm
          collectTitle
          failure={failure}
          onStart={(form) => void start(form)}
          submitting={submitting}
        />
      </div>
    </>
  )
}

function BackToLibrary() {
  return (
    <div>
      <Button asChild variant="ghost">
        <Link to="/">Back to library</Link>
      </Button>
    </div>
  )
}

function defaultIdempotencyKey(): string {
  return `web:${crypto.randomUUID()}`
}
