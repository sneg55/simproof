import type { VerificationFinding } from '@simproof/contracts'
import { type FindingExplanation, findingExplanationSchema } from '@simproof/contracts'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

import {
  classifyProviderException,
  providerErrors,
  providerFailure,
  providerRequestId,
} from './errors.js'
import {
  createProviderCallReservation,
  estimatedCostMicrousd,
  failedCallUsage,
  type ProviderMeteringPolicyConfig,
} from './metering-policy.js'
import type {
  FindingExplainer,
  FindingExplanationRequest,
  ProviderCallOptions,
  ProviderCallReservation,
  ProviderDescriptor,
  ProviderResult,
} from './types.js'

const narrationEnvelopeSchema = z
  .object({ narration: z.string().trim().min(1).max(2_000) })
  .strict()

export interface OpenAIExplanationParseRequest {
  readonly model: string
  readonly max_output_tokens: number
  readonly instructions: string
  readonly input: string
  readonly text: {
    readonly format: ReturnType<typeof zodTextFormat<typeof narrationEnvelopeSchema>>
  }
}

export interface OpenAIExplanationParseResult {
  readonly id: string
  readonly model: string
  readonly outputParsed: unknown
  readonly refusals: readonly string[]
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export interface OpenAIExplanationTransport {
  parse(
    request: OpenAIExplanationParseRequest,
    signal?: AbortSignal,
  ): Promise<OpenAIExplanationParseResult>
}

export interface OpenAIFindingExplainerConfig extends ProviderMeteringPolicyConfig {
  readonly model: string
  readonly templateVersion: string
  readonly explainReservation: ProviderCallReservation
}

const instructions = `You explain, for a teacher, why an independent verifier rejected an automatically generated physics simulation.
The verifier already decided the verdict from an application-owned policy. Do not dispute, re-derive, or overturn it, and never claim the simulation is correct.
Using only the findings provided, describe in plain language which physical quantity was wrong and the most likely cause.
Return only the narration text in the required schema.`

const describeFinding = (finding: VerificationFinding): string => {
  const errorText =
    finding.error.mode === 'relative'
      ? `relative error ${finding.error.value}`
      : `absolute error ${finding.error.value} ${finding.error.unit}`
  return `- ${finding.quantity} (${finding.category}, ${finding.severity}): expected ${finding.expected.value} ${finding.expected.unit}, actual ${finding.actual.value} ${finding.actual.unit}, ${errorText}; verifier note: ${finding.explanation}`
}

const buildInput = (request: FindingExplanationRequest): string =>
  [
    `Domain: ${request.conceptSpec.domain}.`,
    `Concept: "${request.conceptSpec.title}".`,
    `Verdict: ${request.verdict}.`,
    'Findings:',
    ...request.findings.map(describeFinding),
  ].join('\n')

const refusalMessages = (response: {
  readonly output: readonly {
    readonly type: string
    readonly content?: readonly { readonly type: string; readonly refusal?: string }[]
  }[]
}) =>
  response.output.flatMap((item) =>
    item.type === 'message'
      ? (item.content ?? []).flatMap((content) =>
          content.type === 'refusal' && content.refusal !== undefined ? [content.refusal] : [],
        )
      : [],
  )

export class OpenAISdkExplanationTransport implements OpenAIExplanationTransport {
  readonly #client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    this.#client = new OpenAI({ apiKey, ...(baseURL === undefined ? {} : { baseURL }) })
  }

  async parse(
    request: OpenAIExplanationParseRequest,
    signal?: AbortSignal,
  ): Promise<OpenAIExplanationParseResult> {
    const response = await this.#client.responses.parse(
      request,
      signal === undefined ? undefined : { signal },
    )
    return {
      id: response._request_id ?? response.id,
      model: response.model,
      outputParsed: response.output_parsed,
      refusals: refusalMessages(response),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    }
  }
}

export class OpenAIResponsesFindingExplainer implements FindingExplainer {
  readonly descriptor: ProviderDescriptor
  readonly explainReservation: ProviderCallReservation
  readonly #config: OpenAIFindingExplainerConfig
  readonly #transport: OpenAIExplanationTransport

  constructor(config: OpenAIFindingExplainerConfig, transport: OpenAIExplanationTransport) {
    this.#config = config
    this.#transport = transport
    this.explainReservation = createProviderCallReservation(config.explainReservation)
    this.descriptor = Object.freeze({
      provider: 'openai-responses' as const,
      model: config.model,
      templateVersion: config.templateVersion,
    })
  }

  async explain(
    request: FindingExplanationRequest,
    options?: ProviderCallOptions,
  ): Promise<ProviderResult<FindingExplanation>> {
    const metering = (
      requestIds: readonly string[],
      usage = { inputTokens: 0, outputTokens: 0 },
      requestCount = 1,
    ) => ({
      provider: 'openai-responses' as const,
      model: this.#config.model,
      templateVersion: this.#config.templateVersion,
      requestIds,
      usage: { ...usage, requestCount, costMicrousd: this.#costMicrousd(usage) },
    })
    if (options?.signal?.aborted === true) {
      return providerFailure(
        providerErrors.cancellation,
        'cancellation',
        metering([], undefined, 0),
      )
    }
    let response: OpenAIExplanationParseResult
    try {
      response = await this.#transport.parse(
        {
          model: this.#config.model,
          max_output_tokens: this.explainReservation.outputTokens,
          instructions,
          input: buildInput(request),
          text: { format: zodTextFormat(narrationEnvelopeSchema, 'finding_explanation') },
        },
        options?.signal,
      )
    } catch (error) {
      const requestId = providerRequestId(error)
      const reserved = failedCallUsage(this.#config)
      return classifyProviderException(
        error,
        {
          provider: 'openai-responses',
          model: this.#config.model,
          templateVersion: this.#config.templateVersion,
          requestIds: requestId === undefined ? [] : [requestId],
          usage: { ...reserved, requestCount: 1 },
        },
        options?.signal,
      )
    }
    if (response.refusals.length > 0) {
      return providerFailure(
        providerErrors.malformed,
        'refusal',
        metering([response.id], response.usage),
      )
    }
    const parsed = narrationEnvelopeSchema.safeParse(response.outputParsed)
    if (!parsed.success) {
      return providerFailure(
        providerErrors.malformed,
        'schema-validation',
        metering([response.id], response.usage),
      )
    }
    const result = findingExplanationSchema.safeParse({
      source: 'model-commentary',
      narration: parsed.data.narration,
      provenance: {
        provider: 'openai-responses',
        model: response.model,
        templateVersion: this.#config.templateVersion,
        requestIds: [response.id],
        threadId: null,
        usage: {
          ...response.usage,
          requestCount: 1,
          costMicrousd: this.#costMicrousd(response.usage),
        },
      },
    })
    return result.success
      ? { ok: true, value: result.data }
      : providerFailure(
          providerErrors.malformed,
          'provider-response',
          metering([response.id], response.usage),
        )
  }

  #costMicrousd(usage: { readonly inputTokens: number; readonly outputTokens: number }) {
    return estimatedCostMicrousd(this.#config, usage)
  }
}

export const createOpenAIResponsesFindingExplainer = (
  config: OpenAIFindingExplainerConfig & {
    readonly apiKey: string
    readonly baseURL?: string
  },
) =>
  new OpenAIResponsesFindingExplainer(
    config,
    new OpenAISdkExplanationTransport(config.apiKey, config.baseURL),
  )
