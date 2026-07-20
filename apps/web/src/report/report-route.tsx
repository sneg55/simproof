import { type ReactNode, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { browserReportPreviewApi } from '@/api/report-preview-api'
import { useEducatorSession } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { publicationSuccessRouteState } from '@/library/simulation-route-state'
import { type ReportTarget, VerificationReportPageView } from '@/report/report-page'

export function SeedReportPage() {
  const { seedId = '' } = useParams()
  const { session } = useEducatorSession()
  const target = useMemo<ReportTarget>(() => ({ kind: 'seed', seedId }), [seedId])
  return (
    <ReportRouteLayout backTo={`/seeds/${seedId}/preview`} label="Back to preview">
      <VerificationReportPageView
        api={browserReportPreviewApi}
        csrfToken={session.csrfToken}
        target={target}
      />
    </ReportRouteLayout>
  )
}

export function VersionReportPage() {
  const { versionId = '' } = useParams()
  const navigate = useNavigate()
  const { session } = useEducatorSession()
  const target = useMemo<ReportTarget>(() => ({ kind: 'version', versionId }), [versionId])
  return (
    <ReportRouteLayout backTo="/" label="Back to simulation library">
      <VerificationReportPageView
        api={browserReportPreviewApi}
        csrfToken={session.csrfToken}
        target={target}
        onPublished={({ simulationId, versionNumber }) => {
          void navigate(`/simulations/${simulationId}`, {
            state: publicationSuccessRouteState(versionNumber),
          })
        }}
      />
    </ReportRouteLayout>
  )
}

function ReportRouteLayout({
  backTo,
  children,
  label,
}: {
  readonly backTo: string
  readonly children: ReactNode
  readonly label: string
}) {
  return (
    <div className="grid gap-6">
      <div>
        <Button asChild variant="ghost">
          <Link to={backTo}>{label}</Link>
        </Button>
      </div>
      {children}
    </div>
  )
}
