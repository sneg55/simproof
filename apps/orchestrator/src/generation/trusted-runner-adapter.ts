import { createHash, randomUUID } from 'node:crypto'

import {
  type ConceptSpec,
  type RunnerBinding,
  type RunnerLimits,
  type RunnerRequest,
  type RunnerResponse,
  runnerBindingSchema,
  runnerLimitsSchema,
  runnerRequestSchema,
} from '@simproof/contracts'
import { getDomainPack, hashCanonicalJson } from '@simproof/verifier'

import type {
  GeneratedArtifactSet,
  PipelineRunner,
  PipelineRunnerResult,
} from './pipeline-types.js'
import type { RunnerServicePort } from './runner-service-port.js'

interface VerificationInput {
  readonly artifactSource: string
  readonly runner: RunnerBinding
}

export type TrustedRunnerSuccess = Extract<PipelineRunnerResult, { readonly ok: true }> & {
  readonly verificationInput: VerificationInput
}

export type TrustedRunnerResult =
  | TrustedRunnerSuccess
  | Extract<PipelineRunnerResult, { readonly ok: false }>

export interface TrustedRunnerAdapter extends PipelineRunner {
  readonly execute: (
    conceptSpec: ConceptSpec,
    artifacts: GeneratedArtifactSet,
    signal?: AbortSignal,
  ) => Promise<TrustedRunnerResult>
}

export interface TrustedRunnerAdapterOptions {
  readonly service: RunnerServicePort
  readonly runner: RunnerBinding
  readonly limits: RunnerLimits
  readonly createRequestId?: () => string
}

const artifactHash = (source: string) =>
  `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}` as const

const sampleId = (index: number) => `sample-${String(index + 1).padStart(4, '0')}`

function projectileInputs() {
  const policy = getDomainPack('projectile').policy
  const inputs = [
    ...policy.sampling.cases,
    ...policy.sampling.rangeMaximum.launchAnglesDeg.map((launchAngleDeg) => ({
      initialSpeedMps: policy.sampling.rangeMaximum.initialSpeedMps,
      launchAngleDeg,
    })),
  ]
  return [
    ...new Map(
      inputs.map((input) => [`${input.initialSpeedMps}:${input.launchAngleDeg}`, input]),
    ).values(),
  ]
}

function requestFor(options: {
  readonly conceptSpec: ConceptSpec
  readonly artifacts: GeneratedArtifactSet
  readonly runner: RunnerBinding
  readonly limits: RunnerLimits
  readonly requestId: string
}): RunnerRequest {
  const { artifacts, conceptSpec, limits, requestId, runner } = options
  const common = {
    protocolVersion: runner.protocolVersion,
    requestId,
    artifact: {
      format: 'javascript-esm' as const,
      content: artifacts.core.content,
      hash: artifactHash(artifacts.core.content),
    },
    limits,
  }
  if (conceptSpec.domain === 'pendulum') {
    const domainPack = getDomainPack('pendulum')
    return runnerRequestSchema.parse({
      ...common,
      domain: 'pendulum',
      policy: {
        id: domainPack.policy.id,
        version: domainPack.policy.version,
        contentHash: hashCanonicalJson(domainPack.policy),
      },
      inputs: domainPack.policy.sampling.cases.map((input, index) => ({
        sampleId: sampleId(index),
        input,
      })),
    })
  }
  const domainPack = getDomainPack('projectile')
  return runnerRequestSchema.parse({
    ...common,
    domain: 'projectile',
    policy: {
      id: domainPack.policy.id,
      version: domainPack.policy.version,
      contentHash: hashCanonicalJson(domainPack.policy),
    },
    inputs: projectileInputs().map((input, index) => ({ sampleId: sampleId(index), input })),
  })
}

function mapResponse(
  response: RunnerResponse,
  source: string,
  runner: RunnerBinding,
): TrustedRunnerResult {
  if (response.exit.classification !== 'success') {
    return Object.freeze({
      ok: false as const,
      ...(response.exit.classification === 'cancelled' ? { cancelled: true } : {}),
      stableErrorId: response.exit.errorId,
      diagnostics: Object.freeze([...response.diagnostics]),
    })
  }
  return Object.freeze({
    ok: true as const,
    artifactHash: response.observedArtifactHash as `sha256:${string}`,
    observations: Object.freeze(response.samples.map(({ observation }) => observation)),
    diagnostics: Object.freeze([...response.diagnostics]),
    verificationInput: Object.freeze({ artifactSource: source, runner }),
  })
}

export function createTrustedRunnerAdapter(
  options: TrustedRunnerAdapterOptions,
): TrustedRunnerAdapter {
  const runner = Object.freeze(runnerBindingSchema.parse(options.runner))
  const limits = Object.freeze(runnerLimitsSchema.parse(options.limits))
  const createRequestId = options.createRequestId ?? randomUUID
  const adapter: TrustedRunnerAdapter = {
    async execute(conceptSpec: ConceptSpec, artifacts: GeneratedArtifactSet, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const request = requestFor({
        conceptSpec,
        artifacts,
        runner,
        limits,
        requestId: createRequestId(),
      })
      const response = await options.service.execute(request, signal)
      return mapResponse(response, artifacts.core.content, runner)
    },
  }
  return Object.freeze(adapter)
}
