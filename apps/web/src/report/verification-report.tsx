import type { ExportLicense, StaleReason, VerificationReportDisplay } from '@simproof/contracts'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VerificationBadge } from '@/components/ui/verification-badge'
import { EvidenceDetails } from '@/report/report-details'

const LICENSES = [
  { label: 'No export license', value: { kind: 'none' } },
  { label: 'Creative Commons Attribution 4.0', value: { kind: 'spdx', id: 'CC-BY-4.0' } },
  {
    label: 'Creative Commons Attribution-ShareAlike 4.0',
    value: { kind: 'spdx', id: 'CC-BY-SA-4.0' },
  },
] as const satisfies readonly { readonly label: string; readonly value: ExportLicense }[]

export function VerificationReportPanel({
  report,
  onPublish,
  onReverify,
  busy = false,
  commandsEnabled = true,
}: {
  readonly report: VerificationReportDisplay
  readonly onPublish: (license: ExportLicense) => void
  readonly onReverify: () => void
  readonly busy?: boolean
  readonly commandsEnabled?: boolean
}) {
  const [license, setLicense] = useState<ExportLicense | null>(null)
  const verdict = verdictCopy(report)
  return (
    <div className="grid gap-6">
      <header className="grid max-w-3xl gap-3">
        <div className="flex flex-wrap gap-2">
          <VerificationBadge state={report.report.verdict} />
          {report.badgeActive ? <VerificationBadge state="active" /> : null}
          {report.publication.published ? <Badge variant="signal">Published</Badge> : null}
        </div>
        <h1 className="text-page-title font-heading font-semibold tracking-tight">
          Verification report
        </h1>
        <h2 className="text-2xl font-semibold">{verdict.title}</h2>
        <p className="text-muted-foreground">{verdict.description}</p>
      </header>

      {report.validity.status === 'stale' ? (
        <Alert>
          <AlertTitle>Evidence is stale</AlertTitle>
          <AlertDescription>
            <p>
              This report remains historical evidence, but it no longer describes the current
              version.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {report.validity.reasons.map((reason) => (
                <li key={reason}>{staleLabel(reason)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {report.narration ? (
        <Alert>
          <AlertTitle>AI explanation of the failure</AlertTitle>
          <AlertDescription>
            <p>{report.narration.narration}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Model-authored commentary from {report.narration.provenance.model}. It describes the
              finding in plain language but is not part of the verified evidence and cannot change
              the verdict.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <EvidenceDetails display={report} />
      <PublicationControls
        report={report}
        license={license}
        busy={busy}
        onLicense={setLicense}
        onPublish={onPublish}
        onReverify={onReverify}
        commandsEnabled={commandsEnabled}
      />
    </div>
  )
}

function PublicationControls({
  report,
  license,
  busy,
  onLicense,
  onPublish,
  onReverify,
  commandsEnabled,
}: {
  readonly report: VerificationReportDisplay
  readonly license: ExportLicense | null
  readonly busy: boolean
  readonly onLicense: (license: ExportLicense) => void
  readonly onPublish: (license: ExportLicense) => void
  readonly onReverify: () => void
  readonly commandsEnabled: boolean
}) {
  if (!commandsEnabled) {
    return (
      <Alert>
        <AlertTitle>Bundled reference evidence</AlertTitle>
        <AlertDescription>
          This installed example is read-only. Create a separate educator simulation to make
          editable versions.
        </AlertDescription>
      </Alert>
    )
  }
  if (report.validity.status === 'stale') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Refresh scientific evidence</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Publishing is blocked until this exact version passes the current trusted policy.
          </p>
          <div>
            <Button disabled={busy} onClick={onReverify}>
              Run verification again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }
  if (report.publication.published) {
    return (
      <Alert>
        <AlertTitle>Published</AlertTitle>
        <AlertDescription>
          Published {new Date(report.publication.publishedAt).toLocaleString()} with{' '}
          {licenseLabel(report.publication.exportLicense)}.
        </AlertDescription>
      </Alert>
    )
  }
  if (!report.publishable) {
    return (
      <Alert>
        <AlertTitle>Publication unavailable</AlertTitle>
        <AlertDescription>
          This version does not have current verified evidence that the server allows to publish.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish this verified version</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Choose the exact license that will travel with exports. Publication is bound to this
          report and version revision.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Export license">
          {LICENSES.map((option) => {
            const selected = licenseLabel(license) === licenseLabel(option.value)
            return (
              <Button
                key={option.label}
                type="button"
                variant={selected ? 'secondary' : 'outline'}
                aria-pressed={selected}
                onClick={() => onLicense(option.value)}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
        <AlertDialog>
          <div>
            <AlertDialogTrigger asChild>
              <Button disabled={busy || license === null}>Publish verified version</Button>
            </AlertDialogTrigger>
          </div>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Publish this exact verified version?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="grid gap-2">
                  <p>
                    Publishing marks this exact verified version as the published version of your
                    simulation and locks it to the evidence below. You can still preview or export
                    it afterward.
                  </p>
                  <dl className="grid gap-1 break-all">
                    <dt>Version</dt>
                    <dd className="font-mono text-xs">{report.simulationVersionId}</dd>
                    <dt>Revision</dt>
                    <dd>Revision {report.versionRevision}</dd>
                    <dt>Verification run</dt>
                    <dd className="font-mono text-xs">{report.verificationRunId}</dd>
                  </dl>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || license === null}
                onClick={() => (license === null ? undefined : onPublish(license))}
              >
                Confirm exact version publication
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function verdictCopy(report: VerificationReportDisplay): { title: string; description: string } {
  if (report.report.verdict === 'verified')
    return {
      title: 'Verified for the tested scope',
      description:
        'Every trusted check passed for the ranges and tolerances recorded below. This is bounded evidence, not a claim beyond that scope.',
    }
  if (report.report.verdict === 'rejected')
    return {
      title: 'Rejected by scientific checks',
      description:
        'At least one trusted scientific check failed. Review the findings before revising the generated artifact.',
    }
  return {
    title: 'Outside the trusted policy scope',
    description:
      'The requested concept could not be judged by this policy. The findings explain the applicability boundary.',
  }
}

function licenseLabel(license: ExportLicense | null): string {
  if (license === null) return ''
  if (license.kind === 'none') return 'No export license'
  if (license.kind === 'spdx') return license.id
  return license.label
}

function staleLabel(reason: StaleReason): string {
  if (reason === 'concept-changed') return 'Concept changed'
  if (reason === 'artifact-changed') return 'Generated artifact changed'
  if (reason === 'observations-changed') return 'Verification observations changed'
  if (reason === 'policy-changed') return 'Verification policy changed'
  if (reason === 'domain-pack-changed') return 'Domain pack changed'
  if (reason === 'runner-changed') return 'Runner changed'
  return 'Verification dependencies changed'
}
