import type {
  ConceptSpec,
  EducatorVersionDetail,
  ExportLicense,
  FindingExplanation,
  SimulationDetail,
  SimulationVersion,
  VerificationPolicy,
  VerificationReport,
} from '@simproof/contracts'
import type { VerificationRun } from '@simproof/persistence'
import type { FindingExplainer } from '@simproof/providers'

export type LibraryVersionSummary = SimulationDetail['selectedVersion']['summary']

export interface VersionEvidence {
  readonly summary: LibraryVersionSummary
  readonly conceptSpec: ConceptSpec | null
  readonly exportLicense: ExportLicense | null
}

export interface ReportContent {
  readonly conceptSpec: ConceptSpec
  readonly report: VerificationReport
  readonly policy: VerificationPolicy
}

export function summaryFor(
  version: SimulationVersion,
  domain: 'projectile' | 'pendulum' | null,
  verification: LibraryVersionSummary['verification'],
): LibraryVersionSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    revision: version.revision,
    domain,
    verification,
    updatedAt: version.updatedAt,
  }
}

export function actionsFor(
  version: SimulationVersion,
  verification: LibraryVersionSummary['verification']['status'],
): EducatorVersionDetail['availableActions'] {
  if (version.state === 'archived') return ['duplicate', 'export', 'delete']
  const actions: EducatorVersionDetail['availableActions'][number][] = [
    'start-blank-version',
    'duplicate',
    'export',
    'archive',
    'delete',
  ]
  if (version.state === 'draft') actions.unshift('start-generation')
  if (['generating', 'verifying'].includes(version.state)) actions.unshift('cancel-generation')
  if (version.activeGeneratedArtifactId !== null) actions.unshift('preview')
  if (version.activeVerificationRunId !== null) actions.unshift('view-report')
  if (version.state === 'verified' && verification === 'current') actions.unshift('publish')
  if (version.state === 'stale') actions.unshift('reverify')
  return actions
}

// Produces model-authored commentary for a rejected report from its persisted
// findings. It is memoized by report hash, gated on an available explainer and a
// rejected verdict, and fails soft: any explainer error yields no narration so the
// report still renders its trusted evidence.
export async function narrationFor(input: {
  readonly explainer: FindingExplainer | undefined
  readonly cache: Map<string, FindingExplanation>
  readonly run: VerificationRun
  readonly conceptSpec: ConceptSpec
  readonly report: VerificationReport
}): Promise<FindingExplanation | undefined> {
  const { cache, conceptSpec, explainer, report, run } = input
  if (explainer === undefined || report.verdict !== 'rejected') return undefined
  const key = run.report.contentHash
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const explained = await explainer.explain({
    conceptSpec,
    verdict: 'rejected',
    findings: report.findings,
  })
  if (!explained.ok) return undefined
  cache.set(key, explained.value)
  return explained.value
}
