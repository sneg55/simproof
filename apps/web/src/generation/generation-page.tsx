import type { EducatorRuntimeConfig, SimulationDetail } from '@simproof/contracts'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import {
  browserEducatorGenerationApi,
  type EducatorApi,
  type EducatorGenerationApi,
} from '@/api/educator-api'
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
import { GenerationWorkspace } from '@/generation/generation-workspace'

type TargetState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready'
      readonly detail: SimulationDetail
      readonly runtime: EducatorRuntimeConfig
    }

const runIdSchema = z.uuid()

export function GenerationPage() {
  const { simulationId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { api, session } = useEducatorSession()
  const parsedRunId = runIdSchema.safeParse(searchParams.get('runId'))
  return (
    <GenerationPageView
      api={api}
      csrfToken={session.csrfToken}
      generationApi={browserEducatorGenerationApi}
      initialRunId={parsedRunId.success ? parsedRunId.data : undefined}
      key={parsedRunId.success ? parsedRunId.data : 'new-generation'}
      onRunAccepted={(runId) => setSearchParams({ runId }, { replace: true })}
      onRunCleared={() => setSearchParams({}, { replace: true })}
      simulationId={simulationId}
    />
  )
}

export function GenerationPageView({
  api,
  csrfToken,
  generationApi,
  initialRunId,
  onRunAccepted,
  onRunCleared,
  simulationId,
}: {
  readonly api: EducatorApi
  readonly csrfToken: string
  readonly generationApi: EducatorGenerationApi
  readonly initialRunId?: string | undefined
  readonly onRunAccepted?: ((runId: string) => void) | undefined
  readonly onRunCleared?: (() => void) | undefined
  readonly simulationId: string
}) {
  const [state, setState] = useState<TargetState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [activeRunId, setActiveRunId] = useState(initialRunId)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.simulationDetail(simulationId, controller.signal),
      api.runtimeConfig(controller.signal),
    ]).then(([detail, runtime]) => {
      if (controller.signal.aborted) return
      setState(
        detail.ok && runtime.ok
          ? { status: 'ready', detail: detail.value, runtime: runtime.value }
          : { status: 'error' },
      )
    })
    return () => controller.abort()
  }, [api, reloadKey, simulationId])

  if (state.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading generation workspace">
          Loading generation workspace
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading generation workspace</span>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Generation workspace unavailable">
          Generation workspace unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>This simulation version could not be opened</AlertTitle>
          <AlertDescription>
            Return to the library and choose an available educator-created draft.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  const { selectedVersion, simulation } = state.detail
  const generationUnavailable = generationUnavailableDescription(state.runtime.generation)
  if (activeRunId === undefined && generationUnavailable !== null) {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Generation unavailable">
          Generation is unavailable
        </PageStateHeading>
        <Alert>
          <AlertTitle>A new generation run cannot be started</AlertTitle>
          <AlertDescription>{generationUnavailable}</AlertDescription>
        </Alert>
        <div>
          <Button asChild variant="outline">
            <Link to={`/simulations/${simulation.id}`}>Back to simulation</Link>
          </Button>
        </div>
      </div>
    )
  }
  if (activeRunId === undefined && !selectedVersion.availableActions.includes('start-generation')) {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Generation unavailable">
          Generation is unavailable
        </PageStateHeading>
        <Alert>
          <AlertTitle>Generation is not available for this version</AlertTitle>
          <AlertDescription>
            Its lifecycle may have changed. Open the simulation again to see its current actions.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  const acceptRun = (runId: string) => {
    setActiveRunId(runId)
    onRunAccepted?.(runId)
  }
  const clearRun = () => {
    setActiveRunId(undefined)
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
    onRunCleared?.()
  }
  return (
    <>
      <DocumentTitle value={`Generate ${simulation.title} | SimProof`} />
      <div className="grid gap-8">
        <div>
          <Button asChild variant="ghost">
            <Link to={`/simulations/${simulation.id}`}>Back to simulation</Link>
          </Button>
        </div>
        <header className="grid max-w-prose gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Version {selectedVersion.summary.versionNumber}</Badge>
            {activeRunId === undefined ? (
              <Badge variant="outline">{lifecycleLabel(selectedVersion.summary.state)}</Badge>
            ) : null}
            {isDemoGeneration(state.runtime.generation) ? (
              <Badge variant="signal">Demo mode</Badge>
            ) : null}
          </div>
          <h1 className="text-page-title font-heading font-semibold tracking-tight">
            Generate {simulation.title}
          </h1>
          <p className="text-muted-foreground">
            Describe your teaching goal, review the structured concept SimProof builds from it, then
            let SimProof draft the simulation and check the physics in a sealed sandbox.
          </p>
        </header>
        {isDemoGeneration(state.runtime.generation) ? (
          <Alert className="max-w-prose">
            <AlertTitle>Demo mode: runs use a scripted provider</AlertTitle>
            <AlertDescription>
              Generation here is served by a bundled scripted provider instead of a live model, so
              it needs no credentials. The trusted verifier and policy are real, so a verified
              result is genuinely checked, but the model output is not from a live generation.
            </AlertDescription>
          </Alert>
        ) : null}
        <GenerationWorkspace
          api={generationApi}
          csrfToken={csrfToken}
          initialRunId={activeRunId}
          onRunAccepted={acceptRun}
          onRunCleared={clearRun}
          simulationId={simulation.id}
          target={{
            simulationTitle: simulation.title,
            simulationVersionId: selectedVersion.summary.id,
            expectedVersionRevision: selectedVersion.summary.revision,
          }}
        />
      </div>
    </>
  )
}

function lifecycleLabel(state: SimulationDetail['selectedVersion']['summary']['state']): string {
  return state.replace(/^./u, (character) => character.toUpperCase())
}
