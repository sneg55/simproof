import type { NormalizedPreview, PreviewRequest } from '@simproof/contracts'

import type { EducatorPreviewPort } from '../educator/ports.js'
import type { EducatorReportProjection } from '../educator/report-projection.js'
import { failed, succeeded } from '../educator/results.js'
import type { HttpOperationResult } from '../http/types.js'
import { buildNormalizedPreview, rendererForDomain } from './normalized-preview.js'

// The built-in preview producer for teacher-generated versions. It derives the preview from the
// version's own verified report (concept spec + evidence) and recomputes the sample series from the
// trusted per-domain physics. The service still cross-checks the result against its independently
// loaded authority via previewBindingsMatch, so this producer stays inside the trust boundary.
export function createVersionPreviewProducer(
  reports: EducatorReportProjection,
): EducatorPreviewPort {
  return {
    preview: (versionId, input) => producePreview(reports, versionId, input),
  }
}

async function producePreview(
  reports: EducatorReportProjection,
  versionId: string,
  input: PreviewRequest,
): Promise<HttpOperationResult<NormalizedPreview>> {
  const display = await reports.display(versionId)
  if (!display.ok) return display
  const authority = display.value
  const preview = buildNormalizedPreview(input, {
    simulationVersionId: authority.simulationVersionId,
    conceptSpec: authority.conceptSpec,
    renderer: rendererForDomain(authority.conceptSpec.domain),
    evidence: {
      verificationRunId: authority.verificationRunId,
      artifactHash: authority.report.artifact.hash,
      validity: authority.validity,
      assumptions: authority.report.assumptions,
      limitations: authority.report.limitations,
    },
  })
  // The authority report was already validated above, so a missing candidate here means the
  // requested input falls outside the version's reviewed concept bounds: a client error (400),
  // matching how the bundled seed catalog classifies the same case, not a server failure (503).
  return preview === undefined
    ? failed(
        'invalid-input',
        'Preview request is outside the reviewed concept bounds.',
        'educator.preview-out-of-bounds',
      )
    : succeeded(preview)
}
