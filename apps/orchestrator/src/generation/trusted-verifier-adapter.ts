import { createHash, randomUUID } from 'node:crypto'

import {
  type ConceptSpec,
  type RunnerBinding,
  runnerBindingSchema,
  type VerificationDependencyBinding,
  type VerificationReport,
  verificationDependencyBindingSchema,
} from '@simproof/contracts'
import { createVerificationReport, getDomainPack, hashCanonicalJson } from '@simproof/verifier'

import type { PipelineRunnerResult, PipelineVerifier } from './pipeline-types.js'
import type { TrustedRunnerSuccess } from './trusted-runner-adapter.js'

export interface TrustedVerificationResult {
  readonly verdict: 'rejected' | 'verified'
  readonly reportHash: `sha256:${string}`
  readonly findingsHash: `sha256:${string}`
  readonly findings: VerificationReport['findings']
  readonly report: VerificationReport
  readonly dependencies: VerificationDependencyBinding
}

export interface TrustedVerifierAdapter extends PipelineVerifier {
  readonly verify: (
    conceptSpec: ConceptSpec,
    execution: Extract<PipelineRunnerResult, { readonly ok: true }>,
    signal?: AbortSignal,
  ) => Promise<TrustedVerificationResult>
}

export interface TrustedVerifierAdapterOptions {
  readonly runner: RunnerBinding
  readonly dependencies: VerificationDependencyBinding
  readonly createReportId?: () => string
  readonly now?: () => string
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function trustedExecution(
  execution: Extract<PipelineRunnerResult, { readonly ok: true }>,
  runner: RunnerBinding,
): TrustedRunnerSuccess {
  if (!('verificationInput' in execution)) {
    throw new TypeError('Verification requires trusted runner execution context.')
  }
  const candidate = execution as TrustedRunnerSuccess
  const executionRunner = runnerBindingSchema.safeParse(candidate.verificationInput.runner)
  if (
    typeof candidate.verificationInput.artifactSource !== 'string' ||
    !executionRunner.success ||
    hashCanonicalJson(executionRunner.data) !== hashCanonicalJson(runner)
  ) {
    throw new TypeError('Verification requires trusted runner execution context.')
  }
  const rawArtifactHash = `sha256:${createHash('sha256')
    .update(candidate.verificationInput.artifactSource, 'utf8')
    .digest('hex')}`
  if (rawArtifactHash !== candidate.artifactHash) {
    throw new TypeError('Verification requires artifact-bound trusted runner execution context.')
  }
  return candidate
}

export function createTrustedVerifierAdapter(
  options: TrustedVerifierAdapterOptions,
): TrustedVerifierAdapter {
  const runner = deepFreeze(runnerBindingSchema.parse(options.runner))
  const dependencies = deepFreeze(verificationDependencyBindingSchema.parse(options.dependencies))
  const createReportId = options.createReportId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  const adapter: TrustedVerifierAdapter = {
    verify(
      conceptSpec: ConceptSpec,
      execution: Extract<PipelineRunnerResult, { readonly ok: true }>,
      signal?: AbortSignal,
    ) {
      return Promise.resolve().then(() => {
        signal?.throwIfAborted()
        const trusted = trustedExecution(execution, runner)
        const domainPack = getDomainPack(conceptSpec.domain)
        if (domainPack === undefined) throw new TypeError('No trusted domain pack is installed.')
        const report = deepFreeze(
          createVerificationReport({
            reportId: createReportId(),
            createdAt: now(),
            conceptSpec,
            artifactSource: trusted.verificationInput.artifactSource,
            policy: domainPack.policy,
            runner,
            observations: trusted.observations,
          }),
        )
        signal?.throwIfAborted()
        if (report.verdict === 'inapplicable') {
          throw new TypeError('Trusted policy grid produced an inapplicable verification report.')
        }
        return deepFreeze({
          verdict: report.verdict,
          reportHash: hashCanonicalJson(report) as `sha256:${string}`,
          findingsHash: hashCanonicalJson(report.findings) as `sha256:${string}`,
          findings: report.findings,
          report,
          dependencies,
        })
      })
    },
  }
  return Object.freeze(adapter)
}
