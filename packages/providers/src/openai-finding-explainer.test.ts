import type { ConceptSpec, VerificationFinding } from '@simproof/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  type OpenAIExplanationParseRequest,
  type OpenAIExplanationTransport,
  OpenAIResponsesFindingExplainer,
} from './openai-finding-explainer.js'

const conceptSpec: ConceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Simple pendulum',
  parameters: {
    length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.2, max: 3 } },
    amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
  },
  requestedControls: ['length', 'amplitude'],
}

const finding: VerificationFinding = {
  id: 'finding.period-mismatch',
  category: 'mismatch',
  severity: 'error',
  checkId: 'check.period',
  quantity: 'periodS',
  inputs: {
    lengthM: { value: 1, unit: 'm' },
    amplitudeDeg: { value: 10, unit: 'deg' },
  },
  expected: { value: 2.006, unit: 's' },
  actual: { value: 0.641, unit: 's' },
  tolerance: { mode: 'relative', relative: 0.01 },
  error: { mode: 'relative', value: 0.31 },
  explanation: 'Period differs from the closed-form value by 31%.',
}

const explainer = (transport: OpenAIExplanationTransport) =>
  new OpenAIResponsesFindingExplainer(
    {
      explainReservation: {
        inputTokens: 400,
        outputTokens: 200,
        requestCount: 1,
        costMicrousd: 600,
      },
      estimateCostMicrousd: ({ inputTokens, outputTokens }) => inputTokens + outputTokens,
      failedCallUsage: { inputTokens: 1, outputTokens: 1, costMicrousd: 1 },
      model: 'gpt-test',
      templateVersion: '1.0.0',
    },
    transport,
  )

describe('OpenAI Responses finding explainer', () => {
  it('returns model-commentary narration with revalidated provenance', async () => {
    const parse = vi.fn(() =>
      Promise.resolve({
        id: 'resp_explain',
        model: 'gpt-test',
        outputParsed: {
          narration: 'The pendulum period is far too short because the core omits the square root.',
        },
        refusals: [],
        usage: { inputTokens: 44, outputTokens: 21 },
      }),
    )

    const result = await explainer({ parse }).explain({
      conceptSpec,
      verdict: 'rejected',
      findings: [finding],
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: 'model-commentary',
        narration: 'The pendulum period is far too short because the core omits the square root.',
        provenance: {
          provider: 'openai-responses',
          model: 'gpt-test',
          requestIds: ['resp_explain'],
          usage: { inputTokens: 44, outputTokens: 21, requestCount: 1, costMicrousd: 65 },
        },
      },
    })
  })

  it('sends the finding evidence to the model as input', async () => {
    const parse = vi.fn((_request: OpenAIExplanationParseRequest) =>
      Promise.resolve({
        id: 'resp_input',
        model: 'gpt-test',
        outputParsed: { narration: 'ok' },
        refusals: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    )

    await explainer({ parse }).explain({ conceptSpec, verdict: 'rejected', findings: [finding] })

    const sentInput = parse.mock.calls[0]?.[0]?.input ?? ''
    expect(sentInput).toContain('periodS')
    expect(sentInput).toContain('Period differs from the closed-form value by 31%.')
    expect(sentInput).toContain('Verdict: rejected.')
  })

  it('fails closed when the model refuses', async () => {
    const parse = vi.fn(() =>
      Promise.resolve({
        id: 'resp_refusal',
        model: 'gpt-test',
        outputParsed: null,
        refusals: ['I cannot help with that.'],
        usage: { inputTokens: 3, outputTokens: 0 },
      }),
    )

    const result = await explainer({ parse }).explain({
      conceptSpec,
      verdict: 'rejected',
      findings: [finding],
    })

    expect(result).toMatchObject({ ok: false, kind: 'refusal' })
  })

  it('rejects an empty narration as malformed', async () => {
    const parse = vi.fn(() =>
      Promise.resolve({
        id: 'resp_empty',
        model: 'gpt-test',
        outputParsed: { narration: '   ' },
        refusals: [],
        usage: { inputTokens: 2, outputTokens: 1 },
      }),
    )

    const result = await explainer({ parse }).explain({
      conceptSpec,
      verdict: 'rejected',
      findings: [finding],
    })

    expect(result).toMatchObject({ ok: false, kind: 'schema-validation' })
  })

  it('returns a cancellation without calling the model when already aborted', async () => {
    const parse = vi.fn()
    const controller = new AbortController()
    controller.abort()

    const result = await explainer({ parse }).explain(
      { conceptSpec, verdict: 'rejected', findings: [finding] },
      { signal: controller.signal },
    )

    expect(result).toMatchObject({ ok: false, kind: 'cancellation' })
    expect(parse).not.toHaveBeenCalled()
  })
})
