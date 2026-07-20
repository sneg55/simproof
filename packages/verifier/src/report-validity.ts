import type {
  CurrentVerificationBindings,
  ReportValidity,
  StaleReason,
  VerificationReport,
} from '@simproof/contracts'

function versionedContentChanged(
  previous: VerificationReport['policy'],
  current: CurrentVerificationBindings['policy'],
): boolean {
  return (
    previous.id !== current.id ||
    previous.version !== current.version ||
    previous.contentHash !== current.contentHash
  )
}

export function assessReportValidity(
  report: VerificationReport,
  current: CurrentVerificationBindings,
): ReportValidity {
  const reasons: StaleReason[] = []
  if (report.conceptSpecHash !== current.conceptSpecHash) reasons.push('concept-changed')
  if (report.artifact.hash !== current.artifactHash) reasons.push('artifact-changed')
  if (report.observationHash !== current.observationHash) reasons.push('observations-changed')
  if (versionedContentChanged(report.policy, current.policy)) reasons.push('policy-changed')
  if (versionedContentChanged(report.domainPack, current.domainPack)) {
    reasons.push('domain-pack-changed')
  }
  if (report.runner.version !== current.runner.version) {
    reasons.push('runner-changed')
  }
  return reasons.length === 0 ? { status: 'current' } : { status: 'stale', reasons }
}

export function isPublishable(
  report: Pick<VerificationReport, 'verdict'>,
  validity: ReportValidity,
): boolean {
  return report.verdict === 'verified' && validity.status === 'current'
}
