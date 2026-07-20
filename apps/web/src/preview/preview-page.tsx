import type { NormalizedPreview, PreviewRequest } from '@simproof/contracts'
import { useEffect, useState } from 'react'

import type { ReportPreviewApi } from '@/api/report-preview-api'
import { DocumentTitle } from '@/app/document-title'
import { PageStateHeading } from '@/app/page-state-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ParameterControls } from '@/preview/parameter-controls'
import { SimulationPreview } from '@/preview/simulation-preview'

export type PreviewTarget =
  | { readonly kind: 'seed'; readonly seedId: string }
  | { readonly kind: 'version'; readonly versionId: string }

type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready'
      readonly preview: NormalizedPreview
      readonly refresh: 'idle' | 'busy' | 'success' | 'failure'
    }

export function SimulationPreviewPageView({
  api,
  csrfToken,
  request,
  target,
}: {
  readonly api: ReportPreviewApi
  readonly csrfToken: string
  readonly request: PreviewRequest
  readonly target: PreviewTarget
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const result =
      target.kind === 'seed'
        ? api.seedPreview(target.seedId, request, csrfToken, controller.signal)
        : api.versionPreview(target.versionId, request, csrfToken, controller.signal)
    void result.then((response) => {
      if (!controller.signal.aborted) {
        setState(
          response.ok && previewMatchesRequest(response.value, request)
            ? { status: 'ready', preview: response.value, refresh: 'idle' }
            : { status: 'error' },
        )
      }
    })
    return () => controller.abort()
  }, [api, csrfToken, request, target])

  if (state.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading simulation preview">
          Loading simulation preview
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading simulation preview</span>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Simulation preview unavailable">
          Simulation preview unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>Preview unavailable</AlertTitle>
          <AlertDescription>
            The server did not return valid normalized preview data.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  const apply = async (nextRequest: PreviewRequest): Promise<'success' | 'failure'> => {
    setState((current) => (current.status === 'ready' ? { ...current, refresh: 'busy' } : current))
    const response =
      target.kind === 'seed'
        ? await api.seedPreview(target.seedId, nextRequest, csrfToken)
        : await api.versionPreview(target.versionId, nextRequest, csrfToken)
    if (!response.ok || !previewMatchesRequest(response.value, nextRequest)) {
      setState((current) =>
        current.status === 'ready' ? { ...current, refresh: 'failure' } : current,
      )
      return 'failure'
    }
    setState({ status: 'ready', preview: response.value, refresh: 'success' })
    return 'success'
  }
  return (
    <>
      <DocumentTitle value={`${state.preview.conceptSpec.title} preview | SimProof`} />
      <div className="mb-6 grid gap-4">
        <ParameterControls
          preview={state.preview}
          request={request}
          busy={state.refresh === 'busy'}
          onApply={apply}
        />
        <RefreshNotice state={state.refresh} />
      </div>
      <SimulationPreview preview={state.preview} />
    </>
  )
}

function RefreshNotice({ state }: { readonly state: 'idle' | 'busy' | 'success' | 'failure' }) {
  if (state === 'idle') return null
  if (state === 'busy') return <p role="status">Refreshing preview from the server.</p>
  if (state === 'success')
    return <p role="status">Preview refreshed with server-validated samples.</p>
  return (
    <Alert variant="destructive">
      <AlertTitle>Preview could not refresh</AlertTitle>
      <AlertDescription>
        The last valid server preview is still shown. Review the parameters and try again.
      </AlertDescription>
    </Alert>
  )
}

function previewMatchesRequest(preview: NormalizedPreview, request: PreviewRequest): boolean {
  if (preview.domain === 'projectile' && request.domain === 'projectile') {
    return (
      preview.input.initialSpeedMps === request.input.initialSpeedMps &&
      preview.input.launchAngleDeg === request.input.launchAngleDeg
    )
  }
  if (preview.domain === 'pendulum' && request.domain === 'pendulum') {
    return (
      preview.input.lengthM === request.input.lengthM &&
      preview.input.amplitudeDeg === request.input.amplitudeDeg
    )
  }
  return false
}
