import type { ExportLicense, VerificationReportDisplay } from '@simproof/contracts'
import { useEffect, useState } from 'react'

import type { ReportPreviewApi } from '@/api/report-preview-api'
import { DocumentTitle } from '@/app/document-title'
import { PageStateHeading } from '@/app/page-state-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { VerificationReportPanel } from '@/report/verification-report'

type PageState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly report: VerificationReportDisplay }

type CommandState =
  | { readonly status: 'idle' | 'busy' }
  | { readonly status: 'conflict' | 'failed' | 'published' | 'reverification-started' }

export function VerificationReportPageView({
  api,
  csrfToken,
  target,
  onPublished,
}: {
  readonly api: ReportPreviewApi
  readonly csrfToken: string
  readonly target: ReportTarget
  readonly onPublished?: (destination: PublicationDestination) => void
}) {
  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [command, setCommand] = useState<CommandState>({ status: 'idle' })

  useEffect(() => {
    const controller = new AbortController()
    void loadReport(api, target, controller.signal).then((next) => {
      if (!controller.signal.aborted) setPage(next)
    })
    return () => controller.abort()
  }, [api, target])

  if (page.status === 'loading') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Loading verification report">
          Loading verification report
        </PageStateHeading>
        <div role="status">
          <span className="sr-only">Loading verification report</span>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }
  if (page.status === 'error') {
    return (
      <div className="grid gap-4">
        <PageStateHeading documentTitle="Verification report unavailable">
          Verification report unavailable
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>Verification report unavailable</AlertTitle>
          <AlertDescription>
            The server did not return a valid report for this version.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const publish = async (license: ExportLicense) => {
    if (target.kind === 'seed') return
    setCommand({ status: 'busy' })
    const result = await api.publishVersion(
      target.versionId,
      {
        expectedRevision: page.report.versionRevision,
        verificationRunId: page.report.verificationRunId,
        exportLicense: license,
      },
      csrfToken,
    )
    if (!result.ok) {
      setCommand({ status: result.error.kind === 'conflict' ? 'conflict' : 'failed' })
      if (result.error.kind === 'conflict') await refreshReport(api, target, setPage)
      return
    }
    if (onPublished !== undefined) {
      onPublished({
        simulationId: result.value.simulation.id,
        versionNumber: result.value.selectedVersion.summary.versionNumber,
      })
      return
    }
    setCommand({ status: 'published' })
    await refreshReport(api, target, setPage)
  }

  const reverify = async () => {
    if (target.kind === 'seed') return
    setCommand({ status: 'busy' })
    const result = await api.reverifyVersion(
      target.versionId,
      {
        expectedRevision: page.report.versionRevision,
        idempotencyKey: `reverify:${target.versionId}:${page.report.versionRevision}`,
      },
      csrfToken,
    )
    setCommand({
      status: result.ok
        ? 'reverification-started'
        : result.error.kind === 'conflict'
          ? 'conflict'
          : 'failed',
    })
    if (!result.ok && result.error.kind === 'conflict') await refreshReport(api, target, setPage)
  }

  return (
    <div className="grid gap-4">
      <DocumentTitle value="Verification report | SimProof" />
      <CommandNotice state={command.status} />
      <VerificationReportPanel
        report={page.report}
        busy={command.status === 'busy'}
        commandsEnabled={target.kind === 'version'}
        onPublish={(license) => void publish(license)}
        onReverify={() => void reverify()}
      />
    </div>
  )
}

async function loadReport(
  api: ReportPreviewApi,
  target: ReportTarget,
  signal?: AbortSignal,
): Promise<PageState> {
  const result =
    target.kind === 'seed'
      ? await api.seedReport(target.seedId, signal)
      : await api.versionReport(target.versionId, signal)
  return result.ok ? { status: 'ready', report: result.value } : { status: 'error' }
}

async function refreshReport(
  api: ReportPreviewApi,
  target: ReportTarget,
  setPage: (state: PageState) => void,
): Promise<void> {
  setPage(await loadReport(api, target))
}

export type ReportTarget =
  | { readonly kind: 'seed'; readonly seedId: string }
  | { readonly kind: 'version'; readonly versionId: string }

export interface PublicationDestination {
  readonly simulationId: string
  readonly versionNumber: number
}

function CommandNotice({ state }: { readonly state: CommandState['status'] }) {
  if (state === 'idle' || state === 'busy') return null
  const content = commandCopy(state)
  return (
    <Alert variant={state === 'failed' ? 'destructive' : 'default'}>
      <AlertTitle>{content[0]}</AlertTitle>
      <AlertDescription>{content[1]}</AlertDescription>
    </Alert>
  )
}

function commandCopy(
  state: Exclude<CommandState['status'], 'idle' | 'busy'>,
): readonly [string, string] {
  if (state === 'conflict') {
    return [
      'The version changed',
      'The latest server state is shown. Review it before trying again.',
    ]
  }
  if (state === 'failed') {
    return ['The command failed', 'The server did not accept this change. Nothing was published.']
  }
  if (state === 'published') {
    return [
      'Publication accepted',
      'The server accepted publication for the exact verified version.',
    ]
  }
  return ['Verification queued', 'The server accepted a new verification run.']
}
