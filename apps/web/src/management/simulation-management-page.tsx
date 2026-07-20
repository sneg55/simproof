import type { SimulationDetail, VersionComparison, VersionHistory } from '@simproof/contracts'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

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
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { libraryRouteNotice } from '@/library/library-route-notice'
import type { DownloadPort } from '@/management/download-port'
import {
  feedbackForFailure,
  type OperationFeedback,
  OperationFeedbackAlert,
} from '@/management/operation-feedback'
import { PortabilityActions } from '@/management/portability-actions'
import { VersionActions } from '@/management/version-actions'
import { VersionHistoryPanel } from '@/management/version-history-panel'

type PageState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready'
      readonly detail: SimulationDetail
      readonly history: VersionHistory
    }

export function SimulationManagementPage() {
  const { simulationId = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useEducatorSession()
  return (
    <SimulationManagementPageView
      api={browserLibraryManagementApi}
      csrfToken={session.csrfToken}
      passwordConfirmationRequired={session.authenticationMode !== 'local-bypass'}
      onArchived={(archived) => {
        void navigate('/', {
          state: libraryRouteNotice('archive', archived.simulation.title),
        })
      }}
      onDeleted={(title) => {
        void navigate('/', { state: libraryRouteNotice('delete', title) })
      }}
      onDuplicated={(duplicatedId) => {
        void navigate(`/simulations/${duplicatedId}/manage`)
      }}
      onReverifyAccepted={(runId) => {
        void navigate(generationRecoveryPath(simulationId, runId))
      }}
      key={simulationId}
      simulationId={simulationId}
    />
  )
}

export function generationRecoveryPath(simulationId: string, runId: string): string {
  return `/simulations/${simulationId}/generate?runId=${encodeURIComponent(runId)}`
}

export function SimulationManagementPageView({
  api,
  csrfToken,
  download,
  onDeleted,
  onArchived,
  onDuplicated,
  onReverifyAccepted,
  passwordConfirmationRequired = true,
  simulationId,
}: {
  readonly api: LibraryManagementApi
  readonly csrfToken: string
  readonly download?: DownloadPort | undefined
  readonly onArchived: (detail: SimulationDetail) => void
  readonly onDeleted: (title: string) => void
  readonly onDuplicated: (simulationId: string) => void
  readonly onReverifyAccepted?: ((runId: string) => void) | undefined
  readonly passwordConfirmationRequired?: boolean | undefined
  readonly simulationId: string
}) {
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null)
  const [reloadSequence, setReloadSequence] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.simulationDetail(simulationId, controller.signal),
      api.versionHistory(simulationId, controller.signal),
    ]).then(([detail, history]) => {
      if (controller.signal.aborted) return
      setState(
        detail.ok && history.ok
          ? { status: 'ready', detail: detail.value, history: history.value }
          : { status: 'error' },
      )
    })
    return () => controller.abort()
  }, [api, reloadSequence, simulationId])

  const refreshAuthoritative = async () => {
    const [detail, history] = await Promise.all([
      api.simulationDetail(simulationId),
      api.versionHistory(simulationId),
    ])
    if (detail.ok && history.ok) {
      setFeedback(null)
      setState({ status: 'ready', detail: detail.value, history: history.value })
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading simulation management">
          Loading simulation management
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading simulation management</span>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Simulation management unavailable">
          Simulation management unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>Management controls could not be loaded</AlertTitle>
          <AlertDescription>Return to the library or retry this simulation.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const { detail, history } = state
  const { simulation, selectedVersion } = detail
  const historyKey = history.versions
    .map(({ summary }) => `${summary.id}:${summary.revision}`)
    .join('|')
  const update = (updated: SimulationDetail) => {
    setState({ status: 'ready', detail: updated, history })
    setReloadSequence((sequence) => sequence + 1)
  }
  const compare = async (left: string, right: string): Promise<VersionComparison | null> => {
    const result = await api.compareVersions(simulation.id, left, right)
    if (result.ok) return result.value
    setFeedback(feedbackForFailure(result.error, 'The selected versions could not be compared.'))
    return null
  }

  const canGenerate = selectedVersion.availableActions.includes('start-generation')

  return (
    <div className="grid gap-8">
      <DocumentTitle value={`Manage ${simulation.title} | SimProof`} />
      <div>
        <Button asChild variant="ghost">
          <Link to={`/simulations/${simulation.id}`}>Back to simulation</Link>
        </Button>
      </div>
      <header className="grid max-w-prose gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Version {selectedVersion.summary.versionNumber}</Badge>
          <Badge variant="outline">{selectedVersion.summary.state}</Badge>
          <Badge variant="outline">Revision {selectedVersion.summary.revision}</Badge>
        </div>
        <h1 className="text-page-title text-balance font-heading font-semibold tracking-tight">
          Manage {simulation.title}
        </h1>
        <p className="text-pretty text-muted-foreground">
          Make a new version of this simulation, export it, or archive and delete it. Earlier
          versions and their verification results are always kept.
        </p>
        {selectedVersion.lineage === null ? null : (
          <p className="text-sm text-muted-foreground">
            Duplicated from version {selectedVersion.lineage.sourceVersionNumber}. The editable
            setup was copied; verification and published status start fresh.
          </p>
        )}
      </header>
      {canGenerate ? (
        <Card className="max-w-prose border-primary/40 bg-primary/5">
          <CardContent className="grid gap-3 pt-6">
            <div className="grid gap-1">
              <h2 className="font-heading text-lg font-medium">Next step: generate this draft</h2>
              <p className="text-pretty text-sm text-muted-foreground">
                This draft has no simulation yet. Describe your lesson and SimProof will generate
                and verify one. The version tools below are for later, once you have a simulation to
                manage.
              </p>
            </div>
            <div>
              <Button asChild>
                <Link to={`/simulations/${simulation.id}/generate`}>Generate this draft</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <OperationFeedbackAlert feedback={feedback} onRefresh={() => void refreshAuthoritative()} />
      <Card>
        <CardContent className="grid gap-8 pt-6">
          <VersionActions
            api={api}
            csrfToken={csrfToken}
            detail={detail}
            history={history}
            key={`actions:${selectedVersion.summary.id}:${historyKey}`}
            onFeedback={setFeedback}
            onDuplicated={(duplicated) => onDuplicated(duplicated.simulation.id)}
            onRefresh={refreshAuthoritative}
            onReverifyAccepted={(accepted) => onReverifyAccepted?.(accepted.runId)}
            onUpdated={update}
          />
          <PortabilityActions
            api={api}
            csrfToken={csrfToken}
            detail={detail}
            download={download}
            onDeleted={onDeleted}
            onArchived={onArchived}
            onFeedback={setFeedback}
            onRefresh={refreshAuthoritative}
            passwordConfirmationRequired={passwordConfirmationRequired}
          />
        </CardContent>
      </Card>
      <VersionHistoryPanel history={history} key={`history:${historyKey}`} onCompare={compare} />
    </div>
  )
}
