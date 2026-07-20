import {
  type ConceptSpec,
  conceptCompilationResultSchema,
  conceptSpecSchema,
} from '@simproof/contracts'
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
  ConceptCompilationRequest,
  ConceptCompiler,
  ProviderCallOptions,
  ProviderCallReservation,
  ProviderDescriptor,
  ProviderResult,
} from './types.js'

const conceptEnvelopeSchema = z.object({ conceptSpec: conceptSpecSchema }).strict()

export interface OpenAIResponsesParseRequest {
  readonly model: string
  readonly max_output_tokens: number
  readonly instructions: string
  readonly input: string
  readonly text: { readonly format: ReturnType<typeof zodTextFormat<typeof conceptEnvelopeSchema>> }
}

export interface OpenAIResponsesParseResult {
  readonly id: string
  readonly model: string
  readonly outputParsed: unknown
  readonly refusals: readonly string[]
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export interface OpenAIResponsesTransport {
  parse(
    request: OpenAIResponsesParseRequest,
    signal?: AbortSignal,
  ): Promise<OpenAIResponsesParseResult>
}

export interface OpenAIConceptCompilerConfig extends ProviderMeteringPolicyConfig {
  readonly model: string
  readonly templateVersion: string
  readonly compileReservation: ProviderCallReservation
}

const instructions = `Compile the teacher request into a SimProof ConceptSpec.
Return only the schema-constrained concept. Support only the domains represented by the schema.
Never include executable code, equations, verifier policy, or fields not present in the schema.`

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

export class OpenAISdkResponsesTransport implements OpenAIResponsesTransport {
  readonly #client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    this.#client = new OpenAI({ apiKey, ...(baseURL === undefined ? {} : { baseURL }) })
  }

  async parse(
    request: OpenAIResponsesParseRequest,
    signal?: AbortSignal,
  ): Promise<OpenAIResponsesParseResult> {
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

export class OpenAIResponsesConceptCompiler implements ConceptCompiler {
  readonly descriptor: ProviderDescriptor
  readonly compileReservation: ProviderCallReservation
  readonly #config: OpenAIConceptCompilerConfig
  readonly #transport: OpenAIResponsesTransport

  constructor(config: OpenAIConceptCompilerConfig, transport: OpenAIResponsesTransport) {
    this.#config = config
    this.#transport = transport
    this.compileReservation = createProviderCallReservation(config.compileReservation)
    this.descriptor = Object.freeze({
      provider: 'openai-responses' as const,
      model: config.model,
      templateVersion: config.templateVersion,
    })
  }

  async compile(
    request: ConceptCompilationRequest,
    options?: ProviderCallOptions,
  ): Promise<
    ProviderResult<{
      conceptSpec: ConceptSpec
      provenance: import('@simproof/contracts').ProviderProvenance
    }>
  > {
    const metering = (
      requestIds: readonly string[],
      usage = { inputTokens: 0, outputTokens: 0 },
      requestCount = 1,
    ) => ({
      provider: 'openai-responses' as const,
      model: this.#config.model,
      templateVersion: this.#config.templateVersion,
      requestIds,
      usage: {
        ...usage,
        requestCount,
        costMicrousd: this.#costMicrousd(usage),
      },
    })
    if (options?.signal?.aborted === true) {
      return providerFailure(
        providerErrors.cancellation,
        'cancellation',
        metering([], undefined, 0),
      )
    }
    let response: OpenAIResponsesParseResult
    try {
      response = await this.#transport.parse(
        {
          model: this.#config.model,
          max_output_tokens: this.compileReservation.outputTokens,
          instructions,
          input: request.prompt,
          text: { format: zodTextFormat(conceptEnvelopeSchema, 'concept_spec') },
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
    const parsedEnvelope = conceptEnvelopeSchema.safeParse(response.outputParsed)
    const parsedConcept = parsedEnvelope.success
      ? conceptSpecSchema.safeParse(parsedEnvelope.data.conceptSpec)
      : parsedEnvelope
    if (!parsedConcept.success) {
      return providerFailure(
        providerErrors.malformed,
        'schema-validation',
        metering([response.id], response.usage),
      )
    }
    const costMicrousd = this.#costMicrousd(response.usage)
    const result = conceptCompilationResultSchema.safeParse({
      conceptSpec: parsedConcept.data,
      provenance: {
        provider: 'openai-responses',
        model: response.model,
        templateVersion: this.#config.templateVersion,
        requestIds: [response.id],
        threadId: null,
        usage: { ...response.usage, requestCount: 1, costMicrousd },
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

export const createOpenAIResponsesConceptCompiler = (
  config: OpenAIConceptCompilerConfig & {
    readonly apiKey: string
    readonly baseURL?: string
  },
) =>
  new OpenAIResponsesConceptCompiler(
    config,
    new OpenAISdkResponsesTransport(config.apiKey, config.baseURL),
  )
