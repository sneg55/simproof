import type { EducatorRuntimeConfig, SimulationDetail } from '@simproof/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { EducatorApi } from '@/api/educator-api'
import { DocumentTitle } from '@/app/document-title'
import { PageStateHeading } from '@/app/page-state-heading'
import { useEducatorSession } from '@/auth/session-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { generationUnavailableDescription } from '@/generation/generation-availability'
import { LifecycleBadge } from '@/library/lifecycle-badge'
import {
  type PublicationSuccessNotice,
  publicationNoticeFromRouteState,
} from '@/library/simulation-route-state'

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready'
      readonly detail: SimulationDetail
      readonly runtime: EducatorRuntimeConfig
    }

export function SimulationDetailPage() {
  const { simulationId } = useParams()
  const { api } = useEducatorSession()
  const location = useLocation()
  const navigate = useNavigate()
  const publicationNotice = useMemo(
    () => publicationNoticeFromRouteState(location.state),
    [location.state],
  )
  useEffect(() => {
    if (publicationNotice === undefined) return
    void navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, navigate, publicationNotice])
  return (
    <SimulationDetailPageView
      key={simulationId}
      api={api}
      simulationId={simulationId ?? ''}
      {...(publicationNotice === undefined ? {} : { publicationNotice })}
    />
  )
}

export function SimulationDetailPageView({
  api,
  simulationId,
  publicationNotice,
}: {
  readonly api: EducatorApi
  readonly simulationId?: string
  readonly publicationNotice?: PublicationSuccessNotice
}) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [initialPublicationNotice] = useState(publicationNotice)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    const detailPromise = api.simulationDetail(simulationId ?? '', controller.signal)
    void Promise.all([detailPromise, api.runtimeConfig(controller.signal)]).then(
      ([detail, runtime]) => {
        if (controller.signal.aborted) return
        setState(
          detail.ok && runtime.ok
            ? { status: 'ready', detail: detail.value, runtime: runtime.value }
            : { status: 'error' },
        )
      },
    )
    return () => controller.abort()
  }, [api, simulationId])
  useEffect(() => {
    if (state.status !== 'ready' || initialPublicationNotice === undefined) return
    const frame = requestAnimationFrame(() => headingRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [initialPublicationNotice, state.status])

  if (state.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading simulation detail">
          Loading simulation detail
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading simulation detail</span>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Simulation unavailable">
          Simulation unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>This simulation could not be opened</AlertTitle>
          <AlertDescription>Return to the library and choose another simulation.</AlertDescription>
        </Alert>
      </div>
    )
  }
  const { simulation, selectedVersion } = state.detail
  return (
    <>
      <DocumentTitle value={`${simulation.title} | SimProof`} />
      <div className="grid gap-6">
        <div>
          <Button asChild variant="ghost">
            <Link to="/">Back to library</Link>
          </Button>
        </div>
        {initialPublicationNotice === undefined ? null : (
          <Alert>
            <AlertTitle>Version {initialPublicationNotice.versionNumber} is published</AlertTitle>
            <AlertDescription>
              This exact verified version is now the published version of your simulation. Open the
              accessible preview to show it to students, or export a copy from Manage to share it.
            </AlertDescription>
          </Alert>
        )}
        <header className="grid max-w-prose gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Version {selectedVersion.summary.versionNumber}</Badge>
            <LifecycleBadge state={selectedVersion.summary.state} />
          </div>
          <h1
            ref={headingRef}
            tabIndex={initialPublicationNotice === undefined ? undefined : -1}
            className="text-page-title font-heading font-semibold tracking-tight"
          >
            {simulation.title}
          </h1>
          <p className="text-muted-foreground">
            {simulation.source.kind === 'seed'
              ? simulation.source.seed.description
              : 'Educator-created simulation stored on this server.'}
          </p>
        </header>
        <Card className="max-w-prose">
          <CardHeader>
            <CardTitle>Simulation details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {selectedVersion.summary.domain === null ? null : (
              <p>Domain: {selectedVersion.summary.domain}</p>
            )}
            <p>Verification: {verificationLabel(selectedVersion.summary.verification)}</p>
            {simulation.source.kind === 'seed' ? (
              <p className="text-muted-foreground">
                {simulation.source.seed.contentLicense} · {simulation.source.seed.attribution}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <DetailActions
          actions={selectedVersion.availableActions}
          generation={state.runtime.generation}
          simulationId={simulation.id}
          versionId={selectedVersion.summary.id}
        />
      </div>
    </>
  )
}

function DetailActions({
  actions,
  generation,
  simulationId,
  versionId,
}: {
  readonly actions: SimulationDetail['selectedVersion']['availableActions']
  readonly generation: EducatorRuntimeConfig['generation']
  readonly simulationId: string
  readonly versionId: string
}) {
  const available = new Set(actions)
  const generationUnavailable = generationUnavailableDescription(generation)
  return (
    <Card className="max-w-prose">
      <CardHeader>
        <CardTitle>Available actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {available.has('publish') ? (
          <Button asChild>
            <Link to={`/versions/${versionId}/report`}>Review and publish</Link>
          </Button>
        ) : null}
        {available.has('preview') ? (
          <Button asChild variant={available.has('publish') ? 'outline' : 'default'}>
            <Link to={`/simulations/${simulationId}/preview`}>Open accessible preview</Link>
          </Button>
        ) : null}
        {available.has('view-report') && !available.has('publish') ? (
          <Button asChild variant="outline">
            <Link to={`/versions/${versionId}/report`}>View verification report</Link>
          </Button>
        ) : null}
        {available.has('start-generation') ? (
          generationUnavailable === null ? (
            <Button asChild>
              <Link to={`/simulations/${simulationId}/generate`}>Generate this draft</Link>
            </Button>
          ) : (
            <div className="grid gap-1">
              <Button disabled>Generation unavailable</Button>
              <p className="max-w-sm text-sm text-muted-foreground">{generationUnavailable}</p>
            </div>
          )
        ) : null}
        <Button asChild variant="outline">
          <Link to={`/simulations/${simulationId}/manage`}>Manage versions and export</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function verificationLabel(
  verification: SimulationDetail['selectedVersion']['summary']['verification'],
): string {
  if (verification.status === 'none') return 'Not yet verified'
  if (verification.status === 'stale') return 'Needs re-verification'
  if (verification.verdict === 'verified') return 'Verified'
  if (verification.verdict === 'rejected') return 'Rejected by scientific checks'
  return 'Outside the trusted policy scope'
}
