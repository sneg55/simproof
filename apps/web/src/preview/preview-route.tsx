import type { PreviewRequest, SimulationDetail } from '@simproof/contracts'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { browserEducatorApi } from '@/api/educator-api'
import { browserReportPreviewApi } from '@/api/report-preview-api'
import { PageStateHeading } from '@/app/page-state-heading'
import { useEducatorSession } from '@/auth/session-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type PreviewTarget, SimulationPreviewPageView } from '@/preview/preview-page'

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly detail: SimulationDetail }

export function SeedPreviewPage() {
  const { seedId = '' } = useParams()
  return <PreviewRoutePage kind="seed" resourceId={seedId} />
}

export function VersionPreviewPage() {
  const { simulationId = '' } = useParams()
  return <PreviewRoutePage kind="version" resourceId={simulationId} />
}

function PreviewRoutePage({
  kind,
  resourceId,
}: {
  readonly kind: 'seed' | 'version'
  readonly resourceId: string
}) {
  const { session } = useEducatorSession()
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const result =
      kind === 'seed'
        ? browserEducatorApi.seedDetail(resourceId, controller.signal)
        : browserEducatorApi.simulationDetail(resourceId, controller.signal)
    void result.then((response) => {
      if (!controller.signal.aborted) {
        setState(response.ok ? { status: 'ready', detail: response.value } : { status: 'error' })
      }
    })
    return () => controller.abort()
  }, [kind, resourceId])
  const prepared = useMemo(
    () => (state.status === 'ready' ? preparePreview(kind, resourceId, state.detail) : undefined),
    [kind, resourceId, state],
  )

  if (state.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading preview configuration">
          Loading preview configuration
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading preview configuration</span>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error' || prepared === undefined) {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Preview configuration unavailable">
          Preview configuration unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>Preview configuration unavailable</AlertTitle>
          <AlertDescription>
            This simulation does not expose a valid preview target.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  const seed = kind === 'seed'
  const backTo = seed ? '/' : `/simulations/${resourceId}`
  const backLabel = seed ? 'Back to library' : 'Back to simulation'
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to={backTo}>{backLabel}</Link>
        </Button>
        {seed && prepared.meta.canViewReport ? (
          <Button asChild variant="outline">
            <Link to={prepared.meta.reportTo}>View verification report</Link>
          </Button>
        ) : null}
      </div>
      {seed && prepared.meta.attribution !== null ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Bundled example · {prepared.meta.attribution}
        </p>
      ) : null}
      <SimulationPreviewPageView
        api={browserReportPreviewApi}
        csrfToken={session.csrfToken}
        request={prepared.request}
        target={prepared.target}
      />
    </div>
  )
}

function preparePreview(
  kind: 'seed' | 'version',
  resourceId: string,
  detail: SimulationDetail,
):
  | {
      readonly request: PreviewRequest
      readonly target: PreviewTarget
      readonly meta: {
        readonly attribution: string | null
        readonly canViewReport: boolean
        readonly reportTo: string
      }
    }
  | undefined {
  const { conceptSpec, summary } = detail.selectedVersion
  if (conceptSpec === null || !detail.selectedVersion.availableActions.includes('preview')) {
    return undefined
  }
  const source = detail.simulation.source
  const request: PreviewRequest =
    conceptSpec.domain === 'projectile'
      ? {
          domain: 'projectile',
          expectedVersionRevision: summary.revision,
          input: {
            initialSpeedMps: conceptSpec.parameters.initialSpeed.defaultValue,
            launchAngleDeg: conceptSpec.parameters.launchAngle.defaultValue,
          },
          sampleCount: 101,
        }
      : {
          domain: 'pendulum',
          expectedVersionRevision: summary.revision,
          input: {
            lengthM: conceptSpec.parameters.length.defaultValue,
            amplitudeDeg: conceptSpec.parameters.amplitude.defaultValue,
          },
          sampleCount: 201,
        }
  return {
    request,
    target:
      kind === 'seed'
        ? { kind: 'seed', seedId: resourceId }
        : { kind: 'version', versionId: summary.id },
    meta: {
      attribution:
        source.kind === 'seed'
          ? `${source.seed.contentLicense} · ${source.seed.attribution}`
          : null,
      canViewReport: detail.selectedVersion.availableActions.includes('view-report'),
      reportTo: kind === 'seed' ? `/seeds/${resourceId}/report` : `/versions/${summary.id}/report`,
    },
  }
}
