import {
  BUILT_IN_RENDERER_CAPABILITIES,
  type ConceptSpec,
  type NormalizedPreview,
  normalizedPreviewSchema,
  type PreviewRequest,
  type RendererData,
  type ReportValidity,
  rendererDataSchema,
} from '@simproof/contracts'
import {
  pendulumPeriodSeconds,
  pendulumTimeSeries,
  projectileTimeSeries,
} from '@simproof/sim-runtime'

export interface PreviewEvidence {
  readonly verificationRunId: string
  readonly artifactHash: string
  readonly validity: ReportValidity
  readonly assumptions: readonly string[]
  readonly limitations: readonly string[]
}

export interface PreviewBinding {
  readonly simulationVersionId: string
  readonly conceptSpec: ConceptSpec
  readonly renderer: RendererData
  readonly evidence: PreviewEvidence
}

// The renderer is fully determined by the domain: it names which built-in visualization the web
// draws and which features it enables. Trust does not flow through it (previewBindingsMatch never
// inspects it), so a version reuses the same canonical capability set the seed catalog ships.
export function rendererForDomain(domain: ConceptSpec['domain']): RendererData {
  const capability =
    domain === 'projectile'
      ? BUILT_IN_RENDERER_CAPABILITIES.projectile
      : BUILT_IN_RENDERER_CAPABILITIES.pendulum
  return rendererDataSchema.parse({
    schemaVersion: '1',
    domain,
    renderer: capability.renderer,
    features: [...capability.features],
  })
}

// Recompute the sample series from the trusted per-domain physics and stitch it to the version's
// verified evidence. This is the same construction the bundled seed catalog performs; the artifact
// itself is never executed. Returns undefined when the candidate falls outside the schema (for
// example, an input beyond the reviewed concept bounds).
export function buildNormalizedPreview(
  request: PreviewRequest,
  binding: PreviewBinding,
): NormalizedPreview | undefined {
  if (request.domain !== binding.conceptSpec.domain) return undefined
  const candidate =
    request.domain === 'projectile'
      ? projectileCandidate(request, binding)
      : pendulumCandidate(request, binding)
  const parsed = normalizedPreviewSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

function projectileCandidate(
  request: Extract<PreviewRequest, { domain: 'projectile' }>,
  binding: PreviewBinding,
) {
  const samples = projectileTimeSeries(request.input, request.sampleCount)
  const last = samples.length - 1
  const events = [
    { kind: 'launch' as const, sampleIndex: 0 },
    ...(last % 2 === 0 ? [{ kind: 'apex' as const, sampleIndex: last / 2 }] : []),
    { kind: 'impact' as const, sampleIndex: last },
  ]
  return {
    schemaVersion: '1',
    domain: 'projectile',
    simulationVersionId: binding.simulationVersionId,
    conceptSpec: binding.conceptSpec,
    renderer: binding.renderer,
    input: request.input,
    evidence: binding.evidence,
    samples: samples.map((sample, index) => ({ index, ...sample })),
    events,
  }
}

function pendulumCandidate(
  request: Extract<PreviewRequest, { domain: 'pendulum' }>,
  binding: PreviewBinding,
) {
  const samples = pendulumTimeSeries(request.input, request.sampleCount)
  const last = samples.length - 1
  const events = [
    { kind: 'right-turning-point' as const, sampleIndex: 0 },
    ...(last % 4 === 0
      ? [
          { kind: 'equilibrium-crossing' as const, sampleIndex: last / 4 },
          { kind: 'equilibrium-crossing' as const, sampleIndex: (last * 3) / 4 },
        ]
      : []),
    ...(last % 2 === 0 ? [{ kind: 'left-turning-point' as const, sampleIndex: last / 2 }] : []),
    { kind: 'right-turning-point' as const, sampleIndex: last },
  ]
  return {
    schemaVersion: '1',
    domain: 'pendulum',
    simulationVersionId: binding.simulationVersionId,
    conceptSpec: binding.conceptSpec,
    renderer: binding.renderer,
    input: request.input,
    periodS: pendulumPeriodSeconds(request.input.lengthM),
    evidence: binding.evidence,
    samples: samples.map((sample, index) => ({ index, ...sample })),
    events,
  }
}
